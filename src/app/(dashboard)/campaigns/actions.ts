'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CampaignChannel, CampaignType, Json, Database } from '@/types/database'

type CampaignRow = Database['public']['Tables']['campaigns']['Row']
type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']
type CampaignRecipientRow = Database['public']['Tables']['campaign_recipients']['Row']

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string
  description?: string | null
  channel: CampaignChannel
  campaign_type?: CampaignType
  // Voice-specific
  vapi_assistant_id?: string | null
  vapi_phone_number_id?: string | null
  calls_per_minute?: number
  // SMS-specific
  sms_body?: string | null
  // WhatsApp Cloud (Meta) specific
  whatsapp_template_id?: string | null
  whatsapp_variable_mapping?: Record<string, unknown> | null
  // Email-specific (builder template selection, UFE-12)
  email_template_id?: string | null
  // Audience
  audience_filter?: Record<string, unknown>
  // Schedule
  scheduled_start_at?: string | null
}

export interface CampaignMetrics {
  total: number
  sent: number
  delivered: number
  failed: number
  pending: number
  // Voice-specific
  completed_calls: number
  no_answer: number
  calling: number
}

// ─── createCampaign ───────────────────────────────────────────────────────────

export async function createCampaign(
  input: CreateCampaignInput
): Promise<{ id: string }> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) throw new Error('No organization found for user')

  // Validate channel integration availability before creating.
  // NOTE: WhatsApp campaigns are EXCLUSIVE to the official Meta Cloud API
  // — non-official providers (Evolution/Z-API/W-API) are for inbox only.
  const [integRes, resendRes, whatsappCloudRes] = await Promise.all([
    supabase.from('integrations').select('provider').eq('is_active', true),
    input.channel === 'email'
      ? supabase.from('tenant_email_integrations').select('id').eq('status', 'connected').limit(1)
      : Promise.resolve({ data: null }),
    input.channel === 'whatsapp'
      ? supabase.from('whatsapp_cloud_accounts').select('id').eq('status', 'connected').eq('is_active', true).limit(1)
      : Promise.resolve({ data: null }),
  ])
  const providers = new Set((integRes.data ?? []).map((i) => i.provider))
  if ((input.channel === 'calls' || input.channel === 'sms') && !providers.has('twilio')) {
    throw new Error(`Twilio is not connected. Set up Twilio to create ${input.channel} campaigns.`)
  }
  if (input.channel === 'email' && (resendRes.data ?? []).length === 0) {
    throw new Error('Email integration is not connected. Set up Resend to create email campaigns.')
  }
  if (input.channel === 'whatsapp' && (whatsappCloudRes.data ?? []).length === 0) {
    throw new Error(
      'WhatsApp campaigns require the official Meta Cloud integration. Connect it in Integrations → WhatsApp Official.',
    )
  }

  // For WhatsApp campaigns, also validate the chosen template exists and is APPROVED.
  if (input.channel === 'whatsapp') {
    if (!input.whatsapp_template_id) {
      throw new Error('Select an approved WhatsApp template for this campaign.')
    }
    const { data: template } = await supabase
      .from('whatsapp_templates')
      .select('id, status')
      .eq('id', input.whatsapp_template_id)
      .maybeSingle()
    if (!template) throw new Error('Selected template not found.')
    if (template.status !== 'APPROVED') {
      throw new Error(`Selected template is ${template.status} — only APPROVED templates can be used.`)
    }
  }

  // For email campaigns, validate the chosen builder template exists, is
  // org-scoped (RLS), and is published.
  if (input.channel === 'email') {
    if (!input.email_template_id) {
      throw new Error('Select a published email template for this campaign.')
    }
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('id, status')
      .eq('id', input.email_template_id)
      .maybeSingle()
    if (!tpl) throw new Error('Selected email template not found.')
    if (tpl.status !== 'published') {
      throw new Error('Selected email template is not published. Publish it first.')
    }
  }

  const templateConfig: Json =
    input.channel === 'sms' && input.sms_body
      ? ({ sms_body: input.sms_body } as Json)
      : input.channel === 'email' && input.email_template_id
      ? ({ email_template_id: input.email_template_id } as Json)
      : ({} as Json)

  const audienceFilter: Json = (input.audience_filter ?? {}) as unknown as Json

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      description: input.description ?? null,
      channel: input.channel,
      campaign_type: input.campaign_type ?? 'one_time',
      vapi_assistant_id: input.vapi_assistant_id ?? null,
      vapi_phone_number_id: input.vapi_phone_number_id ?? null,
      calls_per_minute: input.calls_per_minute ?? 5,
      audience_filter: audienceFilter,
      template_config: templateConfig,
      sms_body: input.sms_body ?? null,
      whatsapp_template_id: input.whatsapp_template_id ?? null,
      whatsapp_variable_mapping:
        (input.whatsapp_variable_mapping as unknown as Json | null) ?? null,
      status: 'draft' as const,
      scheduled_start_at: input.scheduled_start_at ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/campaigns')
  return { id: data.id }
}

// ─── listCampaignEmailTemplates (UFE-12) ────────────────────────────────────────

/** Published builder email templates for the active org (campaign picker source). */
export async function listCampaignEmailTemplates(): Promise<
  Array<{ id: string; name: string }>
> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('email_templates')
    .select('id, name, status')
    .eq('status', 'published')
    .order('name', { ascending: true })
  return (data ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))
}

