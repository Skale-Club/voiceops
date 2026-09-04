// SEED-033: builds dynamicTool entries for workflows attached to an agent.
//
// Both the blocking and streaming paths in run-agent.ts call this once to get:
//   1. A toolSet keyed by `workflows.tool_name` (merged into the legacy
//      tool_configs toolSet before passing to generateText/streamText).
//   2. A summary list to append to the system prompt under
//      "## Available Workflows".
//
// Each tool's execute() re-checks resolveAgentTool (channel auth + chain
// intersection) at call time and then dispatches via executeWorkflowTool.

import { dynamicTool } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { AgentChannel } from './types'
import { createLogger } from '@/lib/obs/logger'
import { resolveAgentTool, resolveEffectiveToolAuthority } from './resolve-agent-tool'
import { executeWorkflowTool } from './execute-workflow-tool'
import type { PartnerEdgeDecision } from './resolve-partner-edge'
import {
  deriveWorkflowInputSchema,
  getWorkflowInputSchema,
  type InputSchemaMap,
} from '@/lib/workflows/derive-input-schema'
import {
  deriveIdempotencyKey,
  checkIdempotency,
  recordIdempotency,
  recordAbandonedIdempotency,
  requiresIdempotency,
  hashToolArgs,
} from './idempotency'
import { extractActionTypeFromDefinition } from '@/lib/workflows/derive-action-type'
import { resolveServiceLocationMode } from './resolve-service-location-mode'
import { applyServiceLocationMode, type ServiceLocationMode } from './service-location-schema'
import { renderServiceLocationBlock } from './service-location-prompt'

export interface WorkflowToolSummary {
  toolName: string
  description: string
  kind: 'tool' | 'flow'
}

interface BuildResult {
  toolSet: Record<string, ReturnType<typeof dynamicTool>>
  summaries: WorkflowToolSummary[]
  /**
   * Phase 138 Plan 02 (MODAL-02/MODAL-03): renderServiceLocationBlock() text
   * for the org's resolved service_location_mode, set only when a
   * book_appointment row was attached to this agent. Empty string for every
   * agent that never touches booking — zero resolver calls, zero prompt
   * change.
   */
  modalityBlock: string
}

/**
 * Rebuilds a workflow definition with its input_schema map replaced, at
 * whichever of the two shapes derive-input-schema.ts's extractInputSchemaMap
 * reads from (trigger.config.input_schema, the YAML/canary shape, checked
 * first; trigger_config.input_schema, the flattened workflows-row shape,
 * checked second). Falls back to the trigger.config shape when the
 * definition declares neither — book_appointment always declares one of
 * these, so this only guards against a malformed definition silently
 * dropping the transformed map.
 */
function rebuildDefinitionWithInputSchema(definition: unknown, inputSchema: InputSchemaMap): unknown {
  if (!definition || typeof definition !== 'object') return definition
  const def = definition as Record<string, unknown>

  const trigger = def.trigger as Record<string, unknown> | undefined
  if (trigger && typeof trigger === 'object') {
    const triggerConfig = (trigger.config ?? {}) as Record<string, unknown>
    return {
      ...def,
      trigger: { ...trigger, config: { ...triggerConfig, input_schema: inputSchema } },
    }
  }

  const triggerConfigField = def.trigger_config as Record<string, unknown> | undefined
  if (triggerConfigField && typeof triggerConfigField === 'object') {
    return {
      ...def,
      trigger_config: { ...triggerConfigField, input_schema: inputSchema },
    }
  }

  return { ...def, trigger: { config: { input_schema: inputSchema } } }
}

