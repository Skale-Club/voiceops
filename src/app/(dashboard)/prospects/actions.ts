'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getRbacContext } from '@/lib/rbac/server'
import { isDemoSession, DEMO_READONLY_MESSAGE } from '@/lib/demo/guard'
import { parseCsv } from '@/lib/contacts/csv'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { normalizePhoneToE164 } from '@/lib/phone-numbers/normalize'
import { isXmailConfigured, xmailBulkImportLeads, type XmailLead } from '@/lib/xmail/client'
import { loadWebsiteInsightsForAccounts } from '@/lib/xmail/website-insights'
import { loadSourceRunIdsForEntities } from '@/lib/xmail/source-runs'
import { isXpotConfigured, xpotSendLeads, type XpotLead } from '@/lib/xpot/client'
import { generatePreviewForAnalysis } from '@/services/website-analyzer'
import { resolveLatestAnalysisForDisplay, type AnalysisRowStatus } from '@/services/website-analyzer/display'
import {
  resolveProspectRecipients,
  applyNameToken,
  type ProspectSourceRecord,
} from '@/lib/prospects/recipients'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { sendCloudTemplate } from '@/lib/whatsapp/cloud/send-template'
import { resolveActiveProvider } from '@/lib/whatsapp/resolve-provider'
import { sendWhatsAppMessage } from '@/lib/whatsapp/send'
import { checkDnd } from '@/lib/dnd'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { qualifyProspectWithLlm, type WebsiteSignals } from '@/lib/prospects/qualify-llm'
import {
  zernioBodyComponent,
  zernioTemplateBodyVarCount,
  zernioTemplateHeaderVarCount,
  resolveZernioProfileId,
  sendZernioWhatsappTemplate,
  type ZernioWhatsappTemplate,
} from '@/lib/zernio/whatsapp-templates'
import type {
  CrmEngagementStatus,
  CrmIntentLevel,
  CrmQualificationStatus,
  CrmRecommendedChannel,
  Database,
  EmailRisk,
  EmailStatus,
  Json,
  ProspectEntityType,
} from '@/types/database'

export type ProspectKind = 'person' | 'company'

export type ProspectRow = {
  id: string
  kind: ProspectKind
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  website: string | null
  city: string | null
  source: string
  sourceType: string | null
  sourceId: string | null
  engagementStatus: CrmEngagementStatus
  intentLevel: CrmIntentLevel
  qualificationStatus: CrmQualificationStatus
  recommendedChannel: CrmRecommendedChannel | null
  score: number
  lastContactedAt: string | null
  lastRepliedAt: string | null
  createdAt: string
  updatedAt: string
  tags: string[]
  /** Migration 1264/1265: email verification cache surfaced via prospect_rows. */
  emailStatus: EmailStatus | null
  emailVerifiedAt: string | null
  emailVerificationProvider: string | null
  emailRisk: EmailRisk | null
}

export type ProspectListResult =
  | { ok: true; rows: ProspectRow[]; total: number }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectSort = 'recent' | 'score' | 'name'

/** 'unverified' is a sentinel for "email_status IS NULL" — not a real EmailStatus value. */
export type ProspectEmailFilter = EmailStatus | 'unverified'
export type ProspectChannelFilter = CrmRecommendedChannel | 'has_phone'

export type ProspectFilters = {
  q?: string
  kind?: 'all' | ProspectKind
  engagement?: CrmEngagementStatus
  intent?: CrmIntentLevel
  qualification?: CrmQualificationStatus
  city?: string
  listId?: string
  sort?: ProspectSort
  page?: number
  pageSize?: number
  /** Filter by email verification status. See ProspectEmailFilter for the 'unverified' sentinel. */
  emailStatus?: ProspectEmailFilter
  /** Filter by outreach channel. 'has_phone' is a sentinel for "reachable by phone at all". */
  channel?: ProspectChannelFilter
}

export type ProspectsPageResult =
  | {
      ok: true
      rows: ProspectRow[]
      total: number
      page: number
      pageSize: number
      lists: { id: string; name: string }[]
    }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectRef = { kind: ProspectKind; id: string }
export type BulkResult =
  | { ok: true; affected: number }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectActionResult =
  | { ok: true }
  | { ok: false; error: string; forbidden?: boolean }

export type ProspectImportResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string; forbidden?: boolean }

async function requireProspectsAdmin(): Promise<ProspectActionResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated', forbidden: true }

  const ctx = await getRbacContext()
  if (ctx.isPlatformAdmin || ctx.role === 'owner' || ctx.role === 'admin') {
    return { ok: true }
  }

  return { ok: false, error: 'Prospects are available to workspace admins only.', forbidden: true }
}

function contactName(row: {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
}): string | null {
  const composed = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return composed || row.name?.trim() || null
}

/** Google Maps / xcraper enrichment stores city + state (or country) in `custom_fields`. */
function extractLocation(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null
  const cf = customFields as Record<string, unknown>
  const city = typeof cf.city === 'string' ? cf.city.trim() : ''
  const state = typeof cf.state === 'string' ? cf.state.trim() : ''
  return [city, state].filter(Boolean).join(', ') || null
}

/**
 * Reads from the `prospect_rows` view (migration 1247), which unions
 * prospect-stage `contacts` + `accounts` at the database level with
 * `security_invoker = true` — RLS on the base tables still applies, so this
 * never needs (and must never add) a manual org_id filter. Sorting and
 * pagination happen in Postgres via `.order()` + `.range()` with
 * `{ count: 'exact' }`, replacing the old fetch-1000-per-table-then-merge-in-
 * memory approach that didn't scale for multi-country scraping.
 */
export async function getProspects(filters: ProspectFilters = {}): Promise<ProspectsPageResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()

  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25))
  const kind = filters.kind ?? 'all'
  const q = (filters.q ?? '').trim()
  // Strip characters that would break PostgREST's `or(...)` filter grammar.
  const safeQ = q.replace(/[,()%]/g, ' ').trim()
  const city = (filters.city ?? '').trim()
  const safeCity = city.replace(/[,()%]/g, ' ').trim()

  const NONE = '00000000-0000-0000-0000-000000000000'

  // List-membership filter → restrict the view to the ids in that list.
  // prospect_list_members rows point at either contact_id or account_id;
  // since both are UUIDs from independent tables, combining them into one
  // `.in('id', ...)` against the unified view's id column is safe (no
  // realistic collision) and matches what the view's `id` column represents.
  let listIds: string[] | null = null
  if (filters.listId) {
    const { data: members } = await supabase
      .from('prospect_list_members')
      .select('contact_id, account_id')
      .eq('list_id', filters.listId)
    listIds = []
    for (const m of (members ?? []) as Array<{ contact_id: string | null; account_id: string | null }>) {
      if (m.contact_id) listIds.push(m.contact_id)
      if (m.account_id) listIds.push(m.account_id)
    }
  }

  let query = supabase.from('prospect_rows').select('*', { count: 'exact' })

  if (kind !== 'all') query = query.eq('kind', kind)
  if (filters.engagement) query = query.eq('engagement_status', filters.engagement)
  if (filters.intent) query = query.eq('intent_level', filters.intent)
  if (filters.qualification) query = query.eq('qualification_status', filters.qualification)
  if (filters.emailStatus === 'unverified') query = query.is('email_status', null)
  else if (filters.emailStatus) query = query.eq('email_status', filters.emailStatus)
  // `has_phone` is deliberately broader than channel === 'call': it answers
  // "who can we reach by phone at all", including prospects whose recommended
  // channel is email but who also left a number.
  if (filters.channel === 'has_phone') query = query.not('phone', 'is', null).neq('phone', '')
  else if (filters.channel) query = query.eq('recommended_channel', filters.channel)
  if (safeCity) query = query.ilike('city', `%${safeCity}%`)
  if (safeQ)
    query = query.or(
      `name.ilike.%${safeQ}%,email.ilike.%${safeQ}%,company.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,domain.ilike.%${safeQ}%`,
    )
  if (listIds) query = query.in('id', listIds.length ? listIds : [NONE])

  const sort = filters.sort ?? 'recent'
  if (sort === 'score') {
    query = query.order('score', { ascending: false }).order('created_at', { ascending: false })
  } else if (sort === 'name') {
    query = query.order('name', { ascending: true })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const start = (page - 1) * pageSize
  query = query.range(start, start + pageSize - 1)

  const [{ data, count, error }, listsResult] = await Promise.all([
    query,
    supabase.from('prospect_lists').select('id, name').order('name', { ascending: true }),
  ])

  if (error) return { ok: false, error: error.message }

  const rows: ProspectRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    kind: row.kind as ProspectKind,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    source: (row.source as string | null) ?? 'manual',
    sourceType: (row.source_type as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    engagementStatus: row.engagement_status as CrmEngagementStatus,
    intentLevel: row.intent_level as CrmIntentLevel,
    qualificationStatus: row.qualification_status as CrmQualificationStatus,
    recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
    score: (row.score as number | null) ?? 0,
    lastContactedAt: (row.last_contacted_at as string | null) ?? null,
    lastRepliedAt: (row.last_replied_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[] | null) ?? [],
    emailStatus: (row.email_status as EmailStatus | null) ?? null,
    emailVerifiedAt: (row.email_verified_at as string | null) ?? null,
    emailVerificationProvider: (row.email_verification_provider as string | null) ?? null,
    emailRisk: (row.email_risk as EmailRisk | null) ?? null,
  }))

  const lists = ((listsResult.data ?? []) as Array<{ id: string; name: string }>).map((l) => ({
    id: l.id,
    name: l.name,
  }))

  return { ok: true, rows, total: count ?? 0, page, pageSize, lists }
}