// ─── launchCampaign — REMOVED ─────────────────────────────────────────────────
//
// This action only flipped `status` to running/in_progress without dispatching
// anything, so launching a WhatsApp/email/SMS campaign reported success while
// nothing was ever queued. Every launch now goes through
// POST /api/campaigns/[id]/start, which branches per channel and calls the real
// dispatcher (or fails loudly for channels that have none). Do not reintroduce
// a status-only launch path.

// ─── pauseCampaign ────────────────────────────────────────────────────────────

export async function pauseCampaign(id: string): Promise<void> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'paused' as const, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['in_progress', 'running'])

  if (error) throw new Error(error.message)
  revalidatePath('/campaigns')
  revalidatePath(`/campaigns/${id}`)
}

// ─── cancelCampaign ───────────────────────────────────────────────────────────

export async function cancelCampaign(id: string): Promise<void> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'stopped' as const, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['draft', 'scheduled', 'in_progress', 'running', 'paused'])

  if (error) throw new Error(error.message)
  revalidatePath('/campaigns')
  revalidatePath(`/campaigns/${id}`)
}

// ─── getCampaigns ─────────────────────────────────────────────────────────────

export interface CampaignListItem {
  id: string
  organization_id: string
  name: string
  description: string | null
  channel: string
  campaign_type: string
  status: string
  scheduled_start_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  // Contact metrics (voice campaigns)
  total_contacts: number
  pending_contacts: number
  completed_contacts: number
  failed_contacts: number
}

export async function getCampaigns(channel?: string): Promise<CampaignListItem[]> {
  const supabase = await createClient()

  let query = supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })

  if (channel && channel !== 'all') {
    query = query.eq('channel', channel as CampaignChannel)
  }

  const { data: campaigns, error } = await query
  if (error) {
    console.error('[campaigns:getCampaigns] failed to load', error)
    return []
  }
  if (!campaigns || campaigns.length === 0) return []

  // Narrow the contacts fetch to only the campaigns being listed (bounded by
  // the channel filter above) instead of every campaign_contacts row in the
  // org, then aggregate counts in a single pass (SEED-048 Phase D).
  const campaignIds = campaigns.map((c) => c.id)
  const { data: allContacts } = await supabase
    .from('campaign_contacts')
    .select('campaign_id, status')
    .in('campaign_id', campaignIds)

  const contactsByCampaign = new Map<
    string,
    { total: number; pending: number; completed: number; failed: number }
  >()
  for (const cc of allContacts ?? []) {
    const bucket = contactsByCampaign.get(cc.campaign_id) ?? {
      total: 0,
      pending: 0,
      completed: 0,
      failed: 0,
    }
    bucket.total++
    if (cc.status === 'pending') bucket.pending++
    else if (cc.status === 'completed') bucket.completed++
    else if (cc.status === 'failed') bucket.failed++
    contactsByCampaign.set(cc.campaign_id, bucket)
  }

  return campaigns.map((c) => {
    const bucket = contactsByCampaign.get(c.id) ?? {
      total: 0,
      pending: 0,
      completed: 0,
      failed: 0,
    }
    return {
      ...c,
      channel: c.channel ?? 'calls',
      campaign_type: c.campaign_type ?? 'one_time',
      description: c.description ?? null,
      started_at: c.started_at ?? null,
      completed_at: c.completed_at ?? null,
      total_contacts: bucket.total,
      pending_contacts: bucket.pending,
      completed_contacts: bucket.completed,
      failed_contacts: bucket.failed,
    }
  })
}

// ─── getCampaignMetrics ───────────────────────────────────────────────────────

export async function getCampaignMetrics(id: string): Promise<CampaignMetrics> {
  const supabase = await createClient()

  const [contactsRes, recipientsRes] = await Promise.all([
    supabase
      .from('campaign_contacts')
      .select('status')
      .eq('campaign_id', id),
    supabase
      .from('campaign_recipients')
      .select('status')
      .eq('campaign_id', id),
  ])

  const contacts = contactsRes.data ?? []
  const recipients = recipientsRes.data ?? []

  // Voice call metrics
  const completed_calls = contacts.filter((c) => c.status === 'completed').length
  const no_answer = contacts.filter((c) => c.status === 'no_answer').length
  const calling = contacts.filter((c) => c.status === 'calling').length
  const voice_failed = contacts.filter((c) => c.status === 'failed').length
  const voice_pending = contacts.filter((c) => c.status === 'pending').length

  // SMS/email/whatsapp metrics from campaign_recipients
  const sent = recipients.filter((r) => r.status === 'sent').length
  const delivered = recipients.filter((r) => r.status === 'delivered').length
  const rec_failed = recipients.filter((r) => r.status === 'failed').length
  const rec_pending = recipients.filter((r) => r.status === 'pending').length

  const total = contacts.length + recipients.length

  return {
    total,
    sent: sent + completed_calls,
    delivered: delivered + completed_calls,
    failed: voice_failed + rec_failed,
    pending: voice_pending + rec_pending,
    completed_calls,
    no_answer,
    calling,
  }
}

// ─── getCampaignDetail ────────────────────────────────────────────────────────

export interface CampaignDetail {
  campaign: CampaignRow
  contacts: CampaignContactRow[]
  recipients: CampaignRecipientRow[]
}

export async function getCampaignDetail(id: string): Promise<CampaignDetail> {
  const supabase = await createClient()

  const [campaignRes, contactsRes, recipientsRes] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', id).single(),
    supabase
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('campaign_recipients')
      .select('*')
      .eq('campaign_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (campaignRes.error) throw new Error(campaignRes.error.message)

  return {
    campaign: campaignRes.data,
    contacts: contactsRes.data ?? [],
    recipients: recipientsRes.data ?? [],
  }
}
