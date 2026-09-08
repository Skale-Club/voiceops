// Website Analyzer orchestrator — ties Playwright extraction, Supabase Storage
// upload, lead score calculation, and DB writes together.
//
// Called fire-and-forget from POST /api/v1/accounts/:id/analyze.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { analyzeWebsite, calculateLeadScore, normaliseUrl } from './extractor'
import { AnalyzerBusyError } from './concurrency'
import { buildWebsiteInsights } from './outreach-insights'
import { computeRetryOutcome } from './retry-classification'
import type { AnalysisResult } from './types'
import type { Json } from '@/types/database'

const SCREENSHOT_BUCKET = 'website-screenshots'

const SKALECLUB_WEBSITES_URL =
  process.env.SKALECLUB_WEBSITES_URL ?? 'https://websites.skale.club'
const SKALECLUB_WEBSITES_API_KEY = process.env.SKALECLUB_WEBSITES_API_KEY ?? ''

/** Upload a screenshot Buffer to Supabase Storage and return its public URL. */
async function uploadScreenshot(
  supabase: ReturnType<typeof createServiceRoleClient>,
  analysisId: string,
  variant: 'desktop' | 'mobile',
  data: Buffer,
): Promise<string | null> {
  const path = `${analysisId}/${variant}.jpg`
  const { error } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, data, { contentType: 'image/jpeg', upsert: true })
  if (error) {
    console.error(`[website-analyzer] screenshot upload failed (${variant}):`, error.message)
    return null
  }
  const { data: urlData } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path)
  return urlData?.publicUrl ?? null
}

/** Generate a preview site for a prospect by calling skaleclub-websites, and
 *  persist preview_url / preview_token on the analysis row.
 *
 *  IMPORTANT: this is NOT called automatically during analysis. Auto-creating a
 *  tenant for every analyzed site floods websites.skale.club with unmanageable
 *  draft tenants for prospects that may never reply. A preview/tenant is created
 *  ONLY on demand — when an operator decides a prospect is worth it (e.g. the
 *  client signalled interest). Invoked from the manual `generateProspectPreview`
 *  server action behind the "Gerar preview" button on the prospect card. */
export async function generatePreviewForAnalysis(opts: {
  analysisId: string
  accountId: string
  orgId: string
  domain: string
  result: Pick<AnalysisResult, 'brandColors' | 'logoUrl' | 'services' | 'painPoints'>
  accountName?: string | null
}): Promise<{ ok: true; previewUrl: string | null; previewToken: string | null } | { ok: false; error: string }> {
  const { analysisId, accountId, orgId, domain, result, accountName } = opts
  const supabase = createServiceRoleClient()

  if (!SKALECLUB_WEBSITES_API_KEY) {
    return { ok: false, error: 'SKALECLUB_WEBSITES_API_KEY not configured' }
  }

  const body = {
    account_id:    accountId,
    business_name: accountName ?? domain,
    domain,
    niche:         'general',
    brand_colors:  result.brandColors,
    logo_url:      result.logoUrl ?? undefined,
    services:      result.services,
    pain_points:   result.painPoints,
    org_id:        orgId,
  }

  let response: Response
  try {
    response = await fetch(`${SKALECLUB_WEBSITES_URL}/api/v1/previews/create-from-prospect`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${SKALECLUB_WEBSITES_API_KEY}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'preview request failed' }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { ok: false, error: `preview API ${response.status}: ${text.slice(0, 150)}` }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await response.json()) as any
  const previewUrl   = json?.preview_url   ?? json?.url   ?? null
  const previewToken = json?.preview_token ?? json?.token ?? null

  if (previewUrl || previewToken) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('website_analyses')
      .update({
        preview_url:   previewUrl,
        preview_token: previewToken,
        updated_at:    new Date().toISOString(),
      })
      .eq('id', analysisId)
  }

  console.log(`[orchestration] preview generated (manual) for account_id=${accountId}`)
  return { ok: true, previewUrl, previewToken }
}

/** Run the full analysis pipeline for one account. Meant to be called
 *  fire-and-forget — all errors are caught and written to the DB row. */