export async function createProspect(input: {
  kind: ProspectKind
  name: string
  email?: string | null
  phone?: string | null
  company?: string | null
  sourceType?: string | null
  sourceId?: string | null
  sourcePayload?: Json
}): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  if (input.kind === 'company') {
    const { error } = await supabase.from('accounts').insert({
      org_id: orgId as string,
      name,
      phone: input.phone?.trim() || null,
      source: 'manual',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: 'none',
      qualification_status: 'needs_review',
      source_type: input.sourceType?.trim() || null,
      source_id: input.sourceId?.trim() || null,
      source_payload: input.sourcePayload ?? {},
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('contacts').insert({
      org_id: orgId as string,
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      company: input.company?.trim() || null,
      source: 'manual',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: 'none',
      qualification_status: 'needs_review',
      source_type: input.sourceType?.trim() || null,
      source_id: input.sourceId?.trim() || null,
      source_payload: input.sourcePayload ?? {},
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true }
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Promote a single prospect-stage record to `lead`, recording the conversion and
 * a timeline event. Returns false when the record was not in the prospect stage
 * (already promoted) so callers can report it as skipped. Never pulls a non-
 * prospect record back.
 */
async function applyConversion(
  supabase: ServerClient,
  orgId: string,
  userId: string | null,
  kind: ProspectKind,
  id: string,
): Promise<boolean> {
  const table = kind === 'company' ? 'accounts' : 'contacts'
  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'

  const { data, error } = await supabase
    .from(table)
    .update({
      lifecycle_stage: 'lead',
      qualification_status: 'qualified',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('lifecycle_stage', 'prospect')
    .select('id')

  if (error || !data || data.length === 0) return false

  await supabase.from('prospect_conversions').insert({
    org_id: orgId,
    entity_type: entityType,
    entity_id: id,
    from_stage: 'prospect',
    to_stage: 'lead',
    converted_by: userId,
    payload: {},
  })
  await supabase.from('prospect_engagement_events').insert({
    org_id: orgId,
    entity_type: entityType,
    entity_id: id,
    event_type: 'converted',
    source_platform: 'xphere',
    payload: { to_stage: 'lead' } as Json,
  })
  return true
}

function splitRefs(refs: ProspectRef[]): { contactIds: string[]; accountIds: string[] } {
  const contactIds: string[] = []
  const accountIds: string[] = []
  for (const ref of refs) {
    if (ref.kind === 'company') accountIds.push(ref.id)
    else contactIds.push(ref.id)
  }
  return { contactIds, accountIds }
}

export async function convertProspectToContact(
  kind: ProspectKind,
  id: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const converted = await applyConversion(supabase, orgId as string, user?.id ?? null, kind, id)
  if (!converted) return { ok: false, error: 'This record is no longer a prospect.' }

  revalidatePath('/prospects')
  revalidatePath('/contacts')
  revalidatePath('/companies')
  return { ok: true }
}

// ─── Bulk actions ────────────────────────────────────────────────────────────

export async function bulkConvertProspects(refs: ProspectRef[]): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  let affected = 0
  for (const ref of refs) {
    const ok = await applyConversion(supabase, orgId as string, user?.id ?? null, ref.kind, ref.id)
    if (ok) affected += 1
  }

  revalidatePath('/prospects')
  revalidatePath('/contacts')
  revalidatePath('/companies')
  return { ok: true, affected }
}

export async function bulkSetQualification(
  refs: ProspectRef[],
  qualification: CrmQualificationStatus,
): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)
  const patch = { qualification_status: qualification, updated_at: new Date().toISOString() }

  if (contactIds.length) {
    const { error } = await supabase.from('contacts').update(patch).in('id', contactIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }
  if (accountIds.length) {
    const { error } = await supabase.from('accounts').update(patch).in('id', accountIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true, affected: refs.length }
}

export async function bulkSetIntent(refs: ProspectRef[], intent: CrmIntentLevel): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)
  const patch = { intent_level: intent, updated_at: new Date().toISOString() }

  if (contactIds.length) {
    const { error } = await supabase.from('contacts').update(patch).in('id', contactIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }
  if (accountIds.length) {
    const { error } = await supabase.from('accounts').update(patch).in('id', accountIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true, affected: refs.length }
}

export async function bulkAssignToList(refs: ProspectRef[], listId: string): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  // Skip members already in the list so re-assigning is idempotent (the table has
  // partial unique indexes per kind that make upsert onConflict awkward).
  const { data: current } = await supabase
    .from('prospect_list_members')
    .select('contact_id, account_id')
    .eq('list_id', listId)
  const existingContacts = new Set<string>()
  const existingAccounts = new Set<string>()
  for (const m of (current ?? []) as Array<{ contact_id: string | null; account_id: string | null }>) {
    if (m.contact_id) existingContacts.add(m.contact_id)
    if (m.account_id) existingAccounts.add(m.account_id)
  }

  const rows = refs
    .filter((ref) =>
      ref.kind === 'person' ? !existingContacts.has(ref.id) : !existingAccounts.has(ref.id),
    )
    .map((ref) => ({
      org_id: orgId as string,
      list_id: listId,
      contact_id: ref.kind === 'person' ? ref.id : null,
      account_id: ref.kind === 'company' ? ref.id : null,
    }))

  if (rows.length === 0) return { ok: true, affected: 0 }

  const { error } = await supabase.from('prospect_list_members').insert(rows)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  revalidatePath('/prospects/lists')
  return { ok: true, affected: rows.length }
}

export async function bulkDeleteProspects(refs: ProspectRef[]): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)

  // Only delete records still in the prospect stage — never a promoted CRM record.
  if (contactIds.length) {
    const { error } = await supabase.from('contacts').delete().in('id', contactIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }
  if (accountIds.length) {
    const { error } = await supabase.from('accounts').delete().in('id', accountIds).eq('lifecycle_stage', 'prospect')
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/prospects')
  return { ok: true, affected: refs.length }
}

export async function importProspectsCsv(
  csv: string,
  defaultCountry?: string,
): Promise<ProspectImportResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const parsed = parseCsv(csv)
  if (parsed.headers.length === 0) return { ok: false, error: 'CSV must include a header row.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const headerIndex = new Map(parsed.headers.map((header, index) => [header.trim().toLowerCase(), index]))
  const indexOf = (...names: string[]) => {
    for (const name of names) {
      const idx = headerIndex.get(name)
      if (idx !== undefined) return idx
    }
    return -1
  }

  const nameIdx = indexOf('name', 'full name', 'contact', 'nome')
  const firstIdx = indexOf('first_name', 'first name', 'firstname')
  const lastIdx = indexOf('last_name', 'last name', 'lastname')
  const emailIdx = indexOf('email', 'e-mail')
  const phoneIdx = indexOf('phone', 'telephone', 'mobile', 'whatsapp')
  const countryIdx = indexOf('country', 'phone_country', 'phone country', 'país', 'pais')
  const companyIdx = indexOf('company', 'organization', 'empresa')
  const sourceIdIdx = indexOf('source_id', 'source id', 'external_id', 'external id')

  const rows = parsed.rows.slice(0, 500)
  type ProspectContactInsert = Database['public']['Tables']['contacts']['Insert']

  const inserts: ProspectContactInsert[] = []
  for (const row of rows) {
    const first = firstIdx >= 0 ? row[firstIdx]?.trim() : ''
    const last = lastIdx >= 0 ? row[lastIdx]?.trim() : ''
    const explicitName = nameIdx >= 0 ? row[nameIdx]?.trim() : ''
    const name = explicitName || [first, last].filter(Boolean).join(' ')
    const email = normaliseEmail(emailIdx >= 0 ? row[emailIdx] : null)
    const rowCountry = countryIdx >= 0 ? row[countryIdx]?.trim() : ''
    const phone = normalizePhoneToE164(phoneIdx >= 0 ? row[phoneIdx] : null, rowCountry || defaultCountry)
    const company = companyIdx >= 0 ? row[companyIdx]?.trim() : ''
    const sourceId = sourceIdIdx >= 0 ? row[sourceIdIdx]?.trim() : ''

    if (!name && !email && !phone) continue

    inserts.push({
      org_id: orgId as string,
      name: name || null,
      email,
      phone,
      company: company || null,
      source: 'csv_import',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: 'none',
      qualification_status: 'needs_review',
      source_type: 'csv',
      source_id: sourceId || null,
      source_payload: {
        headers: parsed.headers,
        row,
      },
    })
  }

  if (inserts.length === 0) return { ok: false, error: 'No importable prospect rows found.' }

  const { error } = await supabase.from('contacts').insert(inserts)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  return { ok: true, inserted: inserts.length, skipped: rows.length - inserts.length }
}

// ─── Lists ─────────────────────────────────────────────────────────────────────

export type ProspectListRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  memberCount: number
  createdAt: string
}

export async function getProspectLists(): Promise<
  { ok: true; lists: ProspectListRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const [listsResult, membersResult] = await Promise.all([
    supabase
      .from('prospect_lists')
      .select('id, name, description, color, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('prospect_list_members').select('list_id'),
  ])

  if (listsResult.error) return { ok: false, error: listsResult.error.message }

  const counts = new Map<string, number>()
  for (const row of (membersResult.data ?? []) as Array<{ list_id: string }>) {
    counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1)
  }

  const lists = ((listsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    memberCount: counts.get(row.id as string) ?? 0,
    createdAt: row.created_at as string,
  }))

  return { ok: true, lists }
}

export async function createProspectList(input: {
  name: string
  description?: string | null
  color?: string | null
}): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'List name is required.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const { error } = await supabase.from('prospect_lists').insert({
    org_id: orgId as string,
    name,
    description: input.description?.trim() || null,
    color: input.color?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/lists')
  return { ok: true }
}

export async function deleteProspectList(id: string): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { error } = await supabase.from('prospect_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/lists')
  return { ok: true }
}

