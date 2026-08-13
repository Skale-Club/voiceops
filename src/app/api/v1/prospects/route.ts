// POST /api/v1/prospects
// Public REST endpoint — ingests prospect-stage records into the caller's org.
//
// Auth: Authorization: Bearer <token>
//   Token is SHA-256 hashed and looked up in api_keys.key_hash.
//   The key must hold the `prospects:write` scope.
//
// Body accepts a single prospect OR a batch:
//   single: { kind?, name?, email?, phone?, company?, domain?, tags?, ... }
//   batch:  { source?: {...}, prospects: [ {...}, ... ] }
//
// Records are created with lifecycle_stage = 'prospect'. A person becomes a
// contact, a company becomes an account. Dedup is by source_id → email/phone
// (person) or source_id → domain/name (company). If a matching record already
// exists OUTSIDE the prospect stage (already promoted into the CRM), it is left
// untouched and reported as `skipped` — ingestion never pulls a real contact
// back to the prospect stage.
//
// Every batch creates a prospect_sources run and an `imported` engagement event
// per created/updated record.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { normalizePhoneToE164 } from '@/lib/phone-numbers/normalize'
import { hasScope } from '@/lib/api-keys/scopes'
import { markMetaAudiencesDirty } from '@/lib/meta/audience-dirty'
import { runAnalysis } from '@/services/website-analyzer'
import { registerExternalRunWithXmail } from '@/lib/xmail/external-run-mapping'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const prospectSchema = z.object({
  kind: z.enum(['person', 'company']).default('person'),
  name: z.string().min(1).max(200).optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  // ISO 3166-1 alpha-2 (e.g. "US", "BR", "PT") — tells us how to read a bare
  // national-format `phone` (no leading "+"). Falls back to `source.default_country`.
  phone_country: z.string().length(2).optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  domain: z.string().max(255).optional().nullable(),
  tags: z.array(z.string().min(1).max(60)).max(50).optional(),
  intent_level: z.enum(['none', 'low', 'medium', 'high']).optional(),
  qualification_status: z.enum(['unqualified', 'needs_review', 'qualified']).optional(),
  recommended_channel: z
    .enum(['email', 'sms', 'whatsapp', 'call', 'visit', 'linkedin'])
    .optional()
    .nullable(),
  score: z.number().int().min(0).max(100).optional(),
  source_id: z.string().max(200).optional().nullable(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  source_payload: z.record(z.string(), z.unknown()).optional(),
})

const sourceSchema = z.object({
  type: z.string().min(1).max(60).optional(),
  key: z.string().max(60).optional(),
  label: z.string().max(200).optional(),
  external_run_id: z.string().max(200).optional(),
  // ISO 3166-1 alpha-2 country for this whole run (e.g. a scrape run scoped
  // to one country) — used as the phone_country fallback for every record
  // in the batch that doesn't set its own.
  default_country: z.string().length(2).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const batchSchema = z.object({
  source: sourceSchema.optional(),
  prospects: z.array(prospectSchema).min(1).max(1000),
})

type Prospect = z.infer<typeof prospectSchema>
type SourceMeta = z.infer<typeof sourceSchema>

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

type IngestOutcome = { id: string; kind: 'person' | 'company'; action: 'created' | 'updated' | 'skipped' }

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!apiKey) {
    return Response.json({ error: 'Invalid or revoked API key' }, { status: 401, headers: CORS_HEADERS })
  }
  if (!hasScope(apiKey.scopes, 'prospects:write')) {
    return Response.json(
      { error: 'API key is missing the prospects:write scope' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // ── 2. Parse body (single or batch) ──────────────────────────────────────────
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 422, headers: CORS_HEADERS })
  }

  const isBatch = typeof raw === 'object' && raw !== null && 'prospects' in raw
  let prospects: Prospect[]
  let source: SourceMeta
  try {
    if (isBatch) {
      const parsed = batchSchema.parse(raw)
      prospects = parsed.prospects
      source = parsed.source ?? {}
    } else {
      prospects = [prospectSchema.parse(raw)]
      source = {}
    }
  } catch (err) {
    return Response.json(
      { error: 'Invalid request body', details: (err as z.ZodError).errors },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  const orgId = apiKey.org_id
  const sourceType = source.type?.trim() || 'api'
  const sourceKey = source.key?.trim() || null
  const externalRunId = source.external_run_id?.trim() || null

  // ── 3. Open a source/run row ─────────────────────────────────────────────────
  const { data: run } = await supabase
    .from('prospect_sources')
    .insert({
      org_id: orgId,
      source_type: sourceType,
      source_key: sourceKey,
      label: source.label?.trim() || null,
      external_run_id: externalRunId,
      status: 'running',
      total_count: prospects.length,
      metadata: (source.metadata ?? {}) as Json,
    })
    .select('id')
    .single()

  const runId = run?.id ?? null
  const defaultCountry = source.default_country?.trim() || null

  // ── 4. Ingest each prospect ──────────────────────────────────────────────────
  const results: IngestOutcome[] = []
  let errors = 0
  for (const p of prospects) {
    try {
      const outcome =
        p.kind === 'company'
          ? await ingestCompany(supabase, orgId, p, sourceType, runId, defaultCountry)
          : await ingestPerson(supabase, orgId, p, sourceType, runId, defaultCountry)
      if (outcome) {
        if (outcome.action !== 'skipped') {
          await markMetaAudiencesDirty(supabase, {
            orgId,
            reason: 'prospect_ingestion',
            sourceType,
            entityType: outcome.kind === 'company' ? 'account' : 'contact',
            entityId: outcome.id,
          })
        }
        results.push(outcome)
        // Auto-trigger website analysis for newly created company prospects that have a domain
        if (outcome.kind === 'company' && outcome.action === 'created' && p.domain?.trim()) {
          triggerAnalysisForAccount(supabase, orgId, outcome.id, p.domain.trim())
        }
      }
    } catch (err) {
      errors++
      console.error('[api/v1/prospects] ingest error:', err)
    }
  }

  const created = results.filter((r) => r.action === 'created').length
  const updated = results.filter((r) => r.action === 'updated').length
  const skipped = results.filter((r) => r.action === 'skipped').length

  // ── 5. Close the run + touch the key ─────────────────────────────────────────
  if (runId) {
    await supabase
      .from('prospect_sources')
      .update({ status: 'completed', imported_count: created + updated, updated_at: new Date().toISOString() })
      .eq('id', runId)
  }
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {})

  // Cost attribution (best-effort, fire-and-forget): register this run with
  // Xmail so it can attribute outreach outcomes back to what it cost to
  // source them. Must never affect this endpoint's response, status, or
  // latency — see registerExternalRunWithXmail's doc comment.
  registerExternalRunWithXmail(sourceType, externalRunId, source, prospects.length, created + updated)

  // ── 6. Respond ───────────────────────────────────────────────────────────────
  if (!isBatch) {
    const only = results[0]
    if (!only) {
      return Response.json({ error: 'Failed to ingest prospect' }, { status: 500, headers: CORS_HEADERS })
    }
    return Response.json(
      { id: only.id, kind: only.kind, action: only.action },
      { status: only.action === 'created' ? 201 : 200, headers: CORS_HEADERS },
    )
  }

  return Response.json(
    { source_id: runId, total: prospects.length, created, updated, skipped, errors, results },
    { status: 201, headers: CORS_HEADERS },
  )
}

// ── helpers ────────────────────────────────────────────────────────────────────

type ServiceClient = ReturnType<typeof createServiceRoleClient>

function isNonEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim().length > 0)
}

