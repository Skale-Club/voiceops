// Generic CRM mirror — the shared engine behind POST /api/v1/sync.
//
// Mirrors one tenant of a sibling platform app (Xtimator, XmartMenu, Xkedule, …)
// into the caller-org's CRM as an Account (the business) + Contact (the owner) +
// Opportunity (the subscription/lifecycle deal), optionally appending a timeline
// Note. The integration is identified by `source` (→ external_source); the only
// per-app variable beyond that is the target pipeline name.
//
// This is the de-hardcoded form of the original /api/xtimator/webhook handler:
// `source` and `pipelineName` are now inputs instead of module constants, so every
// app shares one contract. Idempotency + ordering are unchanged — dedup by
// (org, external_source, external_id) with last-write-wins on external_updated_at
// vs the event's occurred_at.

import { z } from 'zod'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'

// Untyped service-role client: the mirror columns (external_source on
// contacts/accounts, external_* on opportunities) land via migration 1237 and
// aren't in the generated Database types yet — same pattern the receiver used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MirrorDb = any

// The coordinated wire contract. Identical to the original Xtimator payload plus
// a required `source` discriminator and an optional `opportunity.pipeline` so each
// app declares its own pipeline by name (Xphere stays decoupled from app vocab).
export const mirrorPayloadSchema = z.object({
  source: z.string().min(1).max(100),
  event: z.string(),
  delivery_id: z.string().optional(),
  occurred_at: z.string(),
  company: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().min(1),
    owner_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  }),
  opportunity: z
    .object({
      stage: z.string().min(1),
      status: z.enum(['open', 'won', 'lost']).optional(),
      value: z.number().nonnegative().optional(),
      // ISO 4217 currency for the deal value. Defaults to USD when omitted
      // (Xtimator); XmartMenu sends e.g. 'BRL'.
      currency: z.string().min(1).max(8).optional(),
      title: z.string().optional(),
      // Target pipeline name in the caller's org. When omitted, the route falls
      // back to a per-source convention ("<Source> Lifecycle").
      pipeline: z.string().min(1).optional(),
      // Identity of THIS opportunity within the source. Omitted (Xtimator,
      // XmartMenu, Xkedule) the company id is the key and a company has one
      // lifecycle deal, as before. Set (Xpot: one per field sale) each value
      // is its own row under the same account.
      external_id: z.string().min(1).max(200).optional(),
    })
    .optional(),
  note: z
    .object({
      title: z.string().optional(),
      content: z.string().min(1),
      // Optional idempotency hint from the source (e.g. a Stripe event id).
      // ACCEPTED but not yet enforced — notes have no dedup column, so a
      // redelivered event can still append a duplicate note. TODO: add a
      // notes.dedup_id column + unique index to make notes idempotent.
      dedup_id: z.string().optional(),
    })
    .optional(),
})

export type MirrorPayload = z.infer<typeof mirrorPayloadSchema>
type Company = MirrorPayload['company']

export interface MirrorInput {
  source: string
  pipelineName: string
  company: Company
  opportunity?: NonNullable<MirrorPayload['opportunity']>
  note?: NonNullable<MirrorPayload['note']>
  occurredAt: string
}

export interface MirrorResult {
  account_id: string | null
  contact_id: string | null
  opportunity_id: string | null
  opportunity_skipped?: string
  stale?: boolean
}

/** Convention fallback when an app doesn't declare opportunity.pipeline. */
export function defaultPipelineName(source: string): string {
  return `${source.charAt(0).toUpperCase()}${source.slice(1)} Lifecycle`
}