// ─── Sources ───────────────────────────────────────────────────────────────────

export type ProspectSourceRow = {
  id: string
  sourceType: string
  sourceKey: string | null
  label: string | null
  externalRunId: string | null
  status: string
  totalCount: number
  importedCount: number
  createdAt: string
}

export async function getProspectSources(): Promise<
  { ok: true; sources: ProspectSourceRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prospect_sources')
    .select('id, source_type, source_key, label, external_run_id, status, total_count, imported_count, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { ok: false, error: error.message }

  const sources = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    sourceType: row.source_type as string,
    sourceKey: (row.source_key as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    externalRunId: (row.external_run_id as string | null) ?? null,
    status: row.status as string,
    totalCount: (row.total_count as number) ?? 0,
    importedCount: (row.imported_count as number) ?? 0,
    createdAt: row.created_at as string,
  }))

  return { ok: true, sources }
}

// ─── Audiences ─────────────────────────────────────────────────────────────────

export type ProspectAudienceRow = {
  id: string
  name: string
  description: string | null
  syncedPlatforms: string[]
  createdAt: string
}

export type ProspectMetaAudienceSummary = {
  configured: number
  enabled: number
  lastSuccessfulSync: string | null
  errorCount: number
}

export async function getProspectMetaAudienceSummary(): Promise<
  { ok: true; summary: ProspectMetaAudienceSummary } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  const supabase = await createClient()
  const { data: orgId, error: orgError } = await supabase.rpc('get_current_org_id')
  if (orgError || !orgId) return { ok: false, error: 'No active workspace found.' }
  const { data, error } = await supabase
    .from('meta_audience_config')
    .select('sync_enabled, operational_status, last_synced_at')
    .eq('org_id', orgId as string)
  if (error) return { ok: false, error: 'Could not load Meta audience status.' }
  const rows = data ?? []
  const successful = rows
    .map((row) => row.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  return {
    ok: true,
    summary: {
      configured: rows.length,
      enabled: rows.filter((row) => row.sync_enabled).length,
      lastSuccessfulSync: successful,
      errorCount: rows.filter((row) => row.operational_status === 'error' || row.operational_status === 'misconfigured').length,
    },
  }
}

export async function getProspectAudiences(): Promise<
  { ok: true; audiences: ProspectAudienceRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prospect_audiences')
    .select('id, name, description, synced_platforms, created_at')
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }

  const audiences = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    syncedPlatforms: (row.synced_platforms as string[] | null) ?? [],
    createdAt: row.created_at as string,
  }))

  return { ok: true, audiences }
}

export async function createProspectAudience(input: {
  name: string
  description?: string | null
}): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Audience name is required.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const { error } = await supabase.from('prospect_audiences').insert({
    org_id: orgId as string,
    name,
    description: input.description?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/audiences')
  return { ok: true }
}

export async function deleteProspectAudience(id: string): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { error } = await supabase.from('prospect_audiences').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects/audiences')
  return { ok: true }
}

// ─── Replies ───────────────────────────────────────────────────────────────────

const REPLY_STATUSES: CrmEngagementStatus[] = ['replied', 'engaged', 'interested', 'needs_follow_up']

export async function getProspectReplies(): Promise<ProspectListResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, name, email, phone, company, tags, custom_fields, source, source_type, source_id, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, email_status, email_verified_at, email_verification_provider, email_risk, created_at, updated_at')
    .eq('lifecycle_stage', 'prospect')
    .in('engagement_status', REPLY_STATUSES)
    .order('last_replied_at', { ascending: false, nullsFirst: false })
    .limit(250)

  if (error) return { ok: false, error: error.message }

  const rows: ProspectRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    kind: 'person' as const,
    name: contactName(row as { first_name?: string | null; last_name?: string | null; name?: string | null }),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    website: (row.website as string | null) ?? (row.domain as string | null) ?? null,
    city: extractLocation(row.custom_fields),
    source: (row.source as string | null) ?? 'manual',
    sourceType: (row.source_type as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    engagementStatus: row.engagement_status as CrmEngagementStatus,
    intentLevel: row.intent_level as CrmIntentLevel,
    qualificationStatus: row.qualification_status as CrmQualificationStatus,
    recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
    score: (row.score as number | null) ?? 0,
    lastContactedAt: (row.last_contacted_at as string | null) ?? null,
    lastRepliedAt: (row.last_replied_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[] | null) ?? [],
    emailStatus: (row.email_status as EmailStatus | null) ?? null,
    emailVerifiedAt: (row.email_verified_at as string | null) ?? null,
    emailVerificationProvider: (row.email_verification_provider as string | null) ?? null,
    emailRisk: (row.email_risk as EmailRisk | null) ?? null,
  }))

  return { ok: true, rows, total: rows.length }
}

// ─── Conversions ───────────────────────────────────────────────────────────────

export type ProspectConversionRow = {
  id: string
  entityType: ProspectEntityType
  entityId: string
  entityName: string | null
  fromStage: string
  toStage: string
  createdAt: string
}

export async function getProspectConversions(): Promise<
  { ok: true; conversions: ProspectConversionRow[] } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('prospect_conversions')
    .select('id, entity_type, entity_id, from_stage, to_stage, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as Array<Record<string, unknown>>

  // Resolve entity names in two grouped lookups.
  const contactIds = rows.filter((r) => r.entity_type === 'contact').map((r) => r.entity_id as string)
  const accountIds = rows.filter((r) => r.entity_type === 'account').map((r) => r.entity_id as string)
  const names = new Map<string, string>()

  if (contactIds.length) {
    const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', contactIds)
    for (const c of (contacts ?? []) as Array<{ id: string; name: string | null }>) {
      if (c.name) names.set(c.id, c.name)
    }
  }
  if (accountIds.length) {
    const { data: accounts } = await supabase.from('accounts').select('id, name').in('id', accountIds)
    for (const a of (accounts ?? []) as Array<{ id: string; name: string | null }>) {
      if (a.name) names.set(a.id, a.name)
    }
  }

  const conversions = rows.map((row) => ({
    id: row.id as string,
    entityType: row.entity_type as ProspectEntityType,
    entityId: row.entity_id as string,
    entityName: names.get(row.entity_id as string) ?? null,
    fromStage: row.from_stage as string,
    toStage: row.to_stage as string,
    createdAt: row.created_at as string,
  }))

  return { ok: true, conversions }
}

// ─── Detail ────────────────────────────────────────────────────────────────────

export type ProspectEvent = {
  id: string
  eventType: string
  channel: string | null
  sourcePlatform: string | null
  occurredAt: string
  payload: Json
}
export type ProspectNote = { id: string; content: string; createdAt: string }
export type ProspectTask = { id: string; title: string; status: string; dueDate: string | null }

export type WebsiteAnalysis = {
  id: string
  status: string
  leadScore: number | null
  url: string | null
  brandColors: { hex: string; role: string }[]
  logoUrl: string | null
  services: string[]
  painPoints: string[]
  outreachInsights: Record<string, string>
  screenshotDesktopUrl: string | null
  screenshotMobileUrl: string | null
  previewUrl: string | null
  rawEvidence: Record<string, unknown>
  analyzedAt: string | null
  errorMessage: string | null
}

export type ProspectDetail = ProspectRow & {
  sourcePayload: Json
  events: ProspectEvent[]
  notes: ProspectNote[]
  tasks: ProspectTask[]
  conversationCount: number
  websiteAnalysis: WebsiteAnalysis | null
}

