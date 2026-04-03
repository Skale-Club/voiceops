// src/lib/campaigns/engine.ts
// Campaign execution engine — fires individual Vapi calls per contact.
// Used by the /api/campaigns/[id]/start server action.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, CampaignContactStatus } from '@/types/database'
import { createOutboundCall } from '@/lib/campaigns/outbound'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

export function mapEndedReasonToStatus(reason: string | null | undefined): CampaignContactStatus {
  if (!reason) return 'failed'
  if (['customer-ended-call', 'assistant-ended-call', 'exceeded-max-duration'].includes(reason)) {
    return 'completed'
  }
  if (['customer-did-not-answer', 'customer-busy', 'voicemail'].includes(reason)) {
    return 'no_answer'
  }
  return 'failed'
}

export async function startCampaignBatch(
  campaignId: string,
  supabase: SupabaseClient<Database>
): Promise<{ fired: number; errors: number }> {
  // Fetch campaign — verify it is still in_progress (optimistic guard)
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('id, organization_id, status, vapi_assistant_id, vapi_phone_number_id, calls_per_minute')
    .eq('id', campaignId)
    .single()

  if (campaignErr || !campaign) {
    console.error('[engine] Campaign not found:', campaignId, campaignErr?.message)
    return { fired: 0, errors: 0 }
  }

  if (campaign.status !== 'in_progress') {
    console.log('[engine] Campaign not in_progress, skipping batch. status:', campaign.status)
    return { fired: 0, errors: 0 }
  }

  // Fetch pending contacts up to concurrency limit
  const batchSize = Math.min(campaign.calls_per_minute, 10) // hard cap at 10
  const { data: contacts, error: contactsErr } = await supabase
    .from('campaign_contacts')
    .select('id, phone, name, custom_data')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .limit(batchSize)

  if (contactsErr) {
    console.error('[engine] Failed to fetch contacts:', contactsErr.message)
    return { fired: 0, errors: 0 }
  }
  if (!contacts || contacts.length === 0) {
    // No more pending — check if campaign is complete
    await checkAndCompleteCampaign(campaignId, supabase)
    return { fired: 0, errors: 0 }
  }

  // Fire calls concurrently (Promise.allSettled — partial failure is acceptable)
  const results = await Promise.allSettled(
    contacts.map((contact) =>
      fireContactCall(contact as CampaignContactRow, campaign, supabase)
    )
  )

  const fired = results.filter((r) => r.status === 'fulfilled').length
  const errors = results.filter((r) => r.status === 'rejected').length
  return { fired, errors }
}

async function fireContactCall(
  contact: Pick<CampaignContactRow, 'id' | 'phone' | 'name' | 'custom_data'>,
  campaign: {
    id: string
    organization_id: string
    vapi_assistant_id: string
    vapi_phone_number_id: string
  },
  supabase: SupabaseClient<Database>
): Promise<void> {
  try {
    const { vapiCallId } = await createOutboundCall({
      contactId: contact.id,
      campaignId: campaign.id,
      phone: contact.phone,
      name: contact.name,
      assistantId: campaign.vapi_assistant_id,
      phoneNumberId: campaign.vapi_phone_number_id,
      customData: (contact.custom_data as Record<string, string>) ?? {},
    })

    await supabase
      .from('campaign_contacts')
      .update({
        status: 'calling',
        vapi_call_id: vapiCallId,
        called_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[engine] Call failed for contact', contact.id, ':', msg)
    await supabase
      .from('campaign_contacts')
      .update({
        status: 'failed',
        error_detail: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
    throw err
  }
}

async function checkAndCompleteCampaign(
  campaignId: string,
  supabase: SupabaseClient<Database>
): Promise<void> {
  // Count contacts still in pending or calling state
  const { count } = await supabase
    .from('campaign_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'calling'])

  if (count === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'in_progress') // optimistic lock
  }
}