function mergePresentJson(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {}
  const incomingRecord = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
    ? incoming as Record<string, unknown>
    : {}
  const merged: Record<string, unknown> = { ...existingRecord }
  for (const [key, value] of Object.entries(incomingRecord)) {
    if (!isNonEmpty(value)) continue
    const current = merged[key]
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      current && typeof current === 'object' && !Array.isArray(current)
    ) {
      merged[key] = mergePresentJson(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      merged[key] = typeof value === 'string' ? value.trim() : value
    }
  }
  return merged
}

/**
 * Fire-and-forget: create a website_analyses row and kick off analysis for a
 * newly-ingested company prospect. Skips if an analysis is already running.
 */
function triggerAnalysisForAccount(
  supabase: ServiceClient,
  orgId: string,
  accountId: string,
  domain: string,
): void {
  ;(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wa = (supabase as any).from('website_analyses')
    // Avoid duplicate runs: skip if a running/pending row already exists
    const { data: existing } = await wa
      .select('id, status')
      .eq('account_id', accountId)
      .in('status', ['pending', 'running'])
      .limit(1)
      .maybeSingle()

    if (existing) {
      console.log(`[orchestration] analysis already in progress for account_id=${accountId}, skipping`)
      return
    }

    const { data: analysis, error: insertError } = await wa
      .insert({ org_id: orgId, account_id: accountId, status: 'pending' })
      .select('id')
      .single()

    if (insertError || !analysis) {
      console.error('[orchestration] failed to create analysis row for account_id=' + accountId, insertError)
      return
    }

    console.log(`[orchestration] triggered analysis for account_id=${accountId} domain=${domain}`)
    runAnalysis({ analysisId: analysis.id, orgId, accountId, domain }).catch((err) =>
      console.error('[orchestration] runAnalysis error for account_id=' + accountId + ':', err),
    )
  })().catch((err) => console.error('[orchestration] triggerAnalysisForAccount error:', err))
}