export async function getProspectDetail(
  kind: ProspectKind,
  id: string,
): Promise<{ ok: true; detail: ProspectDetail } | { ok: false; error: string; forbidden?: boolean }> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'

  const base =
    kind === 'company'
      ? await supabase
          .from('accounts')
          .select('id, name, domain, website, phone, tags, custom_fields, source, source_type, source_id, source_payload, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, email_status, email_verified_at, email_verification_provider, email_risk, created_at, updated_at')
          .eq('id', id)
          .eq('lifecycle_stage', 'prospect')
          .maybeSingle()
      : await supabase
          .from('contacts')
          .select('id, first_name, last_name, name, email, phone, company, tags, custom_fields, source, source_type, source_id, source_payload, engagement_status, intent_level, qualification_status, recommended_channel, score, last_contacted_at, last_replied_at, email_status, email_verified_at, email_verification_provider, email_risk, created_at, updated_at')
          .eq('id', id)
          .eq('lifecycle_stage', 'prospect')
          .maybeSingle()

  if (base.error) return { ok: false, error: base.error.message }
  if (!base.data) return { ok: false, error: 'Prospect not found.' }
  const row = base.data as Record<string, unknown>

  const [eventsResult, notesResult, tasksResult, convResult, analysisResult] = await Promise.all([
    supabase
      .from('prospect_engagement_events')
      .select('id, event_type, channel, source_platform, occurred_at, payload')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('notes')
      .select('id, content, created_at')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('tasks')
      .select('id, title, status, due_date')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    kind === 'person'
      ? supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('contact_id', id)
      : Promise.resolve({ count: 0 }),
    // Website analysis only applies to company prospects.
    kind === 'company'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase as any)
          .from('website_analyses')
          .select('id, status, lead_score, url, brand_colors, logo_url, services, pain_points, outreach_insights, screenshot_desktop_url, screenshot_mobile_url, preview_url, raw_evidence, analyzed_at, error_message, created_at')
          .eq('account_id', id)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null }),
  ])

  const detail: ProspectDetail = {
    id: row.id as string,
    kind,
    name:
      kind === 'company'
        ? ((row.name as string | null) ?? null)
        : contactName(row as { first_name?: string | null; last_name?: string | null; name?: string | null }),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    company:
      kind === 'company'
        ? (row.domain as string | null) ?? (row.website as string | null) ?? null
        : (row.company as string | null) ?? null,
    website: (row.domain as string | null) ?? (row.website as string | null) ?? null,
    city: extractLocation(row.custom_fields),
    source: (row.source as string | null) ?? 'manual',
    sourceType: (row.source_type as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    sourcePayload: (row.source_payload as Json) ?? {},
    engagementStatus: row.engagement_status as CrmEngagementStatus,
    intentLevel: row.intent_level as CrmIntentLevel,
    qualificationStatus: row.qualification_status as CrmQualificationStatus,
    recommendedChannel: (row.recommended_channel as CrmRecommendedChannel | null) ?? null,
    score: (row.score as number | null) ?? 0,
    lastContactedAt: (row.last_contacted_at as string | null) ?? null,
    lastRepliedAt: (row.last_replied_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[] | null) ?? [],
    emailStatus: (row.email_status as EmailStatus | null) ?? null,
    emailVerifiedAt: (row.email_verified_at as string | null) ?? null,
    emailVerificationProvider: (row.email_verification_provider as string | null) ?? null,
    emailRisk: (row.email_risk as EmailRisk | null) ?? null,
    events: ((eventsResult.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
      id: e.id as string,
      eventType: e.event_type as string,
      channel: (e.channel as string | null) ?? null,
      sourcePlatform: (e.source_platform as string | null) ?? null,
      occurredAt: e.occurred_at as string,
      payload: (e.payload as Json) ?? {},
    })),
    notes: ((notesResult.data ?? []) as Array<Record<string, unknown>>).map((n) => ({
      id: n.id as string,
      content: n.content as string,
      createdAt: n.created_at as string,
    })),
    tasks: ((tasksResult.data ?? []) as Array<Record<string, unknown>>).map((t) => ({
      id: t.id as string,
      title: t.title as string,
      status: t.status as string,
      dueDate: (t.due_date as string | null) ?? null,
    })),
    conversationCount: (convResult as { count: number | null }).count ?? 0,
    websiteAnalysis: (() => {
      const analysisRows = (analysisResult as { data: Array<Record<string, unknown>> | null }).data ?? []
      const a = resolveLatestAnalysisForDisplay(
        analysisRows as Array<{ status: AnalysisRowStatus; error_message?: unknown } & Record<string, unknown>>,
      )
      if (!a) return null
      return {
        id: a.id as string,
        status: a.status as string,
        leadScore: (a.lead_score as number | null) ?? null,
        url: (a.url as string | null) ?? null,
        brandColors: (a.brand_colors as { hex: string; role: string }[] | null) ?? [],
        logoUrl: (a.logo_url as string | null) ?? null,
        services: (a.services as string[] | null) ?? [],
        painPoints: (a.pain_points as string[] | null) ?? [],
        outreachInsights: (a.outreach_insights as Record<string, string> | null) ?? {},
        screenshotDesktopUrl: (a.screenshot_desktop_url as string | null) ?? null,
        screenshotMobileUrl: (a.screenshot_mobile_url as string | null) ?? null,
        previewUrl: (a.preview_url as string | null) ?? null,
        rawEvidence: (a.raw_evidence as Record<string, unknown> | null) ?? {},
        analyzedAt: (a.analyzed_at as string | null) ?? null,
        errorMessage: (a.error_message as string | null) ?? null,
      }
    })(),
  }

  return { ok: true, detail }
}

/**
 * Manually generate a preview site for a company prospect (the "Gerar preview"
 * button). Unlike the old auto-flow, a tenant in websites.skale.club is created
 * ONLY here — on demand, when the operator decides the prospect is worth it
 * (e.g. the client signalled interest). Requires a completed analysis to source
 * brand colors / logo / services / pain points.
 */
export async function generateProspectPreview(
  accountId: string,
): Promise<{ ok: true; previewUrl: string | null } | { ok: false; error: string; forbidden?: boolean }> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const { data: account } = await supabase
    .from('accounts')
    .select('id, name, domain, website')
    .eq('id', accountId)
    .eq('lifecycle_stage', 'prospect')
    .maybeSingle()
  if (!account) return { ok: false, error: 'Prospect not found.' }
  const domain = (account.domain as string | null) ?? (account.website as string | null)
  if (!domain) return { ok: false, error: 'This prospect has no domain to base a preview on.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: a } = await (supabase as any)
    .from('website_analyses')
    .select('id, brand_colors, logo_url, services, pain_points')
    .eq('account_id', accountId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!a) return { ok: false, error: 'Run a website analysis first — the preview is built from it.' }

  const res = await generatePreviewForAnalysis({
    analysisId: a.id as string,
    accountId,
    orgId: orgId as string,
    domain,
    result: {
      brandColors: (a.brand_colors as { hex: string; role: 'background' | 'text' | 'accent' | 'unknown' }[] | null) ?? [],
      logoUrl: (a.logo_url as string | null) ?? null,
      services: (a.services as string[] | null) ?? [],
      painPoints: (a.pain_points as string[] | null) ?? [],
    },
    accountName: (account.name as string | null) ?? null,
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/prospects')
  return { ok: true, previewUrl: res.previewUrl }
}

export async function addProspectNote(
  kind: ProspectKind,
  id: string,
  content: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const text = content.trim()
  if (!text) return { ok: false, error: 'Note cannot be empty.' }

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'
  const { error } = await supabase.from('notes').insert({
    org_id: orgId as string,
    content: text,
    entity_type: entityType,
    entity_id: id,
    created_by: user?.id ?? null,
  })
  if (error) return { ok: false, error: error.message }

  await supabase.from('prospect_engagement_events').insert({
    org_id: orgId as string,
    entity_type: entityType,
    entity_id: id,
    event_type: 'note',
    source_platform: 'xphere',
    payload: {} as Json,
  })

  revalidatePath('/prospects')
  return { ok: true }
}

export async function addProspectTask(
  kind: ProspectKind,
  id: string,
  title: string,
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const text = title.trim()
  if (!text) return { ok: false, error: 'Task title is required.' }

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'
  const { error } = await supabase.from('tasks').insert({
    org_id: orgId as string,
    title: text,
    status: 'todo',
    entity_type: entityType,
    entity_id: id,
    created_by: user?.id ?? null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/prospects')
  return { ok: true }
}

// ─── Outreach (Xmail) ────────────────────────────────────────────────────────

export async function startOutreach(refs: ProspectRef[]): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (!isXmailConfigured()) return { ok: false, error: 'Email outreach (Xmail) is not configured.' }
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)

  const leads: XmailLead[] = []
  const touchedContacts: string[] = []
  const touchedAccounts: string[] = []
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }
  const websiteInsights = await loadWebsiteInsightsForAccounts(supabase, orgId as string, accountIds)
  const sourceRunIds = await loadSourceRunIdsForEntities(supabase, orgId as string, [...contactIds, ...accountIds])

  if (contactIds.length) {
    const { data } = await supabase
      .from('contacts')
      .select('id, name, email, phone, company, engagement_status')
      .in('id', contactIds)
      .eq('lifecycle_stage', 'prospect')
      .eq('engagement_status', 'not_contacted')
    for (const c of (data ?? []) as Array<Record<string, unknown>>) {
      const email = c.email as string | null
      if (!email) continue
      const sourceRunId = sourceRunIds.get(c.id as string)
      leads.push({
        email,
        firstName: (c.name as string | null) ?? null,
        companyName: (c.company as string | null) ?? null,
        phone: (c.phone as string | null) ?? null,
        customFields: {
          xphere_id: c.id,
          xphere_kind: 'contact',
          ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
        },
      })
      touchedContacts.push(c.id as string)
    }
  }

  if (accountIds.length) {
    const { data } = await supabase
      .from('accounts')
      .select('id, name, phone, domain, custom_fields, engagement_status')
      .in('id', accountIds)
      .eq('lifecycle_stage', 'prospect')
      .eq('engagement_status', 'not_contacted')
    for (const a of (data ?? []) as Array<Record<string, unknown>>) {
      const cf = (a.custom_fields as Record<string, unknown> | null) ?? {}
      const email = (cf.email as string | null) ?? null
      if (!email) continue
      const sourceRunId = sourceRunIds.get(a.id as string)
      leads.push({
        email,
        companyName: (a.name as string | null) ?? null,
        phone: (a.phone as string | null) ?? null,
        website: (a.domain as string | null) ?? null,
        customFields: {
          xphere_id: a.id,
          xphere_kind: 'account',
          ...(websiteInsights.get(a.id as string)
            ? { websiteInsights: websiteInsights.get(a.id as string) }
            : {}),
          ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
        },
      })
      touchedAccounts.push(a.id as string)
    }
  }

  if (leads.length === 0) {
    return {
      ok: false,
      error: 'None of the selected prospects are both uncontacted and reachable by email.',
    }
  }

  const result = await xmailBulkImportLeads(leads)
  if (!result.ok) return { ok: false, error: result.error }

  await markContacted(supabase, touchedContacts, touchedAccounts, 'email', 'xmail')

  revalidatePath('/prospects')
  return { ok: true, affected: leads.length }
}

// ─── Field visits (Xpot) ─────────────────────────────────────────────────────

export async function sendToXpot(refs: ProspectRef[]): Promise<BulkResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (!isXpotConfigured()) return { ok: false, error: 'Field visits (Xpot) are not configured.' }
  if (refs.length === 0) return { ok: true, affected: 0 }

  const supabase = await createClient()
  const { contactIds, accountIds } = splitRefs(refs)

  const xpotLeads: XpotLead[] = []
  const touchedContacts: string[] = []
  const touchedAccounts: string[] = []

  if (contactIds.length) {
    const { data } = await supabase
      .from('contacts')
      .select('id, name, email, phone, company')
      .in('id', contactIds)
      .eq('lifecycle_stage', 'prospect')
    for (const c of (data ?? []) as Array<Record<string, unknown>>) {
      xpotLeads.push({
        xphereId: c.id as string,
        xphereKind: 'contact',
        name: (c.name as string | null) ?? (c.company as string | null) ?? 'Prospect',
        email: (c.email as string | null) ?? null,
        phone: (c.phone as string | null) ?? null,
        address: null,
      })
      touchedContacts.push(c.id as string)
    }
  }

  if (accountIds.length) {
    const { data } = await supabase
      .from('accounts')
      .select('id, name, phone, address, custom_fields')
      .in('id', accountIds)
      .eq('lifecycle_stage', 'prospect')
    for (const a of (data ?? []) as Array<Record<string, unknown>>) {
      const cf = (a.custom_fields as Record<string, unknown> | null) ?? {}
      xpotLeads.push({
        xphereId: a.id as string,
        xphereKind: 'account',
        name: (a.name as string | null) ?? 'Company',
        email: (cf.email as string | null) ?? null,
        phone: (a.phone as string | null) ?? null,
        address: (a.address as string | null) ?? (cf.address as string | null) ?? null,
      })
      touchedAccounts.push(a.id as string)
    }
  }

  if (xpotLeads.length === 0) return { ok: false, error: 'No prospects to send.' }

  const result = await xpotSendLeads(xpotLeads)
  if (!result.ok) return { ok: false, error: result.error }

  await markContacted(supabase, touchedContacts, touchedAccounts, 'visit', 'xpot', 'visit')

  revalidatePath('/prospects')
  return { ok: true, affected: xpotLeads.length }
}

