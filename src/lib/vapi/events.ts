// Vapi call event emitter — fires the `vapi.call.ended` workflow trigger.
//
// The trigger has been offered in the flow builder (lib/flows/node-metadata.ts)
// since the visual builder shipped, but nothing ever emitted it, so any workflow
// built on it silently never ran. This closes that loop.
//
// Mirrors src/lib/twilio/events.ts (emitInboundPhoneEvent), which already has the
// right shape:
//   1. Build {{phone.*}} + {{contact.*}} scope (reused verbatim from
//      lib/twilio/scope.ts) and add a {{call.*}} block.
//   2. Look up active event-trigger workflows whose trigger_config.event matches.
//      Optional trigger_config.phone_number_id narrows the match to one number,
//      which is what makes "when a call lands on THIS number, send an SMS"
//      expressible.
//   3. Record an audit row in event_dispatches.
//   4. Dispatch each via runFlow / runFlowSync (fire-and-forget).
//
// IMPORTANT: this runs inside the Vapi webhook's after() callback. It must never
// throw — an emission failure cannot be allowed to break call persistence or the
// webhook response. Callers gate on persistCallRecord's `inserted` flag so a Vapi
// retry (same vapi_call_id, blocked by the UNIQUE index) never re-fires workflows.

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/types/database'
import type { VapiEndOfCallMessage } from '@/types/vapi'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { resumeMatchingWaits } from '@/lib/flows/resume-waits'
import { buildPhoneScope, lookupContactByPhone } from '@/lib/twilio/scope'

export const VAPI_CALL_ENDED_EVENT = 'vapi.call.ended'

export interface VapiCallEventPayload {
  /** `calls.id` of the persisted row — becomes event_dispatches.source_id. */
  callId: string
  /** Vapi's own call id, surfaced to workflows as {{call.external_id}}. */
  vapiCallId: string | null
  /** twilio_phone_numbers.id of the org-side number, when registered locally. */
  phoneNumberId: string | null
  /** E.164 of the org-side number that took the call. */
  orgNumber: string | null
  /** The other party's number — used for contact lookup. */
  customerNumber: string | null
  customerName: string | null
  direction: 'inbound' | 'outbound'
  durationSeconds: number | null
  endedReason: string | null
  successEvaluation: string | null
  summary: string | null
  recordingUrl: string | null
  assistantId: string | null
}

/**
 * Build the event payload from the raw end-of-call report plus the ids the
 * persistence step resolved. Both webhook routes (/api/vapi/calls and
 * /api/vapi/campaigns) receive the same report shape, so this keeps them from
 * drifting on what workflows see.
 *
 * `duration_seconds` is a GENERATED column on `calls`, so it isn't in the insert
 * result — recomputed here from the report's timestamps.
 */
export function buildVapiCallEventPayload(
  message: VapiEndOfCallMessage['message'],
  ids: { callId: string; phoneNumberId: string | null },
): VapiCallEventPayload {
  const { call, artifact, analysis, startedAt, endedAt, endedReason } = message

  const start = startedAt ?? call?.startedAt ?? null
  const end = endedAt ?? call?.endedAt ?? null
  let durationSeconds: number | null = null
  if (start && end) {
    const ms = Date.parse(end) - Date.parse(start)
    if (Number.isFinite(ms) && ms >= 0) durationSeconds = Math.round(ms / 1000)
  }

  const successEvaluation =
    analysis?.successEvaluation === undefined || analysis?.successEvaluation === null
      ? null
      : String(analysis.successEvaluation)

  return {
    callId: ids.callId,
    vapiCallId: call?.id ?? null,
    phoneNumberId: ids.phoneNumberId,
    orgNumber: call?.phoneNumber?.number ?? null,
    customerNumber: call?.customer?.number ?? null,
    customerName: call?.customer?.name ?? null,
    direction: call?.type === 'outboundPhoneCall' ? 'outbound' : 'inbound',
    durationSeconds,
    endedReason: endedReason ?? null,
    successEvaluation,
    summary: analysis?.summary ?? null,
    recordingUrl: artifact?.recordingUrl ?? artifact?.stereoRecordingUrl ?? null,
    assistantId: call?.assistantId ?? null,
  }
}

export interface EmitVapiCallEventOptions {
  depth?: number
  parentDispatchId?: string | null
  supabase?: SupabaseClient<Database>
}

