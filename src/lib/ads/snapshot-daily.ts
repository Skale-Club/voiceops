// Nightly capture of per-campaign daily metrics into ads_insights_daily.
//
// Why this exists: every ads surface read live from the platform APIs, so the
// product had no memory. No period-over-period comparison survived a rate
// limit, disconnecting an account erased its history from the UI, and there was
// no baseline to detect "CPL doubled this week" against. This writes the
// module's own record once a day.
//
// Re-runs are safe and expected: platforms restate the last few days
// (attribution windows close late), so the job re-captures a trailing window
// and upserts on (org, platform, account, campaign, date).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import { decrypt } from '@/lib/crypto'
import { markConnectionError, isAuthError } from './connection-health'
import { minorUnitsPerMajor } from './currency'
import { getInsights, getAdAccountInfo } from './meta-api'
import { parseTokens, runGaqlQuery } from './google-api'
import { getCustomerInfo, refreshAccessToken } from './google-oauth'
import { assertIsoDate } from './validation'

/** Platforms restate recent days; re-capture this many to absorb the revisions. */
export const SNAPSHOT_TRAILING_DAYS = 7

export type SnapshotResult = {
  orgId: string
  platform: 'meta' | 'google'
  adAccountId: string
  rows: number
  error?: string
}

type InsightRow = {
  org_id: string
  platform: 'meta' | 'google'
  ad_account_id: string
  campaign_id: string
  campaign_name: string | null
  stat_date: string
  currency: string
  impressions: number
  clicks: number
  reach: number
  spend_minor: number
  conversions: number
  leads: number
  raw: Json
}

function isoDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function toInt(value: string | number | undefined | null): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function toFloat(value: string | number | undefined | null): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

async function captureMeta(
  orgId: string,
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<InsightRow[]> {
  const account = await getAdAccountInfo(adAccountId, accessToken).catch(() => null)
  const currency = account?.currency ?? 'USD'
  const perMajor = minorUnitsPerMajor(currency)

  // time_increment=1 segments by day; campaign level gives one row per
  // campaign per day, which is exactly the grain of the table.
  const insights = await getInsights(adAccountId, accessToken, {
    level: 'campaign',
    timeRange: { since, until },
    timeIncrement: 1,
    fields: [
      'impressions', 'clicks', 'spend', 'reach', 'cpc', 'cpm', 'ctr',
      'actions', 'campaign_id', 'campaign_name',
    ],
  })

  return insights.data.flatMap((row) => {
    const raw = row as unknown as Record<string, string>
    const campaignId = raw.campaign_id
    if (!campaignId) return []

    const leads = toFloat(row.actions?.find((a) => a.action_type === 'lead')?.value)
    // Meta reports spend in major units; the table stores minor units so
    // summing a quarter of spend never drifts through floating point.
    const spendMinor = Math.round(toFloat(row.spend) * perMajor)

    return [{
      org_id: orgId,
      platform: 'meta' as const,
      ad_account_id: adAccountId,
      campaign_id: campaignId,
      campaign_name: raw.campaign_name ?? null,
      stat_date: row.date_start,
      currency,
      impressions: toInt(row.impressions),
      clicks: toInt(row.clicks),
      reach: toInt(row.reach),
      spend_minor: spendMinor,
      conversions: leads,
      leads: Math.round(leads),
      raw: { cpc: row.cpc, cpm: row.cpm, ctr: row.ctr, actions: row.actions },
    }]
  })
}

// ─── Google ───────────────────────────────────────────────────────────────────

type GoogleDailyRow = {
  campaign: { id: string; name: string }
  metrics: { impressions: string; clicks: string; costMicros: string; conversions: string }
  segments: { date: string }
}

async function captureGoogle(
  orgId: string,
  customerId: string,
  refreshToken: string,
  since: string,
  until: string,
): Promise<InsightRow[]> {
  const accessToken = await refreshAccessToken(refreshToken)
  const info = await getCustomerInfo(customerId, accessToken).catch(() => null)
  const currency = info?.currency_code ?? 'USD'
  const perMajor = minorUnitsPerMajor(currency)

  // Selecting segments.date is what actually segments the result by day —
  // filtering on it alone would return one aggregate row for the window.
  const rows = await runGaqlQuery<GoogleDailyRow>(
    customerId,
    refreshToken,
    `SELECT campaign.id, campaign.name, segments.date,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
     FROM campaign
     WHERE campaign.status != 'REMOVED'
       AND segments.date BETWEEN '${assertIsoDate(since, 'since')}' AND '${assertIsoDate(until, 'until')}'`,
  )

  return rows.map((r) => {
    // Google money is micros (1e6 per major unit) regardless of currency.
    const spendMajor = toFloat(r.metrics.costMicros) / 1_000_000
    return {
      org_id: orgId,
      platform: 'google' as const,
      ad_account_id: customerId,
      campaign_id: r.campaign.id,
      campaign_name: r.campaign.name ?? null,
      stat_date: r.segments.date,
      currency,
      impressions: toInt(r.metrics.impressions),
      clicks: toInt(r.metrics.clicks),
      reach: 0, // Google has no reach equivalent at campaign level.
      spend_minor: Math.round(spendMajor * perMajor),
      conversions: toFloat(r.metrics.conversions),
      leads: Math.round(toFloat(r.metrics.conversions)),
      raw: { cost_micros: r.metrics.costMicros },
    }
  })
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Capture the trailing window for every active connection. One failing account
 * never aborts the run — its error is recorded and the loop continues.
 */
export async function captureDailyInsights(options: {
  orgId?: string
  trailingDays?: number
  now?: Date
} = {}): Promise<SnapshotResult[]> {
  const supabase = createServiceRoleClient()
  const trailing = options.trailingDays ?? SNAPSHOT_TRAILING_DAYS
  const now = options.now ?? new Date()
  const since = isoDaysAgo(trailing, now)
  const until = isoDaysAgo(0, now)

  let query = supabase
    .from('ads_connections')
    .select('org_id, platform, ad_account_id, encrypted_access_token')
    .eq('status', 'active')
  if (options.orgId) query = query.eq('org_id', options.orgId)

  const { data: connections, error } = await query
  if (error) throw new Error(`Failed to list ads connections: ${error.message}`)

  const results: SnapshotResult[] = []

  for (const conn of connections ?? []) {
    const base = {
      orgId: conn.org_id,
      platform: conn.platform as 'meta' | 'google',
      adAccountId: conn.ad_account_id,
    }

    try {
      const secret = await decrypt(conn.encrypted_access_token)
      const rows = base.platform === 'meta'
        ? await captureMeta(base.orgId, base.adAccountId, secret, since, until)
        : await captureGoogle(base.orgId, base.adAccountId, parseTokens(secret).refresh_token, since, until)

      if (rows.length) {
        const { error: upsertError } = await supabase
          .from('ads_insights_daily')
          .upsert(rows, { onConflict: 'org_id,platform,ad_account_id,campaign_id,stat_date' })
        if (upsertError) throw new Error(upsertError.message)
      }

      results.push({ ...base, rows: rows.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // A dead credential is exactly what the health signal is for — surface it
      // rather than letting the snapshot fail silently every night.
      if (isAuthError(err)) {
        await markConnectionError({ ...base, error: err })
      }
      results.push({ ...base, rows: 0, error: message })
    }
  }

  return results
}