/**
 * Shared helper: mark records as contacted, stamp last_contacted_at, and log an
 * engagement event. Used by outreach (Xmail) and field-visit dispatch (Xpot).
 */
async function markContacted(
  supabase: ServerClient,
  contactIds: string[],
  accountIds: string[],
  channel: string,
  sourcePlatform: string,
  eventType: 'contacted' | 'visit' = 'contacted',
) {
  const now = new Date().toISOString()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return

  if (contactIds.length) {
    await supabase
      .from('contacts')
      .update({ engagement_status: 'contacted', last_contacted_at: now, updated_at: now })
      .in('id', contactIds)
      .eq('lifecycle_stage', 'prospect')
      .eq('engagement_status', 'not_contacted')
  }
  if (accountIds.length) {
    await supabase
      .from('accounts')
      .update({ engagement_status: 'contacted', last_contacted_at: now, updated_at: now })
      .in('id', accountIds)
      .eq('lifecycle_stage', 'prospect')
      .eq('engagement_status', 'not_contacted')
  }

  const events = [
    ...contactIds.map((id) => ({
      org_id: orgId as string,
      entity_type: 'contact' as const,
      entity_id: id,
      event_type: eventType,
      channel,
      source_platform: sourcePlatform,
      payload: {} as Json,
    })),
    ...accountIds.map((id) => ({
      org_id: orgId as string,
      entity_type: 'account' as const,
      entity_id: id,
      event_type: eventType,
      channel,
      source_platform: sourcePlatform,
      payload: {} as Json,
    })),
  ]
  if (events.length) await supabase.from('prospect_engagement_events').insert(events)
}

// ─── AI qualification suggestions ────────────────────────────────────────────

export type QualificationSuggestion = {
  intentLevel: CrmIntentLevel
  qualificationStatus: CrmQualificationStatus
  recommendedChannel: CrmRecommendedChannel | null
  rationale: string
  /** Personalized cold-outreach opener from the LLM path. null on the heuristic fallback — display-only, never persisted. */
  opener: string | null
  source: 'ai' | 'heuristic'
}

type HeuristicQualificationInput = {
  engagement: CrmEngagementStatus
  score: number
  hasReplied: boolean
  email: string | null
  phone: string | null
  address: string | null
}

/**
 * Deterministic, explainable qualification from engagement/score/reachable
 * channels. Used as-is when no LLM provider is configured for the org, and as
 * the fallback whenever the LLM path throws (no key, timeout, malformed
 * output). Kept side-effect free so it can run synchronously either way.
 */
function heuristicQualification(input: HeuristicQualificationInput): QualificationSuggestion {
  const { engagement, score, hasReplied, email, phone, address } = input
  const reasons: string[] = []

  // Intent from engagement signals.
  let intentLevel: CrmIntentLevel = 'none'
  if (hasReplied || ['replied', 'interested', 'engaged'].includes(engagement)) {
    intentLevel = 'high'
    reasons.push('replied or showed direct interest')
  } else if (['opened', 'clicked', 'needs_follow_up'].includes(engagement)) {
    intentLevel = 'medium'
    reasons.push('opened or clicked outreach')
  } else if (engagement === 'contacted') {
    intentLevel = 'low'
    reasons.push('contacted, awaiting response')
  } else {
    reasons.push('no engagement yet')
  }
  if (score >= 60 && intentLevel === 'none') {
    intentLevel = 'low'
    reasons.push(`lead score ${score}`)
  }

  // Qualification.
  let qualificationStatus: CrmQualificationStatus = 'needs_review'
  if (['not_interested', 'unsubscribed'].includes(engagement)) {
    qualificationStatus = 'unqualified'
    reasons.push('opted out / not interested')
  } else if (intentLevel === 'high' && (email || phone)) {
    qualificationStatus = 'qualified'
    reasons.push('high intent with a reachable channel')
  }

  // Recommended channel — prefer the cheapest reachable channel.
  let recommendedChannel: CrmRecommendedChannel | null = null
  if (email) recommendedChannel = 'email'
  else if (phone) recommendedChannel = 'call'
  else if (address) recommendedChannel = 'visit'
  if (recommendedChannel) reasons.push(`reachable via ${recommendedChannel}`)

  return {
    intentLevel,
    qualificationStatus,
    recommendedChannel,
    rationale: reasons.join('; '),
    opener: null,
    source: 'heuristic',
  }
}

/**
 * Suggest a qualification for a prospect from its current signals (engagement,
 * score, reachable channels, recent reply, and — for company prospects — the
 * latest completed website analysis). Tries an LLM-backed qualifier first
 * (also drafts a personalized cold-outreach opener referencing the site
 * analysis); falls back silently to the deterministic heuristic whenever no
 * provider key is configured or the call fails for any reason. The suggestion
 * is advisory either way — nothing is applied until the user confirms via
 * applyQualification.
 */
export async function suggestQualification(
  kind: ProspectKind,
  id: string,
): Promise<
  { ok: true; suggestion: QualificationSuggestion } | { ok: false; error: string; forbidden?: boolean }
> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const base =
    kind === 'company'
      ? await supabase
          .from('accounts')
          .select('name, engagement_status, score, phone, address, tags, custom_fields, last_replied_at')
          .eq('id', id)
          .eq('lifecycle_stage', 'prospect')
          .maybeSingle()
      : await supabase
          .from('contacts')
          .select('first_name, last_name, name, company, engagement_status, score, phone, email, tags, custom_fields, last_replied_at')
          .eq('id', id)
          .eq('lifecycle_stage', 'prospect')
          .maybeSingle()

  if (base.error) return { ok: false, error: base.error.message }
  if (!base.data) return { ok: false, error: 'Prospect not found.' }
  const row = base.data as Record<string, unknown>

  const engagement = (row.engagement_status as CrmEngagementStatus) ?? 'not_contacted'
  const score = (row.score as number | null) ?? 0
  const hasReplied = Boolean(row.last_replied_at)
  const email =
    kind === 'company'
      ? ((row.custom_fields as Record<string, unknown> | null)?.email as string | null) ?? null
      : (row.email as string | null) ?? null
  const phone = (row.phone as string | null) ?? null
  const address =
    kind === 'company'
      ? (row.address as string | null) ??
        ((row.custom_fields as Record<string, unknown> | null)?.address as string | null) ??
        null
      : null
  const name =
    kind === 'company'
      ? (row.name as string | null) ?? null
      : contactName(row as { first_name?: string | null; last_name?: string | null; name?: string | null })
  const companyName = kind === 'person' ? (row.company as string | null) ?? null : null
  const location = extractLocation(row.custom_fields)
  const tags = (row.tags as string[] | null) ?? []

  const fallback = heuristicQualification({ engagement, score, hasReplied, email, phone, address })

  // Website analysis only applies to company prospects — the "site problems"
  // that drive both the heuristic's talking points and the LLM opener.
  let website: WebsiteSignals | null = null
  if (kind === 'company') {
    // website_analyses isn't in the generated Database types yet (same escape
    // hatch used by getProspectDetail() above).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: analysis } = await (supabase as any)
      .from('website_analyses')
      .select('url, lead_score, services, pain_points, raw_evidence, logo_url')
      .eq('account_id', id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (analysis) {
      const ev = (analysis.raw_evidence ?? {}) as {
        isMobileResponsive?: boolean
        hasCTA?: boolean
        hasContactInfo?: boolean
        loadMs?: number
      }
      website = {
        url: (analysis.url as string | null) ?? null,
        leadScore: (analysis.lead_score as number | null) ?? null,
        services: (analysis.services as string[] | null) ?? [],
        painPoints: (analysis.pain_points as string[] | null) ?? [],
        isMobileResponsive: typeof ev.isMobileResponsive === 'boolean' ? ev.isMobileResponsive : null,
        hasCTA: typeof ev.hasCTA === 'boolean' ? ev.hasCTA : null,
        hasContactInfo: typeof ev.hasContactInfo === 'boolean' ? ev.hasContactInfo : null,
        loadMs: typeof ev.loadMs === 'number' ? ev.loadMs : null,
        hasLogo: Boolean(analysis.logo_url),
      }
    }
  }

  try {
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) throw new Error('no_active_org')

    const serviceClient = createServiceRoleClient()
    const llmResult = await qualifyProspectWithLlm(orgId as string, serviceClient, {
      kind,
      name,
      companyName,
      engagementStatus: engagement,
      score,
      hasReplied,
      email,
      phone,
      location,
      tags,
      website,
    })

    return {
      ok: true,
      suggestion: {
        intentLevel: llmResult.intentLevel,
        qualificationStatus: llmResult.qualificationStatus,
        recommendedChannel: llmResult.recommendedChannel,
        rationale: llmResult.rationale,
        opener: llmResult.opener,
        source: 'ai',
      },
    }
  } catch {
    // No provider key configured, timeout, or malformed output — the feature
    // must never break for orgs without an LLM key. Fall back silently.
    return { ok: true, suggestion: fallback }
  }
}

export async function applyQualification(
  kind: ProspectKind,
  id: string,
  suggestion: {
    intentLevel: CrmIntentLevel
    qualificationStatus: CrmQualificationStatus
    recommendedChannel: CrmRecommendedChannel | null
  },
): Promise<ProspectActionResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  const table = kind === 'company' ? 'accounts' : 'contacts'
  const entityType: ProspectEntityType = kind === 'company' ? 'account' : 'contact'

  const { error } = await supabase
    .from(table)
    .update({
      intent_level: suggestion.intentLevel,
      qualification_status: suggestion.qualificationStatus,
      recommended_channel: suggestion.recommendedChannel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('lifecycle_stage', 'prospect')

  if (error) return { ok: false, error: error.message }

  await supabase.from('prospect_engagement_events').insert({
    org_id: orgId as string,
    entity_type: entityType,
    entity_id: id,
    event_type: 'status_changed',
    source_platform: 'xphere',
    payload: {
      intent_level: suggestion.intentLevel,
      qualification_status: suggestion.qualificationStatus,
      recommended_channel: suggestion.recommendedChannel,
      via: 'ai_suggestion',
    } as Json,
  })

  revalidatePath('/prospects')
  return { ok: true }
}

// ─── Voice campaign from prospects ───────────────────────────────────────────
//
// Google-Maps-scraped prospects mostly have a phone and nothing else. This
// creates a draft voice campaign (channel='calls') pre-enrolled with the
// selected prospects' phone numbers, reusing the same campaigns/actions.ts
// createCampaign() shape (NOT the legacy outbound/actions.ts variant) and the
// same importContacts() enrollment pattern for campaign_contacts.

export interface VoiceCampaignAssistantOption {
  id: string
  name: string
}

export type VoiceCampaignSetupResult =
  | { ok: true; hasTwilio: boolean; hasVapi: boolean; assistants: VoiceCampaignAssistantOption[] }
  | { ok: false; error: string; forbidden?: boolean }

/** Assistant options + integration gating for the "Start voice campaign" dialog. Phone numbers are loaded client-side from /api/vapi/phone-numbers (same source the campaign wizard uses). */
export async function getVoiceCampaignSetup(): Promise<VoiceCampaignSetupResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const [integRes, assistantsRes] = await Promise.all([
    supabase.from('integrations').select('provider').eq('is_active', true),
    supabase
      .from('assistant_mappings')
      .select('vapi_assistant_id, name')
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ])

  const providers = new Set((integRes.data ?? []).map((i) => i.provider))
  const assistants = ((assistantsRes.data ?? []) as Array<{ vapi_assistant_id: string; name: string | null }>).map(
    (a) => ({ id: a.vapi_assistant_id, name: a.name ?? a.vapi_assistant_id }),
  )

  return { ok: true, hasTwilio: providers.has('twilio'), hasVapi: providers.has('vapi'), assistants }
}

export interface StartVoiceCampaignInput {
  name: string
  vapiAssistantId: string
  vapiPhoneNumberId: string
  callsPerMinute?: number
}

export type StartVoiceCampaignResult =
  | { ok: true; campaignId: string; enrolled: number; skippedNoPhone: number; skippedDuplicate: number }
  | { ok: false; error: string; forbidden?: boolean }