export async function runAnalysis(opts: {
  analysisId: string
  orgId: string
  accountId: string
  domain: string
  /** Attempt count carried forward from the account's prior analysis row (see
   *  AnalyzerCandidate.lastAttempts). Defaults to 0 for a brand-new account. */
  attempts?: number
}): Promise<void> {
  const { analysisId, orgId, accountId, domain, attempts: previousAttempts = 0 } = opts
  const supabase = createServiceRoleClient()
  const url = normaliseUrl(domain)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wa = (supabase as any).from('website_analyses')

  // Mark as running
  await wa
    .update({ status: 'running', url, updated_at: new Date().toISOString() })
    .eq('id', analysisId)

  try {
    // ── 1. Extract ──────────────────────────────────────────────────────────
    // The row was marked 'running' above, but the browser pool may hold this
    // call in its queue first. reclaim_stale_website_analyses fails any
    // pending/running row untouched for DEFAULT_STALE_MINUTES, so restart that
    // clock when the analysis genuinely begins — otherwise a run that merely
    // waited its turn gets reclaimed out from under itself.
    const extraction = await analyzeWebsite(url, {
      onStart: async () => {
        await wa.update({ updated_at: new Date().toISOString() }).eq('id', analysisId)
      },
    })

    // ── 2. Upload screenshots ────────────────────────────────────────────────
    const [screenshotDesktopUrl, screenshotMobileUrl] = await Promise.all([
      uploadScreenshot(supabase, analysisId, 'desktop', extraction.desktopScreenshot),
      uploadScreenshot(supabase, analysisId, 'mobile',  extraction.mobileScreenshot),
    ])

    // ── 3. Derive services + pain_points from extracted content ──────────────
    // Services: non-generic nav items + h2/h3 (h1 is usually the tagline)
    const genericNavWords = new Set(['home', 'about', 'contact', 'blog', 'news', 'faq', 'login', 'sign in', 'register'])
    const services = [
      ...extraction.navItems.filter((t) => !genericNavWords.has(t.toLowerCase())),
      ...extraction.headings.slice(1, 6), // h2/h3 tend to be service/feature titles
    ]
      .filter((t, i, arr) => arr.indexOf(t) === i) // dedupe
      .slice(0, 10)

    const painPoints = extraction.heroText.slice(0, 5)

    // ── 4. Lead score ────────────────────────────────────────────────────────
    const leadScore = calculateLeadScore({
      siteReachable:     true,
      isMobileResponsive: extraction.isMobileResponsive,
      hasLogo:           extraction.logoUrl !== null,
      hasCTA:            extraction.hasClearlyCTA,
      hasContactInfo:    extraction.hasContactInfo,
      loadMs:            extraction.loadMs,
      hasCSSVars:        Object.keys(extraction.rawCssVars).length > 0,
      colorCount:        extraction.brandColors.length,
    })

    // ── 5. Build evidence bundle ─────────────────────────────────────────────
    const rawEvidence: Record<string, unknown> = {
      resolvedUrl:        extraction.resolvedUrl,
      pageTitle:          extraction.pageTitle,
      loadMs:             extraction.loadMs,
      isMobileResponsive: extraction.isMobileResponsive,
      hasCTA:             extraction.hasClearlyCTA,
      hasContactInfo:     extraction.hasContactInfo,
      headings:           extraction.headings,
      navItems:           extraction.navItems,
      heroText:           extraction.heroText,
      booking:            extraction.booking,
      cssVarCount:        Object.keys(extraction.rawCssVars).length,
    }

    const result: AnalysisResult = {
      url:                    extraction.resolvedUrl,
      leadScore,
      brandColors:            extraction.brandColors,
      logoUrl:                extraction.logoUrl,
      services,
      painPoints,
      screenshotDesktopUrl,
      screenshotMobileUrl,
      rawEvidence,
      outreachInsights: buildWebsiteInsights({ url: extraction.resolvedUrl, services, rawEvidence }),
      booking: extraction.booking,
    }

    // ── 6. Persist analysis row ──────────────────────────────────────────────
    await wa.update({
        status:                 'completed',
        url:                    result.url,
        lead_score:             result.leadScore,
        brand_colors:           result.brandColors as unknown as Json,
        logo_url:               result.logoUrl,
        services:               result.services,
        pain_points:            result.painPoints,
        screenshot_desktop_url: result.screenshotDesktopUrl,
        screenshot_mobile_url:  result.screenshotMobileUrl,
        raw_evidence:           result.rawEvidence as Json,
        outreach_insights:      result.outreachInsights as Json,
        analyzed_at:            new Date().toISOString(),
        updated_at:             new Date().toISOString(),
      })
      .eq('id', analysisId)

    // ── 7. Update the account record ─────────────────────────────────────────
    const { data: account } = await supabase
      .from('accounts')
      .select('custom_fields')
      .eq('id', accountId)
      .eq('org_id', orgId)
      .maybeSingle()
    const existingCustomFields = account?.custom_fields && typeof account.custom_fields === 'object' && !Array.isArray(account.custom_fields)
      ? account.custom_fields as Record<string, unknown>
      : {}
    const bookingFields: Record<string, unknown> = {
      booking_detected: extraction.booking.detected,
      booking_mode: extraction.booking.mode,
      booking_detection_source: 'website_analyzer',
    }
    if (extraction.booking.detected) {
      bookingFields.booking_platform = extraction.booking.primaryProvider
      bookingFields.booking_url = extraction.booking.primaryUrl
      bookingFields.booking_platforms = extraction.booking.platforms
    }

    await supabase
      .from('accounts')
      .update({
        score:                leadScore,
        qualification_status: leadScore >= 60 ? 'qualified' : leadScore >= 30 ? 'needs_review' : 'unqualified',
        custom_fields:        { ...existingCustomFields, ...bookingFields },
        updated_at:           new Date().toISOString(),
      })
      .eq('id', accountId)

    // ── 8. Add engagement event (analysis summary lives on the prospect card) ──
    // The structured analysis is read from website_analyses by the prospect
    // detail view; this event just marks the activity on the timeline. Payload
    // carries a compact summary so the timeline entry is informative on its own.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('prospect_engagement_events').insert({
      org_id:          orgId,
      entity_type:     'account',
      entity_id:       accountId,
      event_type:      'website_analyzed',
      source_platform: 'website_analyzer',
      payload:         {
        analysis_id:         analysisId,
        lead_score:          leadScore,
        problems:            painPoints.length,
        mobile_responsive:   extraction.isMobileResponsive,
        has_logo:            extraction.logoUrl !== null,
        has_cta:             extraction.hasClearlyCTA,
        load_ms:             extraction.loadMs,
        booking_detected:    extraction.booking.detected,
        booking_mode:        extraction.booking.mode,
        booking_platform:    extraction.booking.primaryProvider,
      } as Json,
    })

    console.log(`[website-analyzer] ✓ account=${accountId} score=${leadScore} url=${result.url}`)

    // ── 9. NO automatic preview/tenant creation ──────────────────────────────
    // The analysis (screenshots, score, pain points) is now the deliverable and
    // lives on the prospect card in Xphere. A preview site in websites.skale.club
    // is created ONLY on demand via the "Gerar preview" button (manual), so we
    // don't flood the tenant list with sites for prospects that never reply.
    // See generatePreviewForAnalysis() + the generateProspectPreview action.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Saturation is not a failed analysis — the site was never even opened.
    // Drop the row so the account returns to exactly its pre-tick state and
    // the next tick can claim it again. Leaving it behind would be worse than
    // useless: `idx_website_analyses_account_active` is unique over
    // (account_id) while status is pending/running, so a parked row blocks
    // every later insert for that account until the stale reclaim finally
    // marks it 'failed' — burning the account's slot on work never attempted.
    if (err instanceof AnalyzerBusyError) {
      console.warn(`[website-analyzer] deferred account=${accountId}: ${message}`)
      await wa.delete().eq('id', analysisId)
      return
    }

    // ── Permanent vs transient failure (Fase 33 backoff) ────────────────────
    // A domain that will never resolve (or whose cert is broken) used to get
    // retried every 10 minutes forever, each attempt burning a fresh row and
    // one of the ~10 analyzer slots per tick -- see retry-classification.ts.
    // `previousAttempts` was carried forward from the account's last analysis
    // row by the cron (website_analyzer_candidates.last_attempts), so the
    // count below is cumulative across rows, not reset to zero here.
    const outcome = computeRetryOutcome({
      errorMessage: message,
      previousAttempts,
      now: new Date(),
    })
    console.error(
      `[website-analyzer] ✗ account=${accountId} (${outcome.failureClass}, attempt ${outcome.attempts}) -> ${outcome.status}:`,
      message
    )
    await wa
      .update({
        status:          outcome.status,
        error_message:   message,
        attempts:        outcome.attempts,
        next_attempt_at: outcome.nextAttemptAt ? outcome.nextAttemptAt.toISOString() : null,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', analysisId)
  }
}
