// src/app/api/vapi/campaigns/route.ts
// Edge Function — receives Vapi end-of-call-report for outbound campaign calls.
// Pattern mirrors /api/vapi/calls/route.ts — always returns 200, async DB write.
// Register this URL on the Vapi assistant or phone number used for campaigns
// as the server URL for end-of-call-report events.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { mapEndedReasonToStatus } from '@/lib/campaigns/engine'

export const runtime = 'edge'

async function updateContactStatus(
  campaignContactId: string,
  call: { id?: string; endedReason?: string }
): Promise<void> {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const status = mapEndedReasonToStatus(call.endedReason)
  const isTerminal = status !== 'calling' && status !== 'pending'

  const { data: contact } = await supabase
    .from('campaign_contacts')
    .update({
      status,
      vapi_call_id: call.id ?? null,
      error_detail: status === 'failed' ? (call.endedReason ?? 'unknown') : null,
      completed_at: isTerminal ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignContactId)
    .select('campaign_id')
    .single()

  if (!contact?.campaign_id) return

  // Check if all contacts are done — auto-complete campaign
  const { count } = await supabase
    .from('campaign_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', contact.campaign_id)
    .in('status', ['pending', 'calling'])

  if (count === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', contact.campaign_id)
      .eq('status', 'in_progress')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(null, { status: 200 })
    }

    const payload = body as Record<string, unknown>

    // Only handle end-of-call-report for outbound campaign calls
    if (payload?.type !== 'end-of-call-report') {
      return new Response(null, { status: 200 })
    }

    const call = payload?.call as Record<string, unknown> | undefined
    if (call?.type !== 'outboundPhoneCall') {
      return new Response(null, { status: 200 })
    }

    const metadata = call?.metadata as Record<string, unknown> | undefined
    const campaignContactId = metadata?.campaign_contact_id as string | undefined
    if (!campaignContactId) {
      return new Response(null, { status: 200 })
    }

    // @ts-ignore — EdgeRuntime available in Edge Function context
    EdgeRuntime.waitUntil(
      updateContactStatus(campaignContactId, {
        id: call?.id as string | undefined,
        endedReason: (payload?.endedReason as string | undefined) ?? (call?.endedReason as string | undefined),
      })
    )

    return new Response(null, { status: 200 })
  } catch (err) {
    console.error('[vapi/campaigns] Unexpected error:', err)
    return new Response(null, { status: 200 })
  }
}
