// Cron: website-analyzer
// Reclaims analyses left stuck by a crashed/redeployed worker, then finds
// prospect accounts with no completed website analysis in the last 7 days and
// kicks off analysis for up to 10 at a time.
//
// Auth: Authorization: Bearer $CRON_SECRET
// Triggered by .github/workflows/website-analyzer.yml (every 10 minutes)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import { runAnalysis } from '@/services/website-analyzer'
import { captureApiError } from '@/lib/api-error'
import { DEFAULT_STALE_MINUTES } from '@/services/website-analyzer/staleness'
import { selectWebsiteAnalyzerBatch, DEFAULT_BATCH_SIZE, type AnalyzerCandidate } from '@/services/website-analyzer/scheduling'
import { getAnalyzerLoad } from '@/services/website-analyzer/concurrency'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) as any

  // ── Reclaim stale in-flight analyses first ─────────────────────────────────
  // Non-fatal: a failed reclaim must not stop this tick's scheduling work.
  const { data: reclaimed, error: reclaimError } = await supabase.rpc('reclaim_stale_website_analyses', {
    p_stale_minutes: DEFAULT_STALE_MINUTES,
  })
  if (reclaimError) {
    console.error('[cron/website-analyzer] failed to reclaim stale analyses:', reclaimError)
  } else {
    console.log(`[cron/website-analyzer] reclaimed ${Array.isArray(reclaimed) ? reclaimed.length : 0} stale analyses`)
  }

  // ── Find prospect accounts eligible for analysis ──────────────────────────
  // The ordering is load-bearing: the previous version fetched an UNORDERED
  // page and starved every account past the first 50. Never drop these
  // .order() calls while keeping the .limit().
  const { data: candidateRows, error: candidatesError } = await supabase
    .from('website_analyzer_candidates')
    .select('account_id, org_id, domain, name, last_analyzed_at, account_created_at')
    .order('last_analyzed_at', { ascending: true, nullsFirst: true })
    .order('account_created_at', { ascending: true })
    .limit(200)

  if (candidatesError) {
    console.error('[cron/website-analyzer] failed to fetch candidates:', candidatesError)
    return Response.json({ ok: false, error: 'Failed to fetch accounts' }, { status: 500 })
  }

  if (!candidateRows?.length) {
    return Response.json({ ok: true, processed: 0, accounts: [], reclaimed: Array.isArray(reclaimed) ? reclaimed.length : 0 })
  }

  const candidates: AnalyzerCandidate[] = (
    candidateRows as Array<{
      account_id: string
      org_id: string
      domain: string
      name: string | null
      last_analyzed_at: string | null
      account_created_at: string
    }>
  ).map((row) => ({
    accountId: row.account_id,
    orgId: row.org_id,
    domain: row.domain,
    name: row.name,
    lastAnalyzedAt: row.last_analyzed_at,
    accountCreatedAt: row.account_created_at,
  }))

  // ── Backpressure ───────────────────────────────────────────────────────────
  // Never schedule more than the browser pool can absorb. This tick used to
  // fire its full batch of 10 regardless of what earlier ticks were still
  // running; that overlap is what stacked 74 Chromium instances and took the
  // host down on 2026-08-30. Anything skipped here stays unclaimed and is
  // picked up later — the candidate query is ordered oldest-first, so
  // deferring work cannot starve an account.
  const load = getAnalyzerLoad()
  if (load.freeCapacity === 0) {
    console.log(
      `[cron/website-analyzer] analyzer saturated (${load.active} running, ${load.queued} queued) — skipping this tick`
    )
    return Response.json({
      ok: true,
      processed: 0,
      accounts: [],
      skipped: 'analyzer_busy',
      load,
      reclaimed: Array.isArray(reclaimed) ? reclaimed.length : 0,
    })
  }

  const eligible = selectWebsiteAnalyzerBatch(candidates, {
    now: new Date(),
    batchSize: Math.min(DEFAULT_BATCH_SIZE, load.freeCapacity),
  })

  if (!eligible.length) {
    return Response.json({ ok: true, processed: 0, accounts: [], reclaimed: Array.isArray(reclaimed) ? reclaimed.length : 0 })
  }

  // ── Kick off analysis for each eligible account ───────────────────────────
  const processed: Array<{ id: string; domain: string }> = []

  for (const account of eligible) {
    try {
      // Create pending analysis row
      const { data: analysis, error: insertError } = await supabase
        .from('website_analyses')
        .insert({ org_id: account.orgId, account_id: account.accountId, status: 'pending' })
        .select('id')
        .single()

      if (insertError?.code === '23505') {
        console.log(`[cron/website-analyzer] account ${account.accountId} claimed concurrently, skipping`)
        continue
      }

      if (insertError || !analysis) {
        console.error(`[cron/website-analyzer] failed to create analysis for account ${account.accountId}:`, insertError)
        continue
      }

      // Fire-and-forget
      runAnalysis({
        analysisId: analysis.id,
        orgId: account.orgId,
        accountId: account.accountId,
        domain: account.domain,
      }).catch((err) => {
        console.error(`[cron/website-analyzer] runAnalysis error for account=${account.accountId}:`, err)
        captureApiError(err)
      })

      processed.push({ id: account.accountId, domain: account.domain })
      console.log(`[cron/website-analyzer] triggered analysis for account_id=${account.accountId} domain=${account.domain}`)
    } catch (err) {
      console.error(`[cron/website-analyzer] unexpected error for account=${account.accountId}:`, err)
      captureApiError(err)
    }
  }

  return Response.json({
    ok: true,
    processed: processed.length,
    accounts: processed,
    reclaimed: Array.isArray(reclaimed) ? reclaimed.length : 0,
  })
}
