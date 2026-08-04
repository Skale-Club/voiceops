// src/lib/manychat/dispatch-event.ts
// Inbound ManyChat event dispatcher.
//
// Called inline by /api/manychat/webhook AFTER the event row has been inserted
// (with status='unmatched'). This module finds the first matching rule, then:
//
// v2.0 agent path (CHAN-04 | Phase 37): when rule.agent_id is non-null, routes
//   through runAgent({ stream: false }) and replies via sendManychatMessage.
// v1.x legacy path: resolves the bound tool_config, decrypts credentials, executes
//   via the action engine, records a workflow_runs row (kind='tool'), and
//   updates manychat_events.
//
// Contract: NEVER throws. All failure modes write status='error' to the event row.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveRule } from './resolve-rule'
import { resolveToolById } from '@/lib/action-engine/resolve-tool-by-id'
import { executeAction } from '@/lib/action-engine/execute-action'
import { logToolRun } from '@/lib/workflows/log-tool-run'
import { decrypt } from '@/lib/crypto'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendManychatMessage } from './send-message'
import { formatOutbound as formatManychat } from '@/lib/agent-runtime/adapters/manychat'
import type { ManychatCredentials } from './client'

export interface DispatchInput {
  eventId: string
  orgId: string
  channelId: string
  eventType: string
  payload: Record<string, unknown>
  /** Subscriber ID from the inbound payload | required for agent reply delivery */
  subscriberId?: string | number
}

export async function dispatchManychatEvent(
  input: DispatchInput,
  supabase: SupabaseClient<Database>
): Promise<void> {
  const startedAt = Date.now()

  // 1. Find the first matching rule
  const rule = await resolveRule(
    input.orgId,
    input.channelId,
    input.eventType,
    input.payload,
    supabase
  )
  if (!rule) {
    return // Already 'unmatched' from the webhook insert
  }

  // 2. XOR branch: agent_id set → v2.0 agent path
  if (rule.agent_id) {
    await dispatchAgentPath(input, rule.agent_id, rule.id, supabase)
    return
  }

  // 3. Legacy path: tool_config_id → action engine
  await dispatchLegacyPath(input, rule, startedAt, supabase)
}

// ---------------------------------------------------------------------------
// Agent path (v2.0 | CHAN-04)
// ---------------------------------------------------------------------------

async function dispatchAgentPath(
  input: DispatchInput,
  agentId: string,
  ruleId: string,
  supabase: SupabaseClient<Database>
): Promise<void> {
  try {
    // Extract user message from payload | field name is 'text' or 'message' by convention
    const userMessage =
      typeof input.payload.text === 'string' ? input.payload.text :
      typeof input.payload.message === 'string' ? input.payload.message :
      JSON.stringify(input.payload)

    // Run agent (blocking, non-streaming | channel: 'manychat')
    const result = await runAgent({
      orgId: input.orgId,
      agentId,
      channel: 'manychat',
      userMessage,
      stream: false,
    })

    // Format reply via ManyChat adapter (handles 640-char chunk splits)
    const chunks = formatManychat(result.text)

    // Resolve ManyChat credentials to send reply
    const { data: channel } = await supabase
      .from('manychat_channels')
      .select('encrypted_api_key')
      .eq('id', input.channelId)
      .single()

    if (channel?.encrypted_api_key) {
      const apiKey = await decrypt(channel.encrypted_api_key)
      const credentials: ManychatCredentials = { apiKey, locationId: '' }
      const subscriberId = input.subscriberId ?? input.payload.subscriber_id

      // Send each chunk as a separate ManyChat message
      for (const chunk of chunks) {
        if (chunk.type === 'manychat_block') {
          await sendManychatMessage(
            { subscriber_id: subscriberId, data: chunk.data },
            credentials
          )
        }
      }
    }

    // Mark event as matched
    await supabase
      .from('manychat_events')
      .update({ status: 'matched', matched_rule_id: ruleId })
      .eq('id', input.eventId)
  } catch (err) {
    console.error('[manychat/dispatch] agent path error:', err)
    await supabase
      .from('manychat_events')
      .update({ status: 'error', matched_rule_id: ruleId })
      .eq('id', input.eventId)
  }
}

// ---------------------------------------------------------------------------
// Legacy path (v1.x | tool_config_id → action engine) | UNCHANGED behavior
// ---------------------------------------------------------------------------

async function dispatchLegacyPath(
  input: DispatchInput,
  rule: Awaited<ReturnType<typeof resolveRule>>,
  startedAt: number,
  supabase: SupabaseClient<Database>
): Promise<void> {
  if (!rule) return

  const tool = await resolveToolById(rule.tool_config_id, supabase)
  if (!tool) {
    await markEvent(supabase, input.eventId, {
      status: 'error',
      matched_rule_id: rule.id,
    })
    return
  }

  let result = ''
  let status: 'success' | 'error' | 'timeout' = 'success'
  let errorDetail: string | null = null

  try {
    // Native actions carry no integration row | nothing to decrypt.
    const integration = tool.integrations
    const credentials = integration
      ? { apiKey: await decrypt(integration.encrypted_api_key), locationId: integration.location_id ?? '' }
      : { apiKey: '', locationId: '' }
    result = await executeAction(
      tool.action_type,
      input.payload,
      credentials,
      {
        organizationId: input.orgId,
        supabase,
        toolConfig: tool.config,
        integrationProvider: integration?.provider,
      }
    )
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    status = isTimeout ? 'timeout' : 'error'
    errorDetail = err instanceof Error ? err.message : String(err)
    result = tool.fallback_message
  }

  // workflow_runs (kind='tool') replaces the frozen action_logs write path;
  // historical action_log_id rows stay readable via the workflow_tool_logs view.
  const runId = await logToolRun({
    orgId: input.orgId,
    workflowId: tool.workflow_id,
    toolName: tool.tool_name,
    triggerType: 'manychat',
    vapiCallId: `manychat:${input.eventId}`,
    status,
    executionMs: Date.now() - startedAt,
    requestPayload: input.payload,
    responsePayload: { result },
    errorDetail,
  }, supabase)

  await markEvent(supabase, input.eventId, {
    status: status === 'success' ? 'matched' : 'error',
    matched_rule_id: rule.id,
    workflow_run_id: runId,
  })
}

async function markEvent(
  supabase: SupabaseClient<Database>,
  eventId: string,
  updates: Database['public']['Tables']['manychat_events']['Update']
): Promise<void> {
  await supabase
    .from('manychat_events')
    .update(updates)
    .eq('id', eventId)
}
