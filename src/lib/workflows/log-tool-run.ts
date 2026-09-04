// Run-log for kind='tool' workflow executions (SEED-025 follow-up).
//
// Replaces the frozen action_logs write path (log-action.ts is a no-op stub
// since Phase F): every completed tool execution is recorded as a terminal
// workflow_runs row with kind='tool'. Reads happen through the
// workflow_tool_logs view (migration 1249), which unions these rows with the
// legacy action_logs history.
//
// Contract: best-effort, never throws — call sites are webhook hot paths and
// agent turns where logging must not break the response.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface ToolRunLogInput {
  orgId: string
  /** Real workflows.id (NOT the projected legacy tool_config id). */
  workflowId: string
  toolName: string | null
  /** Channel that triggered the execution: 'vapi' | 'manychat' | 'agent' | 'mcp' | ... */
  triggerType: string
  /**
   * Execution context ref, matching the legacy action_logs convention:
   * bare Vapi call id for voice tool-calls, prefixed pseudo-id for other
   * channels (e.g. `manychat:<eventId>`). Null when there is no useful ref.
   */
  vapiCallId?: string | null
  status: 'success' | 'error' | 'timeout'
  executionMs: number
  requestPayload: Record<string, unknown>
  responsePayload: Record<string, unknown>
  errorDetail?: string | null
  /**
   * Phase 134 (OBS-01): cross-table trace correlation — same trace_id as the
   * causing agent_invocations row. Optional so every existing caller keeps
   * compiling and behaving identically (columns stay null). Migration 1292.
   */
  traceId?: string | null
  /**
   * Phase 134 (OBS-01): back-reference to the agent_invocations row that
   * caused this run. Optional/nullable for the same reason as traceId —
   * cron, campaign, manual, and legacy direct-workflow runs have none.
   * Migration 1292.
   */
  agentInvocationId?: string | null
}

const STATUS_MAP: Record<ToolRunLogInput['status'], string> = {
  success: 'succeeded',
  error: 'failed',
  timeout: 'timeout',
}

export async function logToolRun(
  input: ToolRunLogInput,
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  try {
    const endedAt = new Date()
    const startedAt = new Date(endedAt.getTime() - Math.max(0, input.executionMs))

    const { data, error } = await supabase
      .from('workflow_runs')
      .insert({
        org_id: input.orgId,
        workflow_id: input.workflowId,
        kind: 'tool',
        trigger_type: input.triggerType,
        trigger_payload: input.requestPayload,
        state: input.responsePayload,
        status: STATUS_MAP[input.status],
        tool_name: input.toolName,
        vapi_call_id: input.vapiCallId ?? null,
        execution_ms: input.executionMs,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        error: input.errorDetail ?? null,
        trace_id: input.traceId ?? null,
        agent_invocation_id: input.agentInvocationId ?? null,
      })
      .select('id')
      .single()

    if (error || !data) return null
    return data.id
  } catch {
    return null
  }
}