async function upsertAccount(
  supabase: MirrorDb,
  orgId: string,
  source: string,
  companyId: string,
  c: Company,
  occurredAt: string,
): Promise<{ id: string | null; stale: boolean }> {
  let { data: existing } = await supabase
    .from('accounts')
    .select('id, external_updated_at')
    .eq('org_id', orgId)
    .eq('external_source', source)
    .eq('external_id', companyId)
    .maybeSingle()

  // The same app may have created this account earlier through
  // POST /api/v1/prospects, which records its identity as source_type +
  // source_id rather than external_source + external_id. Without this
  // fallback a company that came in as a prospect and later closes a deal
  // became two accounts. Adopt the prospect row and claim it for the mirror.
  if (!existing) {
    const { data: prospect } = await supabase
      .from('accounts')
      .select('id, external_updated_at')
      .eq('org_id', orgId)
      .eq('source_type', source)
      .eq('source_id', companyId)
      .is('external_source', null)
      .maybeSingle()
    if (prospect) existing = { id: prospect.id, external_updated_at: null }
  }

  const fields = {
    name: c.name,
    industry: c.industry ?? null,
    website: c.website ?? null,
    phone: normalisePhone(c.phone ?? null),
    address: c.address ?? null,
    external_source: source,
    external_id: companyId,
    external_updated_at: occurredAt,
  }

  if (existing) {
    // Account is the ordering anchor: a newer mirror state means a stale event.
    if (existing.external_updated_at && new Date(existing.external_updated_at) >= new Date(occurredAt)) {
      return { id: existing.id, stale: true }
    }
    await supabase.from('accounts').update(fields).eq('id', existing.id)
    return { id: existing.id, stale: false }
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({ ...fields, org_id: orgId, source: 'manual' })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[crm-mirror] account insert error:', error)
    return { id: null, stale: false }
  }
  return { id: data.id, stale: false }
}

async function upsertContact(
  supabase: MirrorDb,
  orgId: string,
  source: string,
  companyId: string,
  c: Company,
  accountId: string | null,
  occurredAt: string,
): Promise<string | null> {
  const phoneNorm = normalisePhone(c.phone ?? null)
  const emailNorm = normaliseEmail(c.email ?? null)
  const name = c.owner_name || c.name

  // Match by mirror key first; fall back to phone/email so we adopt an existing
  // person rather than create a duplicate, then claim it for the mirror.
  let existingId: string | null = null
  let existingCustom: Record<string, unknown> = {}

  const claim = async (q: Promise<{ data: { id: string; custom_fields: Record<string, unknown> | null } | null }>) => {
    if (existingId) return
    const { data } = await q
    if (data) {
      existingId = data.id
      existingCustom = data.custom_fields ?? {}
    }
  }

  await claim(
    supabase
      .from('contacts')
      .select('id, custom_fields')
      .eq('org_id', orgId)
      .eq('external_source', source)
      .eq('external_id', companyId)
      .maybeSingle(),
  )
  if (!existingId && phoneNorm) {
    await claim(
      supabase
        .from('contacts')
        .select('id, custom_fields')
        .eq('org_id', orgId)
        .eq('phone_e164', phoneNorm)
        .neq('identity_status', 'archived_duplicate')
        .maybeSingle(),
    )
  }
  if (!existingId && emailNorm) {
    await claim(
      supabase
        .from('contacts')
        .select('id, custom_fields')
        .eq('org_id', orgId)
        .eq('email_normalized', emailNorm)
        .neq('identity_status', 'archived_duplicate')
        .maybeSingle(),
    )
  }

  const mergedCustom = { ...existingCustom, ...(c.custom_fields ?? {}) }

  if (existingId) {
    const patch: Record<string, unknown> = {
      name,
      company: c.name,
      account_id: accountId,
      custom_fields: mergedCustom,
      external_source: source,
      external_id: companyId,
      external_updated_at: occurredAt,
      updated_at: new Date().toISOString(),
    }
    if (phoneNorm) patch.phone = phoneNorm
    if (emailNorm) patch.email = emailNorm
    if (c.tags?.length) patch.tags = c.tags
    await supabase.from('contacts').update(patch).eq('id', existingId)
    return existingId
  }

  // Insert — the DB identity invariant (migration 1061) requires phone OR email.
  if (!phoneNorm && !emailNorm) {
    console.warn('[crm-mirror] contact skipped: no phone/email for company', companyId)
    return null
  }
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name,
      phone: phoneNorm,
      email: emailNorm,
      company: c.name,
      account_id: accountId,
      tags: c.tags ?? [],
      source: 'api',
      custom_fields: c.custom_fields ?? {},
      external_source: source,
      external_id: companyId,
      external_updated_at: occurredAt,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[crm-mirror] contact insert error:', error)
    return null
  }
  return data.id
}

