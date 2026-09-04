// SEED-033: dispatcher for agent-invoked workflow tools.
//
// kind='tool' workflows are 1-action graphs | delegate straight to the action
// engine using the action node's kind/action_type and its declared config
// merged with the LLM-provided input.
//
// kind='flow' workflows are multi-step DAGs | delegate to runFlowSync with a
// 30s timeout. The result is returned to the LLM as the tool-call output.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction, type ActionContext } from '@/lib/action-engine/execute-action'
import { logToolRun } from '@/lib/workflows/log-tool-run'
import { extractActionTypeFromDefinition } from '@/lib/workflows/derive-action-type'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import type { Database } from '@/types/database'

type ActionType = Database['public']['Enums']['action_type']

export interface WorkflowToolResult {
  ok: boolean
  result?: unknown
  error?: string
  timed_out?: boolean
  run_id?: string
}

export interface ExecuteWorkflowToolParams {
  workflowId: string
  kind: 'tool' | 'flow'
  definition: unknown
  input: Record<string, unknown>
  context: {
    orgId: string
    conversationId?: string
    channel?: string
    agentId?: string
    /**
     * Phase 134 Plan 03 (OBS-01/OBS-02): the calling agent turn's trace and
     * invocation identity, threaded straight into logToolRun()'s Phase
     * 134-01 columns (migration 1292) so an agent-triggered workflow run is
     * joinable back to the invocation that caused it. Optional — the MCP
     * tool-invocation call site (src/lib/mcp/tools/workflows.ts) has no
     * agent invocation to attribute to and legitimately omits both.
     */
    traceId?: string
    agentInvocationId?: string
  }
  timeoutMs?: number
  /** Display name recorded on the kind='tool' run row (workflow_runs.tool_name). */
  toolName?: string
  /** Run-log trigger_type | defaults to 'agent' when context.agentId is set, else 'manual'. */
  triggerType?: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Pull the single non-trigger action node's config out of either shape.
function extractActionConfig(definition: unknown): Record<string, unknown> {
  if (!isObject(definition)) return {}
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : []
  for (const node of nodes) {
    if (!isObject(node)) continue
    // Flow engine shape
    if (typeof node.type === 'string' && isObject(node.data)) {
      const data = node.data
      if (data.kind === 'action') {
        return isObject(data.config) ? (data.config as Record<string, unknown>) : {}
      }
    }
    // YAML/spec shape
    if (typeof node.kind === 'string' && node.id !== 'trigger') {
      const { id: _id, kind: _k, ...rest } = node
      void _id
      void _k
      return rest as Record<string, unknown>
    }
  }
  return {}
}

export async function executeWorkflowTool(
  params: ExecuteWorkflowToolParams,
): Promise<WorkflowToolResult> {
  if (params.kind === 'tool') {
    const actionType = extractActionTypeFromDefinition(params.definition) as ActionType
    if (!actionType || actionType === ('unknown' as unknown as ActionType)) {
      return { ok: false, error: 'workflow_has_no_action_node' }
    }

    const baseConfig = extractActionConfig(params.definition)
    // LLM-supplied input wins over declared defaults so the agent can
    // override interpolated placeholders by passing concrete values.
    const merged: Record<string, unknown> = { ...baseConfig, ...params.input }

    const supabase = createServiceRoleClient()
    const ctx: ActionContext = {
      organizationId: params.context.orgId,
      supabase,
    }

    const triggerType =
      params.triggerType ?? (params.context.agentId ? 'agent' : 'manual')
    const startMs = Date.now()

    try {
      const result = await executeAction(
        actionType,
        merged,
        { apiKey: '', locationId: '' },
        ctx,
      )
      await logToolRun({
        orgId: params.context.orgId,
        workflowId: params.workflowId,
        toolName: params.toolName ?? null,
        triggerType,
        vapiCallId: params.context.conversationId
          ? `chat:${params.context.conversationId}`
          : null,
        status: 'success',
        executionMs: Date.now() - startMs,
        requestPayload: merged,
        responsePayload: { result },
        traceId: params.context.traceId ?? null,
        agentInvocationId: params.context.agentInvocationId ?? null,
      }, supabase)
      return { ok: true, result }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      const message = err instanceof Error ? err.message : String(err)
      await logToolRun({
        orgId: params.context.orgId,
        workflowId: params.workflowId,
        toolName: params.toolName ?? null,
        triggerType,
        vapiCallId: params.context.conversationId
          ? `chat:${params.context.conversationId}`
          : null,
        status: isTimeout ? 'timeout' : 'error',
        executionMs: Date.now() - startMs,
        requestPayload: merged,
        responsePayload: {},
        errorDetail: message,
        traceId: params.context.traceId ?? null,
        agentInvocationId: params.context.agentInvocationId ?? null,
      }, supabase)
      return {
        ok: false,
        error: message,
      }
    }
  }

  if (params.kind === 'flow') {
    // Flows with a wait node must suspend on the persistent engine so post-wait
    // nodes actually run later — the sync runner would silently drop them and
    // report success. Resume needs the version id, so look it up.
    if (definitionHasWait(params.definition)) {
      const supabase = createServiceRoleClient()
      const { data: wf } = await supabase
        .from('workflows')
        .select('current_version_id')
        .eq('id', params.workflowId)
        .maybeSingle()
      const result = await runFlow({
        workflowId: params.workflowId,
        versionId: wf?.current_version_id ?? null,
        definition: params.definition as FlowDefinition,
        orgId: params.context.orgId,
        triggerType: 'tool_call',
        triggerPayload: params.input,
        supabase,
      })
      if (result.status === 'waiting') {
        return {
          ok: true,
          result: `Workflow started. Run id: ${result.runId}. It will continue in the background when the awaited event or timeout occurs.`,
          run_id: result.runId,
        }
      }
      return {
        ok: result.status !== 'failed',
        result: `Workflow ${result.status}. Run id: ${result.runId}.`,
        error: result.error,
        run_id: result.runId,
      }
    }
    return runFlowSync({
      workflowId: params.workflowId,
      definition: params.definition,
      triggerInput: params.input,
      context: params.context,
      timeoutMs: params.timeoutMs ?? 30_000,
    })
  }

  return { ok: false, error: `unsupported_workflow_kind:${String(params.kind)}` }
}