export interface BuildWorkflowToolsParams {
  agentId: string
  orgId: string
  channel: AgentChannel
  currentChain: string[]
  invocationId: string
  traceId: string
  conversationId?: string
  serviceClient: SupabaseClient<Database>
  toolCallsLog: Json[]
  // Counter ref | caller manages the integer; we increment via closure each call.
  getNextToolCallIndex: () => number
  /**
   * Phase 132 (AUTHZ-01): the trusted, already-resolved partner-edge decision
   * for the edge traversed to reach `agentId`, or null/undefined when
   * `agentId` was invoked directly (not through delegation). Passed straight
   * through to resolveEffectiveToolAuthority() at call time — replaces the
   * Phase 38 "every ancestor must own this tool" intersection model.
   */
  incomingEdge?: PartnerEdgeDecision | null
}

export async function buildWorkflowTools(
  params: BuildWorkflowToolsParams,
): Promise<BuildResult> {
  const {
    agentId,
    orgId,
    channel,
    currentChain,
    invocationId,
    traceId,
    conversationId,
    serviceClient,
    toolCallsLog,
    getNextToolCallIndex,
    incomingEdge,
  } = params

  const result: BuildResult = { toolSet: {}, summaries: [], modalityBlock: '' }

  // Phase 138 Plan 02: resolved at most once per call, only when a
  // book_appointment row is actually present among the agent's tools.
  let serviceLocationMode: ServiceLocationMode | null = null

  // Fetch agent_tools rows whose workflow_id is set, joined with workflows
  // + current workflow_versions.definition. Health-blocked and inactive
  // workflows are filtered out so the LLM never sees them.
  const { data: rows, error } = await serviceClient
    .from('agent_tools')
    .select(`
      allowed_channels,
      workflow_id,
      workflows!inner (
        id,
        name,
        tool_name,
        description,
        kind,
        is_active,
        health_blocked,
        current_version_id
      )
    `)
    .eq('agent_id', agentId)
    .eq('workflows.is_active', true)
    .eq('workflows.health_blocked', false)
    .not('workflow_id', 'is', null)

  if (error || !rows || rows.length === 0) return result

  for (const row of rows) {
    const allowed = row.allowed_channels as AgentChannel[] | null
    if (allowed !== null && Array.isArray(allowed) && !allowed.includes(channel)) {
      continue
    }
    const wf = row.workflows as {
      id: string
      name: string
      tool_name: string | null
      description: string | null
      kind: 'tool' | 'flow'
      current_version_id: string | null
    } | null
    if (!wf || !wf.tool_name || !wf.current_version_id) continue

    // Load the definition for this version.
    const { data: version } = await serviceClient
      .from('workflow_versions')
      .select('definition')
      .eq('id', wf.current_version_id)
      .single()
    if (!version) continue

    let definition = version.definition as unknown

    // Phase 138 Plan 02 (MODAL-02/MODAL-03): the engine, not the prompt
    // author, decides whether book_appointment can be called without an
    // address. Resolve the org's mode once, transform ONLY this row's
    // input_schema, and render the same text into the system prompt suffix
    // below — every other workflow's definition passes through untouched.
    if (wf.tool_name === 'book_appointment') {
      if (serviceLocationMode === null) {
        serviceLocationMode = await resolveServiceLocationMode(orgId)
        result.modalityBlock = renderServiceLocationBlock(serviceLocationMode)
      }
      const rawInputSchema = getWorkflowInputSchema(definition)
      const transformed = applyServiceLocationMode(rawInputSchema, serviceLocationMode)
      definition = rebuildDefinitionWithInputSchema(definition, transformed)
    }

    const inputSchema = deriveWorkflowInputSchema(definition)
    const desc =
      wf.description ??
      `Execute the workflow: ${wf.name}` +
        (wf.kind === 'flow' ? ' (multi-step flow)' : '')

    const capturedToolName = wf.tool_name
    const capturedWorkflowId = wf.id
    const capturedKind = wf.kind
    const capturedDefinition = definition

    result.summaries.push({
      toolName: capturedToolName,
      description: desc,
      kind: capturedKind,
    })

    result.toolSet[capturedToolName] = dynamicTool({
      description: desc,
      inputSchema,
      execute: async (args: unknown) => {
        const toolArgs = (args as Record<string, unknown>) ?? {}
        const currentIndex = getNextToolCallIndex()

        // Re-verify authorization at call time (same gate as tool_configs).
        const resolved = await resolveAgentTool(agentId, capturedToolName, channel)
        if (!resolved || resolved.workflowId !== capturedWorkflowId) {
          toolCallsLog.push({
            name: capturedToolName,
            args: JSON.parse(JSON.stringify(toolArgs)) as Json,
            denied: true,
            denied_reason: 'workflow_not_attached_to_agent',
          })
          return 'Workflow not available to this agent on this channel.'
        }

        // Phase 132 (AUTHZ-01/AUTHZ-02): effective delegated authority —
        // specialist's own direct grant (resolved, above) intersected with
        // the current partner edge's delegated-workflow allow-list (never
        // an ancestor-ownership intersection; see resolveEffectiveToolAuthority).
        const authority = resolveEffectiveToolAuthority(resolved, incomingEdge)
        if (!authority.allow) {
          toolCallsLog.push({
            name: capturedToolName,
            args: JSON.parse(JSON.stringify(toolArgs)) as Json,
            denied: true,
            denied_reason: authority.reason === 'not_delegated' ? 'edge_does_not_delegate_workflow' : 'workflow_not_attached_to_agent',
            chain: currentChain,
          })
          createLogger({ traceId })
            .warn('edge_authz_denied_workflow', { tool: capturedToolName, reason: authority.reason, chain: currentChain })
          return `Tool execution denied: ${capturedToolName} is not authorized for this delegation.`
        }

        // SAFE-02. This gate used to run for kind='flow' only, on the stated
        // assumption that "kind='tool' already routes through executeAction which
        // has its own idempotency gate". executeAction has no such gate — grep it —
        // and all three Xkedule mutations are kind='tool'. So the booking path the
        // specialist mesh actually uses had no replay protection at all, which is
        // exactly what SAFE-02 exists to prevent. Phase 133's tests passed because
        // they covered the Vapi route and run-agent's legacy tool loop, never this
        // one.
        //
        // A flow stays guarded unconditionally: replaying a multi-step DAG is
        // unsafe whatever its nodes do. A tool is guarded when its action type is
        // side-effecting, so reads keep paying nothing.
        const capturedActionType =
          capturedKind === 'tool' ? extractActionTypeFromDefinition(capturedDefinition) : null
        const needsIdempotency =
          capturedKind === 'flow' ||
          (typeof capturedActionType === 'string' && requiresIdempotency(capturedActionType))

        let idempotencyKey = ''
        let idempotencyRequestHash = ''
        if (needsIdempotency && invocationId && invocationId !== '' && invocationId !== 'insert-failed') {
          idempotencyKey = deriveIdempotencyKey(invocationId, currentIndex)
          idempotencyRequestHash = hashToolArgs(toolArgs)
          const outcome = await checkIdempotency(orgId, idempotencyKey, idempotencyRequestHash)
          if (outcome.status === 'replay') {
            toolCallsLog.push({
              name: capturedToolName,
              args: JSON.parse(JSON.stringify(toolArgs)) as Json,
              result: outcome.response,
              denied: false,
              idempotency_cache_hit: true,
              tool_call_index: currentIndex,
              workflow_id: capturedWorkflowId,
            })
            return outcome.response
          }
          if (outcome.status === 'conflict' || outcome.status === 'abandoned') {
            // Phase 133 (SAFE-01): never re-execute or answer with someone
            // else's cached result when the key is reused with different
            // arguments, or the prior attempt was killed mid-flight and its
            // ownership is unresolved.
            toolCallsLog.push({
              name: capturedToolName,
              args: JSON.parse(JSON.stringify(toolArgs)) as Json,
              denied: true,
              denied_reason: outcome.status === 'conflict' ? 'idempotency_conflict' : 'idempotency_abandoned',
              tool_call_index: currentIndex,
              workflow_id: capturedWorkflowId,
            })
            return outcome.status === 'conflict'
              ? 'Tool execution blocked: idempotency key conflict (same key, different arguments).'
              : 'Tool execution blocked: a previous attempt for this action was interrupted and could not be confirmed. Please retry once ownership is resolved.'
          }
        }

        // Dispatch.
        // Phase 134 Plan 03 (OBS-01): thread this turn's trace + invocation
        // identity through so logToolRun() (migration 1292 columns) can join
        // the resulting workflow_runs row back to the invocation that caused
        // it. invocationId is '' or 'insert-failed' when the earlier INSERT
        // didn't produce a real row — never pass those as if they were one.
        const dispatched = await executeWorkflowTool({
          workflowId: capturedWorkflowId,
          kind: capturedKind,
          definition: capturedDefinition,
          input: toolArgs,
          context: {
            orgId,
            conversationId,
            channel,
            agentId,
            traceId,
            agentInvocationId:
              invocationId && invocationId !== '' && invocationId !== 'insert-failed'
                ? invocationId
                : undefined,
          },
          toolName: capturedToolName,
          triggerType: 'agent',
        })

        const resultStr =
          typeof dispatched.result === 'string'
            ? dispatched.result
            : JSON.stringify(dispatched)

        // PERF-03: a dispatch that timed out may have left the provider
        // mutation in flight. Record abandoned ownership so a later retry sees
        // `abandoned` rather than a free slot. This path signals a timeout with
        // a flag rather than by throwing, so it needs its own check.
        if (
          dispatched.timed_out &&
          idempotencyKey &&
          invocationId &&
          invocationId !== '' &&
          invocationId !== 'insert-failed'
        ) {
          await recordAbandonedIdempotency({
            organizationId: orgId,
            agentInvocationId: invocationId,
            idempotencyKey,
            toolName: capturedToolName,
            requestHash: hashToolArgs(toolArgs),
            reason: 'workflow_tool_timeout',
          })
        }

        if (
          dispatched.ok &&
          idempotencyKey &&
          invocationId &&
          invocationId !== '' &&
          invocationId !== 'insert-failed'
        ) {
          await recordIdempotency({
            organizationId: orgId,
            agentInvocationId: invocationId,
            idempotencyKey,
            toolName: capturedToolName,
            requestHash: hashToolArgs(toolArgs),
            response: resultStr,
          })
        }

        toolCallsLog.push({
          name: capturedToolName,
          args: JSON.parse(JSON.stringify(toolArgs)) as Json,
          result: resultStr,
          denied: false,
          tool_call_index: currentIndex,
          workflow_id: capturedWorkflowId,
          workflow_kind: capturedKind,
          ok: dispatched.ok,
          ...(dispatched.error ? { error: dispatched.error } : {}),
          ...(dispatched.timed_out ? { timed_out: true } : {}),
        })

        return resultStr
      },
    })
  }

  return result
}

// Returns the suffix block to append to the system prompt. Empty string when
// no workflows are attached. Format matches the SEED-033 contract.
//
// Phase 138 Plan 02 (MODAL-03): `modalityBlock` is BuildResult.modalityBlock
// from buildWorkflowTools() — renderServiceLocationBlock() text for whichever
// org/mode built the toolset, or '' for any agent without book_appointment.
// Empty/omitted produces byte-identical output to before this parameter
// existed, so every non-booking agent's prompt is unaffected.
export function buildWorkflowSystemPromptSuffix(
  summaries: WorkflowToolSummary[],
  modalityBlock: string = '',
): string {
  if (summaries.length === 0) return ''
  const lines = summaries
    .map((s) => {
      const annotation = s.kind === 'flow' ? ' (multi-step flow)' : ''
      return `- **${s.toolName}**: ${s.description}${annotation}`
    })
    .join('\n')
  const base = [
    '',
    '## Available Workflows',
    'You have access to the following workflows as tools. Call them when appropriate:',
    lines,
    '',
    'When calling a workflow tool, provide only the required input fields. The system handles execution and will return the result.',
  ].join('\n')

  if (!modalityBlock) return base

  return [base, '', '## Service Location', modalityBlock].join('\n')
}
