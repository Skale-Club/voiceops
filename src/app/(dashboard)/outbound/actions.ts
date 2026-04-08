'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import type { Database, CampaignStatus } from '@/types/database'

type CampaignRow = Database['public']['Tables']['campaigns']['Row']
type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

// ─── createCampaign ────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string
  vapi_assistant_id: string
  vapi_phone_number_id: string
  scheduled_start_at?: string | null
  calls_per_minute?: number
}

export async function createCampaign(
  input: CreateCampaignInput
): Promise<{ id: string }> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  // Get org id from session
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) throw new Error('No organization found for user')

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      vapi_assistant_id: input.vapi_assistant_id,
      vapi_phone_number_id: input.vapi_phone_number_id,
      scheduled_start_at: input.scheduled_start_at ?? null,
      calls_per_minute: input.calls_per_minute ?? 5,
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/phone')
  return { id: data.id }
}

// ─── getCampaigns ─────────────────────────────────────────────────────────────

export interface CampaignListItem extends CampaignRow {
  total_contacts: number
  pending_contacts: number
  completed_contacts: number
  failed_contacts: number
}

export async function getCampaigns(): Promise<CampaignListItem[]> {
  const supabase = await createClient()

  // Fetch campaigns and contacts in parallel
  const [campaignsRes, contactsRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('campaign_contacts')
      .select('campaign_id, status'),
  ])

  if (campaignsRes.error) throw new Error(campaignsRes.error.message)

  const campaigns = campaignsRes.data ?? []
  const allContacts = contactsRes.data ?? []

  return campaigns.map((c) => {
    const contacts = allContacts.filter((cc) => cc.campaign_id === c.id)
    return {
      ...c,
      total_contacts: contacts.length,
      pending_contacts: contacts.filter((cc) => cc.status === 'pending').length,
      completed_contacts: contacts.filter((cc) => cc.status === 'completed').length,
      failed_contacts: contacts.filter((cc) => cc.status === 'failed').length,
    }
  })
}

// ─── getCampaignDetail ────────────────────────────────────────────────────────

export interface CampaignDetail {
  campaign: CampaignRow
  contacts: CampaignContactRow[]
}

export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail> {
  const supabase = await createClient()

  const [campaignRes, contactsRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single(),
    supabase
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true }),
  ])

  if (campaignRes.error) throw new Error(campaignRes.error.message)

  return {
    campaign: campaignRes.data,
    contacts: contactsRes.data ?? [],
  }
}

// ─── importContacts ───────────────────────────────────────────────────────────

export interface ImportContactsInput {
  campaignId: string
  contacts: Array<{
    name: string
    phone: string
    custom_data?: Record<string, string>
  }>
}

export async function importContacts(
  input: ImportContactsInput
): Promise<{ imported: number; duplicates: number }> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) throw new Error('No organization found for user')

  // Verify campaign belongs to this org
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', input.campaignId)
    .single()
  if (!campaign) throw new Error('Campaign not found')

  // Batch insert — use service-role to bypass RLS for upsert
  // UNIQUE(campaign_id, phone) enforces deduplication at DB level
  const serviceClient = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const rows = input.contacts.map((c) => ({
    campaign_id: input.campaignId,
    organization_id: orgId,
    name: c.name,
    phone: c.phone,
    custom_data: c.custom_data ?? {},
  }))

  // Insert with ignoreDuplicates to handle UNIQUE constraint gracefully
  const { data, error } = await serviceClient
    .from('campaign_contacts')
    .insert(rows, { count: 'exact' })
    .select('id')

  // Code 23505 = unique_violation — count duplicates by difference
  if (error && error.code !== '23505') throw new Error(error.message)

  const imported = data?.length ?? 0
  const duplicates = rows.length - imported

  revalidatePath(`/outbound/${input.campaignId}`)
  return { imported, duplicates }
}

// ─── deleteCampaign ───────────────────────────────────────────────────────────

export async function deleteCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', campaignId)
    .in('status', ['draft', 'completed', 'stopped']) // cannot delete active campaigns

  if (error) throw new Error(error.message)
  revalidatePath('/phone')
}