async function upsertOpportunity(
  supabase: MirrorDb,
  orgId: string,
  source: string,
  pipelineName: string,
  companyId: string,
  opp: NonNullable<MirrorPayload['opportunity']>,
  contactId: string | null,
  accountId: string | null,
  companyName: string,
  occurredAt: string,
): Promise<{ id?: string; skipped?: string }> {
  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('id')
    .eq('org_id', orgId)
    .eq('name', pipelineName)
    .maybeSingle()
  if (!pipeline) return { skipped: 'no_pipeline' }

  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('id, is_won, is_lost')
    .eq('org_id', orgId)
    .eq('pipeline_id', pipeline.id)
    .eq('name', opp.stage)
    .maybeSingle()
  if (!stage) return { skipped: 'no_stage' }

  const status = opp.status ?? (stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'open')
  const title = opp.title || `${companyName} — Subscription`
  // The dedup key: the caller's own id for this deal when it sends one, else
  // the company — one lifecycle opportunity per company, the original shape.
  const oppKey = opp.external_id ?? companyId

  const { data: existing } = await supabase
    .from('opportunities')
    .select('id')
    .eq('org_id', orgId)
    .eq('external_source', source)
    .eq('external_id', oppKey)
    .maybeSingle()

  if (existing) {
    const patch: Record<string, unknown> = {
      stage_id: stage.id,
      status,
      title,
      external_updated_at: occurredAt,
    }
    if (opp.value != null) patch.value = opp.value
    if (opp.currency) patch.currency = opp.currency
    await supabase.from('opportunities').update(patch).eq('id', existing.id)
    return { id: existing.id }
  }

  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      org_id: orgId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      title,
      contact_id: contactId,
      account_id: accountId,
      value: opp.value ?? 0,
      currency: opp.currency ?? 'USD',
      status,
      external_source: source,
      external_id: oppKey,
      external_updated_at: occurredAt,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[crm-mirror] opportunity insert error:', error)
    return { skipped: 'insert_failed' }
  }
  return { id: data.id }
}

/**
 * Mirror one tenant into the org's CRM. Pure data work — auth, payload parsing
 * and the HTTP envelope live in the calling route. Returns the resolved ids (or
 * `stale: true` when a newer mirror state already exists).
 */
export async function runCrmMirror(
  supabase: MirrorDb,
  orgId: string,
  input: MirrorInput,
): Promise<MirrorResult> {
  const { source, pipelineName, company, opportunity, note, occurredAt } = input
  const companyId = String(company.id)

  // 1. Account (the ordering anchor for last-write-wins)
  const acc = await upsertAccount(supabase, orgId, source, companyId, company, occurredAt)
  if (acc.stale) {
    return { account_id: acc.id, contact_id: null, opportunity_id: null, stale: true }
  }
  const accountId = acc.id

  // 2. Contact (the owner) — linked to the account
  const contactId = await upsertContact(supabase, orgId, source, companyId, company, accountId, occurredAt)

  // 3. Opportunity (the subscription deal) — needs at least one party
  let opp: { id?: string; skipped?: string } = {}
  if (opportunity && (contactId || accountId)) {
    opp = await upsertOpportunity(
      supabase,
      orgId,
      source,
      pipelineName,
      companyId,
      opportunity,
      contactId,
      accountId,
      company.name,
      occurredAt,
    )
  }

  // 4. Note on the timeline (non-idempotent by design — one per event).
  // A company with no phone or email gets no contact row (migration 1061's
  // identity invariant), and the note used to be dropped with it. It goes on
  // the account instead — crm_entity_type allows it — so a field sale to a
  // shop that only gave its name still leaves its trace.
  const noteTarget = contactId
    ? { entity_type: 'contact', entity_id: contactId }
    : accountId
      ? { entity_type: 'account', entity_id: accountId }
      : null
  if (note && noteTarget) {
    const { error } = await supabase.from('notes').insert({
      org_id: orgId,
      title: note.title ?? null,
      content: note.content,
      ...noteTarget,
    })
    if (error) console.error('[crm-mirror] note insert error:', error)
  }

  return {
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opp.id ?? null,
    ...(opp.skipped ? { opportunity_skipped: opp.skipped } : {}),
  }
}