export async function startVoiceCampaignFromProspects(
  refs: ProspectRef[],
  input: StartVoiceCampaignInput,
): Promise<StartVoiceCampaignResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (await isDemoSession()) return { ok: false, error: DEMO_READONLY_MESSAGE }
  if (refs.length === 0) return { ok: false, error: 'Select at least one prospect first.' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Campaign name is required.' }
  if (!input.vapiAssistantId) return { ok: false, error: 'Select a voice assistant.' }
  if (!input.vapiPhoneNumberId) return { ok: false, error: 'Select an outbound phone number.' }
  const callsPerMinute = Math.min(20, Math.max(1, Math.round(input.callsPerMinute ?? 5)))

  const user = await getUser()
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }

  // Same gate createCampaign() applies for channel='calls': the dial engine
  // needs an active Twilio integration, and placing calls needs a Vapi key.
  const { data: integrations } = await supabase.from('integrations').select('provider').eq('is_active', true)
  const providers = new Set((integrations ?? []).map((i) => i.provider))
  if (!providers.has('twilio')) {
    return { ok: false, error: 'Twilio is not connected. Set up Twilio to create voice campaigns.' }
  }
  if (!providers.has('vapi')) {
    return { ok: false, error: 'Vapi is not connected. Add a Vapi integration to place calls.' }
  }

  const { contactIds, accountIds } = splitRefs(refs)
  const records: ProspectSourceRecord[] = []

  if (contactIds.length) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name, phone, phone_e164')
      .in('id', contactIds)
      .eq('lifecycle_stage', 'prospect')
    for (const c of (data ?? []) as Array<Record<string, unknown>>) {
      records.push({
        kind: 'person',
        id: c.id as string,
        name: contactName(c as { first_name?: string | null; last_name?: string | null; name?: string | null }),
        phone: (c.phone_e164 as string | null) ?? (c.phone as string | null),
      })
    }
  }
  if (accountIds.length) {
    const { data } = await supabase
      .from('accounts')
      .select('id, name, phone')
      .in('id', accountIds)
      .eq('lifecycle_stage', 'prospect')
    for (const a of (data ?? []) as Array<Record<string, unknown>>) {
      records.push({
        kind: 'company',
        id: a.id as string,
        name: a.name as string | null,
        phone: a.phone as string | null,
      })
    }
  }

  const resolved = resolveProspectRecipients(records)
  if (resolved.recipients.length === 0) {
    return { ok: false, error: 'None of the selected prospects have a usable phone number.' }
  }

  // campaigns / campaign_contacts only carry a SELECT RLS policy for
  // authenticated users (supabase/migrations/005_campaigns.sql — INSERT was
  // never granted) — writes go through the service-role client, mirroring
  // importContacts() in src/app/(dashboard)/outbound/actions.ts.
  const serviceClient = createServiceRoleClient()
  const { data: campaign, error: campaignErr } = await serviceClient
    .from('campaigns')
    .insert({
      organization_id: orgId as string,
      name,
      channel: 'calls',
      campaign_type: 'one_time',
      vapi_assistant_id: input.vapiAssistantId,
      vapi_phone_number_id: input.vapiPhoneNumberId,
      calls_per_minute: callsPerMinute,
      status: 'draft',
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()
  if (campaignErr || !campaign) {
    return { ok: false, error: campaignErr?.message ?? 'Failed to create the campaign.' }
  }

  const rows = resolved.recipients.map((r) => ({
    campaign_id: campaign.id as string,
    organization_id: orgId as string,
    name: r.name,
    phone: r.phone,
    custom_data: { xphere_id: r.id, xphere_kind: r.kind === 'company' ? 'account' : 'contact' } as Json,
  }))
  const { data: inserted, error: enrollErr } = await serviceClient
    .from('campaign_contacts')
    .insert(rows)
    .select('id')
  // Code 23505 = unique_violation on (campaign_id, phone) — unreachable in
  // practice since this is always a brand-new campaign, but handled
  // non-fatally to mirror importContacts()'s tolerance for it.
  if (enrollErr && enrollErr.code !== '23505') {
    return { ok: false, error: `Campaign created, but enrollment failed: ${enrollErr.message}` }
  }

  revalidatePath('/prospects')
  revalidatePath('/campaigns')
  return {
    ok: true,
    campaignId: campaign.id as string,
    enrolled: inserted?.length ?? rows.length,
    skippedNoPhone: resolved.skippedNoPhone,
    skippedDuplicate: resolved.skippedDuplicate,
  }
}

// ─── WhatsApp bulk send from prospects ───────────────────────────────────────
//
// Resolves whichever WhatsApp rail is active for the org (Meta Cloud > Zernio
// > Evolution/Z-API/W-API, same priority order as
// campaigns/provider-availability.ts) and sends a template (Cloud/Zernio) or
// free text (Evolution rail) directly — this is NOT a campaign; it dispatches
// immediately, mirroring startOutreach()/sendToXpot() above.

export type ProspectWhatsAppProvider = 'meta_cloud' | 'zernio' | 'evolution' | 'none'

export interface ProspectWhatsAppTemplate {
  /** Opaque token: whatsapp_templates.id for meta_cloud; `${accountId}::${name}::${language}` for zernio. */
  id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  bodyVariableCount: number
  headerVariableCount: number
  bodyText: string | null
}

export type ProspectWhatsAppSetupResult =
  | { ok: true; provider: ProspectWhatsAppProvider; templates: ProspectWhatsAppTemplate[] }
  | { ok: false; error: string; forbidden?: boolean }

function extractWhatsAppTemplateBody(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  const block = (components as Array<{ type?: string; text?: string }>).find(
    (c) => (c.type ?? '').toUpperCase() === 'BODY',
  )
  return block?.text ?? null
}

function toZernioTemplateShape(row: {
  name: string
  language: string
  category: string
  status: string
  components: unknown
}): ZernioWhatsappTemplate {
  return {
    name: row.name,
    status: row.status,
    language: row.language,
    category: row.category,
    components: (row.components as ZernioWhatsappTemplate['components']) ?? [],
  }
}

function normalizeTemplateCategory(value: string): ProspectWhatsAppTemplate['category'] {
  return value === 'MARKETING' || value === 'AUTHENTICATION' ? value : 'UTILITY'
}

/**
 * Provider-aware list of APPROVED templates for bulk-sending to prospects.
 * Adapts the same Cloud-vs-Zernio branching used by
 * GET /api/chat/conversations/[id]/templates, but resolved at the org level
 * (no conversation needed) — Zernio's accountId comes from the locally
 * synced `zernio_whatsapp_templates` cache instead of a conversation's
 * channel_metadata.
 */
export async function listProspectWhatsAppTemplates(): Promise<ProspectWhatsAppSetupResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }
  const org = orgId as string

  const cloudAccount = await getActiveCloudAccount(org)
  if (cloudAccount) {
    const { data } = await supabase
      .from('whatsapp_templates')
      .select('id, name, language, category, body_variable_count, header_variable_count, components')
      .eq('org_id', org)
      .eq('status', 'APPROVED')
      .order('name', { ascending: true })
    const templates: ProspectWhatsAppTemplate[] = (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      language: r.language as string,
      category: r.category,
      bodyVariableCount: r.body_variable_count ?? 0,
      headerVariableCount: r.header_variable_count ?? 0,
      bodyText: extractWhatsAppTemplateBody(r.components),
    }))
    return { ok: true, provider: 'meta_cloud', templates }
  }

  const { data: zernioIntegration } = await supabase
    .from('integrations')
    .select('id')
    .eq('provider', 'zernio')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (zernioIntegration) {
    const { data } = await supabase
      .from('zernio_whatsapp_templates')
      .select('zernio_account_id, name, language, category, components')
      .eq('org_id', org)
      .eq('status', 'APPROVED')
      .order('name', { ascending: true })
    const templates: ProspectWhatsAppTemplate[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const shaped = toZernioTemplateShape({
        name: r.name as string,
        language: r.language as string,
        category: r.category as string,
        status: 'APPROVED',
        components: r.components,
      })
      return {
        id: `${r.zernio_account_id as string}::${r.name as string}::${r.language as string}`,
        name: r.name as string,
        language: r.language as string,
        category: normalizeTemplateCategory(r.category as string),
        bodyVariableCount: zernioTemplateBodyVarCount(shaped),
        headerVariableCount: zernioTemplateHeaderVarCount(shaped),
        bodyText: zernioBodyComponent(shaped)?.text ?? null,
      }
    })
    return { ok: true, provider: 'zernio', templates }
  }

  const evoProvider = await resolveActiveProvider(org)
  if (evoProvider) return { ok: true, provider: 'evolution', templates: [] }

  return { ok: true, provider: 'none', templates: [] }
}

export interface SendWhatsAppToProspectsInput {
  /** Templated rail (meta_cloud / zernio): opaque id from listProspectWhatsAppTemplates(). */
  templateId?: string | null
  /** Static body-variable values, in {{n}} order. The literal token `{{name}}` inside a value is replaced per-recipient with the prospect's name. */
  bodyVariables?: string[]
  /** Evolution/Z-API/W-API rail only: free text (also supports the `{{name}}` token). */
  freeText?: string | null
}

export type SendWhatsAppToProspectsResult =
  | {
      ok: true
      sent: number
      failed: number
      skippedDnd: number
      skippedOptIn: number
      skippedNoPhone: number
      skippedDuplicate: number
      remaining: number
    }
  | { ok: false; error: string; forbidden?: boolean }

const WHATSAPP_BULK_CAP = 200
const WHATSAPP_BATCH_SIZE = 20
const WHATSAPP_BATCH_DELAY_MS = 1_500

/**
 * Find-or-create the native `whatsapp` conversation for a contact by
 * (org, channel, visitor_phone) — the same dedup key inbound handlers use
 * (src/lib/whatsapp/process-message.ts) — so a later reply lands in the same
 * thread. Best-effort: swallows its own errors so a mirroring failure never
 * blocks (or un-counts) the actual send.
 */
async function findOrCreateWhatsAppConversationId(
  supabase: ServerClient,
  orgId: string,
  contactId: string,
  phone: string,
  name: string,
  providerTag: string,
  phoneNumberId?: string | null,
): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel', 'whatsapp')
      .eq('visitor_phone', phone)
      .limit(1)
      .maybeSingle()
    if (existing) return existing.id as string

    const channelMetadata: Record<string, unknown> = { provider: providerTag }
    if (phoneNumberId) channelMetadata.phone_number_id = phoneNumberId

    const { data: created } = await supabase
      .from('conversations')
      .insert({
        org_id: orgId,
        widget_token: '',
        channel: 'whatsapp',
        channel_metadata: channelMetadata as Json,
        visitor_phone: phone,
        visitor_name: name,
        contact_id: contactId,
        status: 'open',
      })
      .select('id')
      .single()
    return (created?.id as string | undefined) ?? null
  } catch (err) {
    console.error('[prospects:whatsapp] findOrCreateWhatsAppConversationId error:', err)
    return null
  }
}

