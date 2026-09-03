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
} from '@/lib/workflows/derive-input-schema'
import {
  deriveIdempotencyKey,
  checkIdempotency,
  recordIdempotency,
  hashToolArgs,
} from './idempotency'

export interface WorkflowToolSummary {
  toolName: string
  description: string
  kind: 'tool' | 'flow'
}

interface BuildResult {
  toolSet: Record<string, ReturnType<typeof dynamicTool>>
  summaries: WorkflowToolSummary[]
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

  const result: BuildResult = { toolSet: {}, summaries: [] }

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

    const definition = version.definition as unknown
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

        // Idempotency | only for kind='flow' (multi-step side-effecting paths).
        // kind='tool' already routes through executeAction which has its own
        // idempotency gate, but we mirror the legacy pattern here for flows so
        // tool-call replays don't re-execute the whole DAG.
        let idempotencyKey = ''
        if (capturedKind === 'flow' && invocationId && invocationId !== '' && invocationId !== 'insert-failed') {
          idempotencyKey = deriveIdempotencyKey(invocationId, currentIndex)
          const cached = await checkIdempotency(orgId, idempotencyKey)
          if (cached !== null) {
            toolCallsLog.push({
              name: capturedToolName,
              args: JSON.parse(JSON.stringify(toolArgs)) as Json,
              result: cached,
              denied: false,
              idempotency_cache_hit: true,
              tool_call_index: currentIndex,
              workflow_id: capturedWorkflowId,
            })
            return cached
          }
        }

        // Dispatch.
        const dispatched = await executeWorkflowTool({
          workflowId: capturedWorkflowId,
          kind: capturedKind,
          definition: capturedDefinition,
          input: toolArgs,
          context: { orgId, conversationId, channel, agentId },
          toolName: capturedToolName,
          triggerType: 'agent',
        })

        const resultStr =
          typeof dispatched.result === 'string'
            ? dispatched.result
            : JSON.stringify(dispatched)

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
export function buildWorkflowSystemPromptSuffix(
  summaries: WorkflowToolSummary[],
): string {
  if (summaries.length === 0) return ''
  const lines = summaries
    .map((s) => {
      const annotation = s.kind === 'flow' ? ' (multi-step flow)' : ''
      return `- **${s.toolName}**: ${s.description}${annotation}`
    })
    .join('\n')
  return [
    '',
    '## Available Workflows',
    'You have access to the following workflows as tools. Call them when appropriate:',
    lines,
    '',
    'When calling a workflow tool, provide only the required input fields. The system handles execution and will return the result.',
  ].join('\n')
}
