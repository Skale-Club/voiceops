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
import {
  accountEmailFromCustomFields,
  deriveRecommendedChannel,
  resolveRecommendedChannel,
} from '@/lib/prospects/recommended-channel'
import { runAnalysis } from '@/services/website-analyzer'
import { mergePresentJson, mergeProspectCustomFields } from '@/lib/prospects/web-presence-merge'
import { registerExternalRunWithXmail } from '@/lib/xmail/external-run-mapping'
import { DEFAULT_STALE_MINUTES, isAnalysisRowStale } from '@/services/website-analyzer/staleness'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'
export const maxDuration = 60

const INGEST_CONCURRENCY = 5

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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

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
  const reportedTotal = typeof source.metadata?.result_count === 'number' && Number.isFinite(source.metadata.result_count)
    ? Math.max(prospects.length, Math.floor(source.metadata.result_count))
    : prospects.length
  let runId: string | null = null

  if (externalRunId) {
    const { data: existingRun } = await supabase
      .from('prospect_sources')
      .select('id')
      .eq('org_id', orgId)
      .eq('source_type', sourceType)
      .eq('external_run_id', externalRunId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    runId = existingRun?.id ?? null
  }

  if (runId) {
    await supabase
      .from('prospect_sources')
      .update({
        source_key: sourceKey,
        label: source.label?.trim() || null,
        status: 'running',
        total_count: reportedTotal,
        metadata: (source.metadata ?? {}) as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('org_id', orgId)
  } else {
    const { data: run, error: runError } = await supabase
      .from('prospect_sources')
      .insert({
        org_id: orgId,
        source_type: sourceType,
        source_key: sourceKey,
        label: source.label?.trim() || null,
        external_run_id: externalRunId,
        status: 'running',
        total_count: reportedTotal,
        metadata: (source.metadata ?? {}) as Json,
      })
      .select('id')
      .single()

    if (runError?.code === '23505' && externalRunId) {
      const { data: concurrentRun } = await supabase
        .from('prospect_sources')
        .select('id')
        .eq('org_id', orgId)
        .eq('source_type', sourceType)
        .eq('external_run_id', externalRunId)
        .maybeSingle()
      runId = concurrentRun?.id ?? null
    } else {
      runId = run?.id ?? null
    }
  }
  const defaultCountry = source.default_country?.trim() || null

  // ── 4. Ingest each prospect ──────────────────────────────────────────────────
  const results: IngestOutcome[] = []
  let errors = 0
  const outcomes = await mapWithConcurrency(prospects, INGEST_CONCURRENCY, async (p) => {
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
        // Auto-trigger website analysis for newly created company prospects that have a domain
        if (outcome.kind === 'company' && outcome.action === 'created' && p.domain?.trim()) {
          triggerAnalysisForAccount(supabase, orgId, outcome.id, p.domain.trim())
        }
      }
      return outcome
    } catch (err) {
      errors++
      console.error('[api/v1/prospects] ingest error:', err)
      return null
    }
  })
  results.push(...outcomes.filter((outcome): outcome is IngestOutcome => outcome !== null))

  const created = results.filter((r) => r.action === 'created').length
  const updated = results.filter((r) => r.action === 'updated').length
  const skipped = results.filter((r) => r.action === 'skipped').length
  let importedCount = created + updated

  // ── 5. Close the run + touch the key ─────────────────────────────────────────
  if (runId) {
    const { count: distinctImportedCount } = await supabase
      .from('prospect_engagement_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('event_type', 'imported')
      .contains('payload', { source_run_id: runId })
    importedCount = distinctImportedCount ?? importedCount
    await supabase
      .from('prospect_sources')
      .update({ status: 'completed', imported_count: importedCount, updated_at: new Date().toISOString() })
      .eq('id', runId)
  }
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {})

  // Cost attribution (best-effort): register this run with
  // Xmail so it can attribute outreach outcomes back to what it cost to
  // source them. The helper never throws, so Xmail availability cannot break
  // a completed import.
  await registerExternalRunWithXmail(sourceType, externalRunId, source, reportedTotal, importedCount)

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
      .select('id, status, updated_at')
      .eq('account_id', accountId)
      .eq('org_id', orgId)
      .in('status', ['pending', 'running'])
      .limit(1)
      .maybeSingle()

    if (existing) {
      if (!isAnalysisRowStale(existing, new Date())) {
        console.log(`[orchestration] analysis already in progress for account_id=${accountId}, skipping`)
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('reclaim_stale_website_analyses', {
        p_stale_minutes: DEFAULT_STALE_MINUTES,
        p_account_id: accountId,
      })
      console.log(`[orchestration] reclaimed orphaned analysis for account_id=${accountId}`)
    }

    const { data: analysis, error: insertError } = await wa
      .insert({ org_id: orgId, account_id: accountId, status: 'pending' })
      .select('id')
      .single()

    if (insertError?.code === '23505') {
      console.log(`[orchestration] analysis for account_id=${accountId} claimed concurrently, skipping`)
      return
    }

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
  let existing: { id: string; lifecycle_stage: string; recommended_channel: string | null; email: string | null; phone: string | null } | null = null
  if (sourceId) {
    const { data } = await supabase
      .from('contacts')
      .select('id, lifecycle_stage, recommended_channel, email, phone')
      .eq('org_id', orgId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && emailNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id, lifecycle_stage, recommended_channel, email, phone')
      .eq('org_id', orgId)
      .eq('email_normalized', emailNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && phoneNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id, lifecycle_stage, recommended_channel, email, phone')
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
    if (p.score !== undefined) patch.score = p.score
    // Same fill-only-when-empty rule as the company path above.
    if (p.recommended_channel !== undefined) {
      patch.recommended_channel = p.recommended_channel
    } else if (!existing.recommended_channel) {
      const derived = deriveRecommendedChannel({
        email: emailNorm ?? existing.email,
        phone: phoneNorm ?? existing.phone,
      })
      if (derived) patch.recommended_channel = derived
    }
    // Direct run linkage for prospects_verify (Fase 34, migration 1298) — see
    // that migration's comment for why source_id alone isn't enough. A
    // re-import always attributes to the run that touched it most recently.
    if (runId) patch.prospect_source_id = runId
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
      recommended_channel: resolveRecommendedChannel(p.recommended_channel, {
        email: emailNorm,
        phone: phoneNorm,
      }),
      score: p.score ?? 0,
      source_type: sourceType,
      source_id: sourceId,
      // Direct run linkage for prospects_verify (Fase 34, migration 1298) —
      // see that migration's comment for why source_id alone isn't enough.
      prospect_source_id: runId,
      // Also record the identity the CRM mirror (/api/v1/sync) keys on, so an
      // app that pushes a prospect here and later mirrors a deal for the same
      // record lands on this row instead of creating a second one.
      ...(sourceId ? { external_source: sourceType, external_id: sourceId } : {}),
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
  const domainWasProvided = Object.prototype.hasOwnProperty.call(p, 'domain')
  const domain = p.domain?.trim() || null
  const sourceId = p.source_id?.trim() || null
  const phoneCountry = p.phone_country ?? defaultCountry

  if (!name && !domain && !sourceId) return null

  // A stable provider id is authoritative within its source. If it is present but
  // unknown, this is a new entity: falling through to domain/name can merge unrelated
  // local businesses that share facebook.com, instagram.com, Booksy, or another host.
  // Domain/name remain useful fallbacks only for records without a provider identity.
  type ExistingAccount = {
    id: string
    lifecycle_stage: string
    custom_fields: Record<string, unknown> | null
    source_payload: Json | null
    recommended_channel: string | null
    phone: string | null
  }
  let existing: ExistingAccount | null = null
  const existingColumns = 'id, lifecycle_stage, custom_fields, source_payload, recommended_channel, phone'
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
  if (!existing && !sourceId && domain) {
    const { data } = await supabase
      .from('accounts')
      .select(existingColumns)
      .eq('org_id', orgId)
      .eq('domain', domain)
      .maybeSingle()
    if (data) existing = data
  }
  if (!existing && !sourceId && name) {
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
    if (domainWasProvided) patch.domain = domain
    const normalizedPhone = normalizePhoneToE164(p.phone, phoneCountry)
    if (normalizedPhone) patch.phone = normalizedPhone
    if (p.tags?.length) patch.tags = p.tags
    if (p.intent_level) patch.intent_level = p.intent_level
    if (p.qualification_status) patch.qualification_status = p.qualification_status
    if (p.score !== undefined) patch.score = p.score
    patch.custom_fields = mergeProspectCustomFields(existing.custom_fields, p.custom_fields)
    patch.source_payload = mergePresentJson(existing.source_payload, p.source_payload)

    // Fill the channel only when it is still empty, so a re-import can heal a row
    // that predates the field without ever overriding a decision already recorded.
    if (p.recommended_channel !== undefined) {
      patch.recommended_channel = p.recommended_channel
    } else if (!existing.recommended_channel) {
      const derived = deriveRecommendedChannel({
        email: accountEmailFromCustomFields(patch.custom_fields),
        phone: normalizedPhone ?? existing.phone,
      })
      if (derived) patch.recommended_channel = derived
    }
    if (p.custom_fields && Object.prototype.hasOwnProperty.call(p.custom_fields, 'website')) {
      const website = typeof p.custom_fields.website === 'string' ? p.custom_fields.website.trim() : ''
      patch.website = website || null
    }
    // Direct run linkage for prospects_verify (Fase 34, migration 1298) — see
    // that migration's comment for why source_id alone isn't enough. A
    // re-import always attributes to the run that touched it most recently.
    if (runId) patch.prospect_source_id = runId

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
      recommended_channel: resolveRecommendedChannel(p.recommended_channel, {
        email: accountEmailFromCustomFields(p.custom_fields),
        phone: normalizePhoneToE164(p.phone, phoneCountry),
      }),
      score: p.score ?? 0,
      source_type: sourceType,
      source_id: sourceId,
      // Direct run linkage for prospects_verify (Fase 34, migration 1298) —
      // see that migration's comment for why source_id alone isn't enough.
      prospect_source_id: runId,
      // Also record the identity the CRM mirror (/api/v1/sync) keys on, so an
      // app that pushes a prospect here and later mirrors a deal for the same
      // record lands on this row instead of creating a second one.
      ...(sourceId ? { external_source: sourceType, external_id: sourceId } : {}),
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
