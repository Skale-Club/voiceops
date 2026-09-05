// src/app/api/vapi/calls/route.ts
// Node.js Route Handler | receives Vapi end-of-call-report webhook after a call ends.
// Handles BOTH inbound AI calls and outbound campaign calls: whichever URL is
// registered as the assistant/phone-number's server URL, this route persists the
// call record AND (when call.metadata carries a campaign_contact_id) updates the
// originating campaign_contacts row. /api/vapi/campaigns/route.ts does the same
// in the opposite order — see src/lib/vapi/end-of-call.ts for the shared,
// idempotent logic both routes call.

import { after } from 'next/server'
import { VapiEndOfCallMessageSchema, VapiStatusUpdateMessageSchema } from '@/types/vapi'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { memoTtl } from '@/lib/cache/ttl-memo'
import { resolveOrgForCall } from '@/lib/vapi/end-of-call'
import { warmCustomerLookup } from '@/lib/vapi/customer-lookup-cache'
import { persistCallRecord, updateCampaignContactFromReport, getCampaignContactId } from '@/lib/vapi/end-of-call'
import { buildVapiCallEventPayload, emitVapiCallEndedEvent } from '@/lib/vapi/events'
import { log } from '@/lib/logger'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/calls' })

export async function POST(request: Request): Promise<Response> {
  const webhookStart = Date.now()
  void log({
    event_type: 'webhook.received',
    source: 'vapi-webhook',
    severity: 'info',
    status: 'ok',
    actor_type: 'webhook',
    payload: { endpoint: '/api/vapi/calls' },
  })

  try {
    if (!verifyVapiSecret(request)) {
      obs.warn('vapi_secret_rejected')
      void log({
        event_type: 'webhook.rejected',
        source: 'vapi-webhook',
        severity: 'warn',
        status: 'failed',
        actor_type: 'webhook',
        error_message: 'Invalid or missing X-Vapi-Secret',
        duration_ms: Date.now() - webhookStart,
        payload: { endpoint: '/api/vapi/calls' },
      })
      return new Response(null, { status: 200 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(null, { status: 200 })
    }

    // Call answered: start the customer lookup now, keyed the way the tool
    // route reads it, so the robot's first reply is not waiting on the
    // provider. Fire-and-forget after the response; never affects the 200.
    const statusUpdate = VapiStatusUpdateMessageSchema.safeParse(body)
    if (statusUpdate.success) {
      const su = statusUpdate.data.message
      const number = su.call?.customer?.number
      if (su.status === 'in-progress' && number && su.call) {
        const callIdentity = { assistantId: su.call.assistantId, phoneNumberId: su.call.phoneNumberId }
        after(async () => {
          const supabase = createServiceRoleClient()
          const { organizationId } = await memoTtl(
            `vapi:org:${callIdentity.assistantId ?? ''}:${callIdentity.phoneNumberId ?? ''}`,
            30_000,
            () => resolveOrgForCall(callIdentity, supabase)
          )
          if (organizationId) await warmCustomerLookup(organizationId, number, supabase)
        })
      }
      return new Response(null, { status: 200 })
    }

    const parsed = VapiEndOfCallMessageSchema.safeParse(body)
    if (!parsed.success || parsed.data.message.type !== 'end-of-call-report') {
      return new Response(null, { status: 200 })
    }

    const message = parsed.data.message
    const vapiCallId = message.call?.id
    if (!vapiCallId) {
      obs.warn('vapi_missing_call_id')
      return new Response(null, { status: 200 })
    }

    // Heavy lifting (DB writes, notification fan-out) happens after the response
    // is flushed | Vapi fires-and-forgets and doesn't wait on this.
    after(async () => {
      const supabase = createServiceRoleClient()
      const result = await persistCallRecord(message, supabase)

      void log({
        event_type: 'call.ingested',
        source: 'vapi-webhook',
        severity: result.inserted ? 'info' : 'error',
        status: result.inserted ? 'ok' : 'failed',
        org_id: result.organizationId ?? undefined,
        actor_type: 'webhook',
        actor_id: vapiCallId,
        duration_ms: Date.now() - webhookStart,
        payload: {
          vapi_call_id: vapiCallId,
          ended_reason: result.endedReason,
          call_type: message.call?.type ?? null,
        },
      })

      // Fire the `vapi.call.ended` workflow trigger. Gated on `inserted` so a
      // Vapi retry — or the same report landing on /api/vapi/campaigns too —
      // can't run the workflow twice: the duplicate insert is rejected by the
      // vapi_call_id UNIQUE index, which is the same signal.
      if (result.inserted && result.organizationId && result.callId) {
        await emitVapiCallEndedEvent(
          result.organizationId,
          buildVapiCallEventPayload(message, {
            callId: result.callId,
            phoneNumberId: result.phoneNumberId,
          }),
          { supabase },
        )
      }

      // Outbound campaign calls can land on this route if the assistant's server
      // URL points here instead of /api/vapi/campaigns — keep campaign_contacts
      // in sync either way. Safe to run even if /api/vapi/campaigns also handles
      // the same report: this is a plain status update, not an insert.
      const campaignContactId = getCampaignContactId(message)
      if (campaignContactId) {
        await updateCampaignContactFromReport(
          { campaignContactId, vapiCallId, endedReason: message.endedReason ?? null },
          supabase,
        )
      }
    })

    return new Response(null, { status: 200 })
  } catch (err) {
    obs.error('vapi_calls_unexpected_error', { error: err })
    return new Response(null, { status: 200 })
  }
}
