// src/app/api/vapi/campaigns/route.ts
// Node.js Route Handler | receives Vapi end-of-call-report for outbound campaign calls.
// Handles BOTH the campaign_contacts status update AND full call persistence into
// `calls` (transcript, recording, cost, success evaluation). /api/vapi/calls/route.ts
// does the same in the opposite order — see src/lib/vapi/end-of-call.ts for the
// shared, idempotent logic both routes call. Register whichever URL you like as
// the Vapi assistant/phone-number's server URL; either keeps the platform's call
// data (calls table) and campaign progress (campaign_contacts) in sync.

import { after } from 'next/server'
import { VapiEndOfCallMessageSchema } from '@/types/vapi'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { persistCallRecord, updateCampaignContactFromReport, getCampaignContactId } from '@/lib/vapi/end-of-call'
import { buildVapiCallEventPayload, emitVapiCallEndedEvent } from '@/lib/vapi/events'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/campaigns' })

export async function POST(request: Request): Promise<Response> {
  try {
    if (!verifyVapiSecret(request)) {
      obs.warn('vapi_secret_rejected')
      return new Response(null, { status: 200 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(null, { status: 200 })
    }

    const parsed = VapiEndOfCallMessageSchema.safeParse(body)
    if (!parsed.success || parsed.data.message.type !== 'end-of-call-report') {
      return new Response(null, { status: 200 })
    }

    const message = parsed.data.message

    // Only handle outbound campaign calls here.
    if (message.call?.type !== 'outboundPhoneCall') {
      return new Response(null, { status: 200 })
    }

    const campaignContactId = getCampaignContactId(message)
    if (!campaignContactId) {
      return new Response(null, { status: 200 })
    }

    after(async () => {
      const supabase = createServiceRoleClient()
      await updateCampaignContactFromReport(
        {
          campaignContactId,
          vapiCallId: message.call?.id ?? null,
          endedReason: message.endedReason ?? null,
        },
        supabase,
      )

      // Also persist the full call record | idempotent insert keyed on
      // vapi_call_id, so this is safe even if /api/vapi/calls also received
      // (and already persisted) the same report.
      const result = await persistCallRecord(message, supabase)
      if (!result.organizationId) {
        obs.warn('vapi_no_assistant_mapping', { assistantId: message.call?.assistantId })
        return
      }

      // Same gate as /api/vapi/calls: only the route that actually won the
      // insert emits, so a report reaching both routes fires workflows once.
      if (result.inserted && result.callId) {
        await emitVapiCallEndedEvent(
          result.organizationId,
          buildVapiCallEventPayload(message, {
            callId: result.callId,
            phoneNumberId: result.phoneNumberId,
          }),
          { supabase },
        )
      }
    })

    return new Response(null, { status: 200 })
  } catch (err) {
    obs.error('vapi_campaigns_unexpected_error', { error: err })
    return new Response(null, { status: 200 })
  }
}