const MAX_CASCADE_DEPTH = 3

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
  trigger_config: Record<string, unknown> | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  phoneNumberId: string | null,
): Promise<MatchedWorkflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, current_version_id, trigger_config')
    .eq('org_id', orgId)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event: VAPI_CALL_ENDED_EVENT })

  if (error || !data) return []

  return (data as MatchedWorkflow[]).filter((wf) => {
    const cfgPhoneId = (wf.trigger_config as { phone_number_id?: string } | null)?.phone_number_id
    if (!cfgPhoneId) return true
    return cfgPhoneId === phoneNumberId
  })
}

async function recordDispatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  sourceId: string,
  payload: Json,
  workflowIds: string[],
  depth: number,
  parentDispatchId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('event_dispatches')
    .insert({
      org_id: orgId,
      event_type: VAPI_CALL_ENDED_EVENT,
      source_table: 'calls',
      source_id: sourceId,
      workflow_ids: workflowIds,
      payload,
      parent_id: parentDispatchId,
      depth,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[vapi/events] dispatch record error:', error.message)
    return null
  }
  return (data as { id: string }).id
}

export async function emitVapiCallEndedEvent(
  orgId: string,
  payload: VapiCallEventPayload,
  options: EmitVapiCallEventOptions = {},
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  const depth = options.depth ?? 0
  if (depth > MAX_CASCADE_DEPTH) {
    console.warn('[vapi/events] cascade depth limit hit', payload.callId)
    return { dispatched: 0, dispatch_id: null }
  }

  try {
    const supabase = options.supabase ?? createServiceRoleClient()

    const [phone, contact] = await Promise.all([
      buildPhoneScope(supabase, payload.phoneNumberId),
      lookupContactByPhone(supabase, orgId, payload.customerNumber),
    ])

    const matched = await findMatchingWorkflows(supabase, orgId, payload.phoneNumberId)

    const call = {
      id: payload.callId,
      external_id: payload.vapiCallId,
      direction: payload.direction,
      duration_seconds: payload.durationSeconds,
      ended_reason: payload.endedReason,
      success_evaluation: payload.successEvaluation,
      summary: payload.summary,
      recording_url: payload.recordingUrl,
      assistant_id: payload.assistantId,
      org_number: payload.orgNumber,
      customer_number: payload.customerNumber,
      customer_name: payload.customerName,
    }

    const dispatchId = await recordDispatch(
      supabase,
      orgId,
      payload.callId,
      { event: VAPI_CALL_ENDED_EVENT, ...call, phone_number_id: payload.phoneNumberId } as Json,
      matched.map((m) => m.id),
      depth,
      options.parentDispatchId ?? null,
    )

    const triggerInput: Record<string, unknown> = {
      call,
      phone,
      contact,
      event: VAPI_CALL_ENDED_EVENT,
      from_number: payload.customerNumber,
      to_number: payload.orgNumber,
    }

    // Resume runs suspended on a wait node this call satisfies.
    const callContactId =
      (contact as { id?: unknown } | null)?.id != null
        ? String((contact as { id?: unknown }).id)
        : null
    void resumeMatchingWaits(supabase, {
      orgId,
      eventType: VAPI_CALL_ENDED_EVENT,
      contactId: callContactId,
      payload: triggerInput,
    }).catch((err) => {
      console.error('[vapi/events] resumeMatchingWaits error:', err)
    })

    if (matched.length === 0) {
      return { dispatched: 0, dispatch_id: dispatchId }
    }

    const versionIds = matched
      .map((m) => m.current_version_id)
      .filter((id): id is string => Boolean(id))

    if (versionIds.length === 0) {
      return { dispatched: 0, dispatch_id: dispatchId }
    }

    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)

    const defById = new Map<string, unknown>()
    for (const v of versions ?? []) {
      defById.set(v.id as string, v.definition)
    }

    for (const wf of matched) {
      const definition = wf.current_version_id ? defById.get(wf.current_version_id) : null
      if (!definition) continue
      if (definitionHasWait(definition)) {
        void runFlow({
          workflowId: wf.id,
          versionId: wf.current_version_id ?? null,
          definition: definition as FlowDefinition,
          orgId,
          triggerType: 'event',
          triggerPayload: triggerInput,
          supabase,
        }).catch((err) => {
          console.error('[vapi/events] runFlow error:', err)
        })
      } else {
        void runFlowSync({
          workflowId: wf.id,
          definition,
          triggerInput,
          context: { orgId },
        }).catch((err) => {
          console.error('[vapi/events] runFlowSync error:', err)
        })
      }
    }

    return { dispatched: matched.length, dispatch_id: dispatchId }
  } catch (err) {
    console.error('[vapi/events] emit error (swallowed):', err)
    return { dispatched: 0, dispatch_id: null }
  }
}