async function recordImport(
  supabase: ServiceClient,
  orgId: string,
  entityType: 'contact' | 'account',
  entityId: string,
  sourceType: string,
  runId: string | null,
) {
  await supabase.from('prospect_engagement_events').insert({
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: 'imported',
    source_platform: sourceType,
    payload: (runId ? { source_run_id: runId } : {}) as Json,
  })
}

async function ingestPerson(
  supabase: ServiceClient,
  orgId: string,
  p: Prospect,
  sourceType: string,
  runId: string | null,
  defaultCountry: string | null,
): Promise<IngestOutcome | null> {
  const phoneNorm = normalizePhoneToE164(p.phone, p.phone_country ?? defaultCountry)
  const emailNorm = normaliseEmail(p.email)
  const sourceId = p.source_id?.trim() || null

  if (!phoneNorm && !emailNorm && !p.name && !sourceId) return null

  // Dedup: source_id → email → phone
  let existing: { id: string; lifecycle_stage: string } | null = null
  if (sourceId) {
    const { data } = await supabase
      .from('contacts')
      .select('id, lifecycle_stage')
      .eq('org_id', orgId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && emailNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id, lifecycle_stage')
      .eq('org_id', orgId)
      .eq('email_normalized', emailNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && phoneNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id, lifecycle_stage')
      .eq('org_id', orgId)
      .eq('phone_e164', phoneNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existing = data
  }

  if (existing) {
    // Never pull a record that already moved into the CRM back to prospect.
    if (existing.lifecycle_stage !== 'prospect') {
      return { id: existing.id, kind: 'person', action: 'skipped' }
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (p.name) patch.name = p.name
    if (phoneNorm) patch.phone = phoneNorm
    if (emailNorm) patch.email = emailNorm
    if (p.company) patch.company = p.company
    if (p.tags?.length) patch.tags = p.tags
    if (p.intent_level) patch.intent_level = p.intent_level
    if (p.qualification_status) patch.qualification_status = p.qualification_status
    if (p.recommended_channel !== undefined) patch.recommended_channel = p.recommended_channel
    if (p.score !== undefined) patch.score = p.score
    const { error } = await supabase
      .from('contacts')
      .update(patch)
      .eq('id', existing.id)
      .eq('org_id', orgId)
    if (error) throw new Error('Could not update prospect contact')
    await recordImport(supabase, orgId, 'contact', existing.id, sourceType, runId)
    return { id: existing.id, kind: 'person', action: 'updated' }
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name: p.name ?? null,
      phone: phoneNorm,
      email: emailNorm,
      company: p.company ?? null,
      tags: p.tags ?? [],
      source: 'api',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: p.intent_level ?? 'none',
      qualification_status: p.qualification_status ?? 'needs_review',
      recommended_channel: p.recommended_channel ?? null,
      score: p.score ?? 0,
      source_type: sourceType,
      source_id: sourceId,
      source_payload: (p.source_payload ?? {}) as Json,
      custom_fields: (p.custom_fields ?? {}) as Record<string, unknown>,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[api/v1/prospects] person insert error:', error)
    return null
  }
  await recordImport(supabase, orgId, 'contact', data.id, sourceType, runId)
  return { id: data.id, kind: 'person', action: 'created' }
}

async function ingestCompany(
  supabase: ServiceClient,
  orgId: string,
  p: Prospect,
  sourceType: string,
  runId: string | null,
  defaultCountry: string | null,
): Promise<IngestOutcome | null> {
  const name = (p.name ?? p.company)?.trim() || null
  const domain = p.domain?.trim() || null
  const sourceId = p.source_id?.trim() || null
  const phoneCountry = p.phone_country ?? defaultCountry

  if (!name && !domain && !sourceId) return null

  // Dedup: source_id → domain → name
  type ExistingAccount = {
    id: string
    lifecycle_stage: string
    custom_fields: Record<string, unknown> | null
    source_payload: Json | null
  }
  let existing: ExistingAccount | null = null
  const existingColumns = 'id, lifecycle_stage, custom_fields, source_payload'
  if (sourceId) {
    const { data } = await supabase
      .from('accounts')
      .select(existingColumns)
      .eq('org_id', orgId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && domain) {
    const { data } = await supabase
      .from('accounts')
      .select(existingColumns)
      .eq('org_id', orgId)
      .eq('domain', domain)
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && name) {
    const { data } = await supabase
      .from('accounts')
      .select(existingColumns)
      .eq('org_id', orgId)
      .ilike('name', name)
      .eq('lifecycle_stage', 'prospect')
      .maybeSingle()
    if (data) existing = data
  }

  if (existing) {
    if (existing.lifecycle_stage !== 'prospect') {
      return { id: existing.id, kind: 'company', action: 'skipped' }
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name) patch.name = name
    if (domain) patch.domain = domain
    const normalizedPhone = normalizePhoneToE164(p.phone, phoneCountry)
    if (normalizedPhone) patch.phone = normalizedPhone
    if (p.tags?.length) patch.tags = p.tags
    if (p.intent_level) patch.intent_level = p.intent_level
    if (p.qualification_status) patch.qualification_status = p.qualification_status
    if (p.recommended_channel !== undefined) patch.recommended_channel = p.recommended_channel
    if (p.score !== undefined) patch.score = p.score
    patch.custom_fields = mergePresentJson(existing.custom_fields, p.custom_fields)
    patch.source_payload = mergePresentJson(existing.source_payload, p.source_payload)
    const website = typeof p.custom_fields?.website === 'string' ? p.custom_fields.website.trim() : ''
    if (website) patch.website = website

    const { error } = await supabase
      .from('accounts')
      .update(patch)
      .eq('id', existing.id)
      .eq('org_id', orgId)
    if (error) throw new Error('Could not update prospect account')
    await recordImport(supabase, orgId, 'account', existing.id, sourceType, runId)
    return { id: existing.id, kind: 'company', action: 'updated' }
  }

  const websiteFromCustomFields =
    typeof p.custom_fields?.website === 'string' ? (p.custom_fields.website as string).trim() || null : null

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      org_id: orgId,
      name: name ?? 'Untitled company',
      domain,
      website: websiteFromCustomFields,
      phone: normalizePhoneToE164(p.phone, phoneCountry),
      tags: p.tags ?? [],
      source: 'manual',
      lifecycle_stage: 'prospect',
      engagement_status: 'not_contacted',
      intent_level: p.intent_level ?? 'none',
      qualification_status: p.qualification_status ?? 'needs_review',
      recommended_channel: p.recommended_channel ?? null,
      score: p.score ?? 0,
      source_type: sourceType,
      source_id: sourceId,
      source_payload: (p.source_payload ?? {}) as Json,
      custom_fields: (p.custom_fields ?? {}) as Record<string, unknown>,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[api/v1/prospects] company insert error:', error)
    return null
  }
  await recordImport(supabase, orgId, 'account', data.id, sourceType, runId)
  return { id: data.id, kind: 'company', action: 'created' }
}