/** Bump the conversation preview after a successful outbound send. Best-effort. */
async function bumpWhatsAppConversation(
  supabase: ServerClient,
  conversationId: string,
  content: string,
): Promise<void> {
  try {
    await supabase
      .from('conversations')
      .update({
        last_message: content,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
  } catch (err) {
    console.error('[prospects:whatsapp] bumpWhatsAppConversation error:', err)
  }
}

export async function sendWhatsAppToProspects(
  refs: ProspectRef[],
  input: SendWhatsAppToProspectsInput,
): Promise<SendWhatsAppToProspectsResult> {
  const guard = await requireProspectsAdmin()
  if (!guard.ok) return guard
  if (await isDemoSession()) return { ok: false, error: DEMO_READONLY_MESSAGE }
  if (refs.length === 0) return { ok: false, error: 'Select at least one prospect first.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active workspace found.' }
  const org = orgId as string

  // Resolve the active rail — same priority as getCampaignProviderAvailability().
  const cloudAccount = await getActiveCloudAccount(org)
  const zernioApiKey = cloudAccount ? null : await getProviderKey('zernio', org, supabase)
  const evoProvider = cloudAccount || zernioApiKey ? null : await resolveActiveProvider(org)

  let mode: 'meta_cloud' | 'zernio' | 'evolution'
  if (cloudAccount) mode = 'meta_cloud'
  else if (zernioApiKey) mode = 'zernio'
  else if (evoProvider) mode = 'evolution'
  else return { ok: false, error: 'No WhatsApp channel is connected for this workspace.' }
  const evoProviderTag = evoProvider?.provider ?? 'evolution'

  // Resolve + validate the template for templated rails; free text otherwise.
  let templateName = ''
  let templateLanguage = ''
  let templateCategory: ProspectWhatsAppTemplate['category'] = 'UTILITY'
  let bodyVariableCount = 0
  let zernioAccountId = ''
  let zernioProfileId: string | null = null

  if (mode === 'meta_cloud' || mode === 'zernio') {
    const templateId = (input.templateId ?? '').trim()
    if (!templateId) return { ok: false, error: 'Select an approved WhatsApp template.' }

    if (mode === 'meta_cloud') {
      const { data: tpl } = await supabase
        .from('whatsapp_templates')
        .select('name, language, category, status, body_variable_count, header_variable_count')
        .eq('id', templateId)
        .eq('org_id', org)
        .maybeSingle()
      if (!tpl) return { ok: false, error: 'Template not found.' }
      if (tpl.status !== 'APPROVED') {
        return { ok: false, error: `Template is ${tpl.status} — only APPROVED templates can be sent.` }
      }
      if ((tpl.header_variable_count ?? 0) > 0) {
        return {
          ok: false,
          error: 'This template has header variables, which bulk send does not support yet. Choose a template with body-only variables.',
        }
      }
      templateName = tpl.name
      templateLanguage = tpl.language
      templateCategory = tpl.category
      bodyVariableCount = tpl.body_variable_count ?? 0
    } else {
      const parts = templateId.split('::')
      if (parts.length !== 3) return { ok: false, error: 'Invalid template selection.' }
      const [accountId, tplName, tplLanguage] = parts
      const { data: tpl } = await supabase
        .from('zernio_whatsapp_templates')
        .select('name, language, category, status, components')
        .eq('org_id', org)
        .eq('zernio_account_id', accountId)
        .eq('name', tplName)
        .eq('language', tplLanguage)
        .maybeSingle()
      if (!tpl) return { ok: false, error: 'Template not found.' }
      if (tpl.status !== 'APPROVED') {
        return { ok: false, error: `Template is ${tpl.status} — only APPROVED templates can be sent.` }
      }
      const shaped = toZernioTemplateShape(tpl)
      if (zernioTemplateHeaderVarCount(shaped) > 0) {
        return {
          ok: false,
          error: 'This template has header variables, which bulk send does not support yet. Choose a template with body-only variables.',
        }
      }
      templateName = tpl.name
      templateLanguage = tpl.language
      templateCategory = normalizeTemplateCategory(tpl.category)
      bodyVariableCount = zernioTemplateBodyVarCount(shaped)
      zernioAccountId = accountId

      // zernioApiKey is guaranteed non-null here (mode === 'zernio' only when it resolved above).
      zernioProfileId = await resolveZernioProfileId(accountId, zernioApiKey as string)
      if (!zernioProfileId) {
        return { ok: false, error: 'Could not resolve the Zernio profile for this account. Reconnect Zernio.' }
      }
    }

    const providedVars = input.bodyVariables ?? []
    if (providedVars.length !== bodyVariableCount) {
      return { ok: false, error: `This template expects ${bodyVariableCount} body variable(s), got ${providedVars.length}.` }
    }
  } else if (!input.freeText || !input.freeText.trim()) {
    return { ok: false, error: 'Write a message to send.' }
  }

  // Resolve recipients (dedup by phone, hard-capped so one invocation stays
  // well under the serverless timeout; the remainder is surfaced so the
  // operator can run the action again).
  const { contactIds, accountIds } = splitRefs(refs)
  const records: ProspectSourceRecord[] = []
  const contactFlagsById = new Map<string, { whatsappOptIn: boolean }>()

  if (contactIds.length) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name, phone, phone_e164, whatsapp_opt_in')
      .in('id', contactIds)
      .eq('lifecycle_stage', 'prospect')
    for (const c of (data ?? []) as Array<Record<string, unknown>>) {
      records.push({
        kind: 'person',
        id: c.id as string,
        name: contactName(c as { first_name?: string | null; last_name?: string | null; name?: string | null }),
        phone: (c.phone_e164 as string | null) ?? (c.phone as string | null),
      })
      contactFlagsById.set(c.id as string, { whatsappOptIn: Boolean(c.whatsapp_opt_in) })
    }
  }
  if (accountIds.length) {
    const { data } = await supabase
      .from('accounts')
      .select('id, name, phone')
      .in('id', accountIds)
      .eq('lifecycle_stage', 'prospect')
    for (const a of (data ?? []) as Array<Record<string, unknown>>) {
      records.push({
        kind: 'company',
        id: a.id as string,
        name: a.name as string | null,
        phone: a.phone as string | null,
      })
    }
  }

  const resolved = resolveProspectRecipients(records, { cap: WHATSAPP_BULK_CAP })
  if (resolved.recipients.length === 0) {
    return { ok: false, error: 'None of the selected prospects have a usable phone number.' }
  }

  let sent = 0
  let failed = 0
  let skippedDnd = 0
  let skippedOptIn = 0
  const touchedContacts: string[] = []
  const touchedAccounts: string[] = []
  // MARKETING-category templates are opt-in-gated for contacts (Meta policy);
  // UTILITY/AUTHENTICATION and the free-text Evolution rail are not. Company
  // prospects have no whatsapp_opt_in column at all and are never gated here.
  const isMarketing = templateCategory === 'MARKETING'

  for (let i = 0; i < resolved.recipients.length; i += WHATSAPP_BATCH_SIZE) {
    const batch = resolved.recipients.slice(i, i + WHATSAPP_BATCH_SIZE)

    for (const recipient of batch) {
      if (recipient.kind === 'person') {
        const dnd = await checkDnd(recipient.id, 'whatsapp', supabase)
        if (dnd.blocked) {
          skippedDnd += 1
          continue
        }
        if (isMarketing && !contactFlagsById.get(recipient.id)?.whatsappOptIn) {
          skippedOptIn += 1
          continue
        }
      }

      let sendOk = false
      let sendError: string | null = null

      if (mode === 'meta_cloud' && cloudAccount) {
        const bodyVariables = (input.bodyVariables ?? []).map((v) => applyNameToken(v, recipient.name))
        const res = await sendCloudTemplate({
          account: cloudAccount,
          to: recipient.phone,
          templateName,
          language: templateLanguage,
          bodyVariables,
        })
        sendOk = res.ok
        sendError = res.ok ? null : res.error

        if (res.ok && recipient.kind === 'person') {
          const summary =
            bodyVariables.length > 0 ? `[Template: ${templateName}] ${bodyVariables.join(' · ')}` : `[Template: ${templateName}]`
          const conversationId = await findOrCreateWhatsAppConversationId(
            supabase,
            org,
            recipient.id,
            recipient.phone,
            recipient.name,
            'meta_cloud',
            cloudAccount.phoneNumberId,
          )
          if (conversationId) {
            try {
              await supabase.from('conversation_messages').insert({
                conversation_id: conversationId,
                org_id: org,
                role: 'assistant',
                content: summary,
                metadata: {
                  channel: 'whatsapp',
                  provider: 'meta_cloud',
                  source: 'template',
                  template_name: templateName,
                  template_language: templateLanguage,
                  body_variables: bodyVariables,
                  wamid: res.ok ? res.wamid : null,
                },
              })
            } catch (err) {
              console.error('[prospects:whatsapp] meta_cloud message persist error:', err)
            }
            await bumpWhatsAppConversation(supabase, conversationId, summary)
          }
        }
      } else if (mode === 'zernio' && zernioApiKey && zernioProfileId) {
        const bodyVariables = (input.bodyVariables ?? []).map((v) => applyNameToken(v, recipient.name))
        const res = await sendZernioWhatsappTemplate({
          apiKey: zernioApiKey,
          profileId: zernioProfileId,
          accountId: zernioAccountId,
          phone: recipient.phone,
          templateName,
          language: templateLanguage,
          bodyVariables,
        })
        sendOk = res.ok
        sendError = res.ok ? null : res.error
        // Inbox mirroring deliberately skipped for Zernio: a cold broadcast
        // send has no established zernio_conversation_id (Zernio assigns one
        // only once the recipient's thread exists on their side, surfaced to
        // us later via their webhook) — see report for detail.
      } else {
        const text = applyNameToken(input.freeText ?? '', recipient.name)
        const conversationId =
          recipient.kind === 'person'
            ? await findOrCreateWhatsAppConversationId(supabase, org, recipient.id, recipient.phone, recipient.name, evoProviderTag)
            : null
        const res = await sendWhatsAppMessage({
          orgId: org,
          to: recipient.phone,
          text,
          conversationId: conversationId ?? undefined,
          role: 'assistant',
        })
        sendOk = res.ok
        sendError = res.ok ? null : res.error ?? 'WhatsApp send failed.'
        if (res.ok && conversationId) {
          await bumpWhatsAppConversation(supabase, conversationId, text)
        }
      }

      if (sendOk) {
        sent += 1
        if (recipient.kind === 'person') touchedContacts.push(recipient.id)
        else touchedAccounts.push(recipient.id)
      } else {
        failed += 1
        console.error(`[prospects:whatsapp] send failed for ${recipient.kind}:${recipient.id}:`, sendError)
      }
    }

    if (i + WHATSAPP_BATCH_SIZE < resolved.recipients.length) {
      await new Promise((r) => setTimeout(r, WHATSAPP_BATCH_DELAY_MS))
    }
  }

  if (touchedContacts.length || touchedAccounts.length) {
    await markContacted(supabase, touchedContacts, touchedAccounts, 'whatsapp', 'whatsapp')
  }

  revalidatePath('/prospects')
  return {
    ok: true,
    sent,
    failed,
    skippedDnd,
    skippedOptIn,
    skippedNoPhone: resolved.skippedNoPhone,
    skippedDuplicate: resolved.skippedDuplicate,
    remaining: resolved.truncated,
  }
}
