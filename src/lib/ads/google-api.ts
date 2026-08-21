import { refreshAccessToken, type GoogleAdsTokens } from './google-oauth'
import { getCachedAccessToken, setCachedAccessToken, clearCachedAccessToken } from './cache'
import { resolveNonNativeGoogleRange } from './date-range'
import { assertIsoDate, assertNumericId } from './validation'

const GADS_BASE = 'https://googleads.googleapis.com/v20'

/** Cap on pages walked per search — a runaway loop guard, not a result cap. */
const MAX_SEARCH_PAGES = 20

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'GoogleAdsError'
  }
}

// ─── Token management ──────────────────────────────────────────────────────────
// encrypted_access_token stores JSON: { access_token, refresh_token }
// Access tokens expire in ~1 hour; we always refresh before API calls.

export function serializeTokens(tokens: GoogleAdsTokens): string {
  return JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token })
}

export function parseTokens(stored: string): GoogleAdsTokens {
  const parsed = JSON.parse(stored) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!parsed.access_token || !parsed.refresh_token) throw new Error('Invalid stored token format')
  return { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expires_in: parsed.expires_in ?? 3600 }
}

/**
 * Access tokens live ~1 hour, but this client used to mint a brand new one for
 * every single API call — one campaigns page could spend three or four
 * round-trips on Google's token endpoint (itself rate limited) before doing any
 * real work. Cache it just under its lifetime and reuse.
 */
async function getFreshAccessToken(refreshToken: string): Promise<string> {
  const cached = await getCachedAccessToken(refreshToken)
  if (cached) return cached

  const token = await refreshAccessToken(refreshToken)
  await setCachedAccessToken(refreshToken, token)
  return token
}

// ─── Core request helper ───────────────────────────────────────────────────────

async function gadsRequest<T>(
  path: string,
  refreshToken: string,
  options: { method?: string; body?: unknown; loginCustomerId?: string; isRetry?: boolean },
): Promise<T> {
  const accessToken = await getFreshAccessToken(refreshToken)
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
    'Content-Type': 'application/json',
  }
  if (options.loginCustomerId) {
    headers['login-customer-id'] = options.loginCustomerId
  }

  const res = await fetch(`${GADS_BASE}/${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })

  if (!res.ok) {
    // A cached access token can be revoked before its TTL runs out. Drop it and
    // retry once with a freshly minted one before surfacing an auth failure —
    // otherwise caching would turn a recoverable blip into a "reconnect" prompt.
    if (res.status === 401 && !options.isRetry) {
      await clearCachedAccessToken(refreshToken)
      return gadsRequest<T>(path, refreshToken, { ...options, isRetry: true })
    }

    let msg = `Google Ads API error ${res.status}`
    let code: string | undefined
    try {
      const body = (await res.json()) as {
        error?: { message?: string; status?: string; details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }> }> }
      }
      msg = body.error?.message ?? msg
      code = body.error?.status
    } catch { /* ignore */ }
    if (res.status === 401) code ??= 'UNAUTHENTICATED'
    if (res.status === 403) code ??= 'PERMISSION_DENIED'
    throw new GoogleAdsError(msg, code)
  }

  return res.json() as Promise<T>
}

/**
 * Run a GAQL query, following `nextPageToken` to completion. The previous
 * version read only the first page, so any account past one page of results
 * was silently truncated.
 */
async function gaqlSearch<T>(
  customerId: string,
  refreshToken: string,
  query: string,
): Promise<T[]> {
  const safeCustomerId = assertNumericId(customerId, 'customer_id')
  const rows: T[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const res = await gadsRequest<{ results?: T[]; nextPageToken?: string }>(
      `customers/${safeCustomerId}/googleAds:search`,
      refreshToken,
      { method: 'POST', body: pageToken ? { query, pageToken } : { query } },
    )
    rows.push(...(res.results ?? []))
    if (!res.nextPageToken) return rows
    pageToken = res.nextPageToken
  }

  console.warn('[ads/google] search hit the page cap; results may be truncated', {
    customerId: safeCustomerId,
    pages: MAX_SEARCH_PAGES,
  })
  return rows
}

/**
 * Escape hatch for callers that need a query this module doesn't expose as a
 * named helper (currently the daily snapshot, which selects segments.date to
 * get day-grain rows). Same pagination and validation as every other read.
 */
export async function runGaqlQuery<T>(
  customerId: string,
  refreshToken: string,
  query: string,
): Promise<T[]> {
  return gaqlSearch<T>(customerId, refreshToken, query)
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GAdsCampaign = {
  id: string
  name: string
  status: string
  channelType: string
  biddingStrategy: string
  budgetAmountMicros: string
  budgetId: string
}

export type GAdsCampaignWithMetrics = GAdsCampaign & {
  impressions: string
  clicks: string
  costMicros: string
  conversions: string
  ctr: string
  averageCpc: string
}

export type GAdsAccountOverview = {
  impressions: string
  clicks: string
  costMicros: string
  conversions: string
  ctr: string
  averageCpc: string
}

export type GAdsAdGroup = {
  id: string
  name: string
  campaignId: string
  campaignName: string
  status: string
  impressions: string
  clicks: string
  costMicros: string
}

// ─── GAQL date range helper ────────────────────────────────────────────────────

export type GAdsDuration =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'

export function toGaqlDuration(preset: string): GAdsDuration {
  const map: Record<string, GAdsDuration> = {
    today: 'TODAY',
    yesterday: 'YESTERDAY',
    last_7d: 'LAST_7_DAYS',
    last_14d: 'LAST_14_DAYS',
    last_30d: 'LAST_30_DAYS',
    last_90d: 'LAST_90_DAYS',
    this_month: 'THIS_MONTH',
    last_month: 'LAST_MONTH',
  }
  return map[preset] ?? 'LAST_30_DAYS'
}

const GAQL_NATIVE_DURATIONS: Record<string, string> = {
  today: 'TODAY',
  yesterday: 'YESTERDAY',
  last_7d: 'LAST_7_DAYS',
  last_14d: 'LAST_14_DAYS',
  last_30d: 'LAST_30_DAYS',
  last_90d: 'LAST_90_DAYS',
  this_month: 'THIS_MONTH',
  last_month: 'LAST_MONTH',
  last_year: 'LAST_YEAR',
}

/**
 * Builds a GAQL WHERE date condition from either a named preset or an explicit
 * since/until range.
 *
 * Two things this guards.
 *
 * Injection: the Google Ads API has no bound-parameter form, so dates end up as
 * literals inside the query string. `since`/`until` arrive from request query
 * params, so they are validated as real YYYY-MM-DD calendar dates before being
 * interpolated — an unvalidated value could close the quote and append clauses.
 *
 * Silent substitution: presets Google has no keyword for (last_3m, last_6m,
 * last_2y, maximum) used to fall through to LAST_30_DAYS, answering a different
 * question than the operator asked without saying so. They are now resolved to
 * a concrete range instead.
 */
export function buildGaqlDateCondition(preset: string, since?: string, until?: string): string {
  if (since && until) {
    const safeSince = assertIsoDate(since, 'since')
    const safeUntil = assertIsoDate(until, 'until')
    return `segments.date BETWEEN '${safeSince}' AND '${safeUntil}'`
  }

  const native = GAQL_NATIVE_DURATIONS[preset]
  if (native) return `segments.date DURING ${native}`

  const resolved = resolveNonNativeGoogleRange(preset)
  if (resolved) {
    return `segments.date BETWEEN '${assertIsoDate(resolved.since, 'since')}' AND '${assertIsoDate(resolved.until, 'until')}'`
  }

  return `segments.date DURING ${GAQL_NATIVE_DURATIONS.last_30d}`
}

/**
 * Accepts either a bare GAQL duration keyword (LAST_30_DAYS) or a full
 * condition produced by buildGaqlDateCondition, and returns a condition.
 * Both call styles exist across the codebase; this collapses the branch that
 * was duplicated in every query builder below.
 */
function toDateCondition(duration: string): string {
  return duration.includes('BETWEEN') || duration.includes('DURING')
    ? duration
    : `segments.date DURING ${duration}`
}

// ─── Account overview ──────────────────────────────────────────────────────────

export async function getAccountOverview(
  customerId: string,
  refreshToken: string,
  duration: GAdsDuration | string,
): Promise<GAdsAccountOverview> {
  type Row = {
    metrics: {
      impressions: string
      clicks: string
      costMicros: string
      conversions: string
      ctr: string
      averageCpc: string
    }
  }
  const dateClause = `WHERE ${toDateCondition(duration)}`
  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.average_cpc
     FROM customer
     ${dateClause}`,
  )
  if (!rows.length) {
    return { impressions: '0', clicks: '0', costMicros: '0', conversions: '0', ctr: '0', averageCpc: '0' }
  }
  // Sum across all rows (customer-level returns one row per day by default)
  const totals = rows.reduce(
    (acc, r) => ({
      impressions: String(Number(acc.impressions) + Number(r.metrics.impressions)),
      clicks: String(Number(acc.clicks) + Number(r.metrics.clicks)),
      costMicros: String(Number(acc.costMicros) + Number(r.metrics.costMicros)),
      conversions: String(Number(acc.conversions) + Number(r.metrics.conversions)),
      ctr: '0',
      averageCpc: '0',
    }),
    { impressions: '0', clicks: '0', costMicros: '0', conversions: '0', ctr: '0', averageCpc: '0' },
  )
  const impr = Number(totals.impressions)
  const clicks = Number(totals.clicks)
  totals.ctr = impr > 0 ? String((clicks / impr) * 100) : '0'
  totals.averageCpc = clicks > 0 ? String(Number(totals.costMicros) / clicks) : '0'
  return totals
}

// ─── Campaigns ─────────────────────────────────────────────────────────────────

export async function listCampaigns(
  customerId: string,
  refreshToken: string,
  duration: GAdsDuration | string,
): Promise<GAdsCampaignWithMetrics[]> {
  type Row = {
    campaign: {
      id: string
      name: string
      status: string
      advertisingChannelType: string
      biddingStrategyType: string
      campaignBudget: string
    }
    campaignBudget: { amountMicros: string; id: string }
    metrics: {
      impressions: string
      clicks: string
      costMicros: string
      conversions: string
      ctr: string
      averageCpc: string
    }
  }

  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT campaign.id, campaign.name, campaign.status,
            campaign.advertising_channel_type, campaign.bidding_strategy_type,
            campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.id,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.average_cpc
     FROM campaign
     WHERE campaign.status != 'REMOVED'
       AND ${toDateCondition(duration)}
     ORDER BY metrics.cost_micros DESC`,
  )

  return rows.map((r) => ({
    id: r.campaign.id,
    name: r.campaign.name,
    status: r.campaign.status,
    channelType: r.campaign.advertisingChannelType,
    biddingStrategy: r.campaign.biddingStrategyType,
    budgetAmountMicros: r.campaignBudget?.amountMicros ?? '0',
    budgetId: r.campaignBudget?.id ?? '',
    impressions: r.metrics.impressions,
    clicks: r.metrics.clicks,
    costMicros: r.metrics.costMicros,
    conversions: r.metrics.conversions,
    ctr: r.metrics.ctr,
    averageCpc: r.metrics.averageCpc,
  }))
}

// ─── Ad groups ─────────────────────────────────────────────────────────────────

export async function listAdGroups(
  customerId: string,
  refreshToken: string,
  duration: GAdsDuration | string,
  campaignId?: string,
): Promise<GAdsAdGroup[]> {
  type Row = {
    adGroup: { id: string; name: string; status: string }
    campaign: { id: string; name: string }
    metrics: { impressions: string; clicks: string; costMicros: string }
  }

  // campaignId reaches here straight from a request query param and lands in a
  // query literal — validate it as digits-only before interpolating.
  const campaignFilter = campaignId
    ? ` AND campaign.id = ${assertNumericId(campaignId, 'campaign_id')}`
    : ''
  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT ad_group.id, ad_group.name, ad_group.status,
            campaign.id, campaign.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros
     FROM ad_group
     WHERE ad_group.status != 'REMOVED'${campaignFilter}
       AND ${toDateCondition(duration)}
     ORDER BY metrics.cost_micros DESC`,
  )

  return rows.map((r) => ({
    id: r.adGroup.id,
    name: r.adGroup.name,
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    status: r.adGroup.status,
    impressions: r.metrics.impressions,
    clicks: r.metrics.clicks,
    costMicros: r.metrics.costMicros,
  }))
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export async function updateCampaignStatus(
  customerId: string,
  campaignId: string,
  status: 'ENABLED' | 'PAUSED',
  refreshToken: string,
): Promise<void> {
  const safeCustomerId = assertNumericId(customerId, 'customer_id')
  const safeCampaignId = assertNumericId(campaignId, 'campaign_id')
  await gadsRequest(
    `customers/${safeCustomerId}/campaigns:mutate`,
    refreshToken,
    {
      method: 'POST',
      body: {
        operations: [
          {
            update: {
              resourceName: `customers/${safeCustomerId}/campaigns/${safeCampaignId}`,
              status,
            },
            updateMask: 'status',
          },
        ],
      },
    },
  )
}

export async function updateCampaignBudget(
  customerId: string,
  budgetId: string,
  amountMicros: number,
  refreshToken: string,
): Promise<void> {
  const safeCustomerId = assertNumericId(customerId, 'customer_id')
  const safeBudgetId = assertNumericId(budgetId, 'budget_id')
  await gadsRequest(
    `customers/${safeCustomerId}/campaignBudgets:mutate`,
    refreshToken,
    {
      method: 'POST',
      body: {
        operations: [
          {
            update: {
              resourceName: `customers/${safeCustomerId}/campaignBudgets/${safeBudgetId}`,
              amountMicros: String(amountMicros),
            },
            updateMask: 'amount_micros',
          },
        ],
      },
    },
  )
}

/**
 * Current name / status / budget for one campaign — the "before" half of an
 * audit record, captured before a mutation overwrites it.
 */
export async function getCampaignSnapshot(
  customerId: string,
  campaignId: string,
  refreshToken: string,
): Promise<{ name: string; status: string; budgetAmountMicros: string; currency: string } | null> {
  type Row = {
    campaign: { id: string; name: string; status: string }
    campaignBudget?: { amountMicros?: string }
    customer?: { currencyCode?: string }
  }
  const safeCampaignId = assertNumericId(campaignId, 'campaign_id')
  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT campaign.id, campaign.name, campaign.status,
            campaign_budget.amount_micros, customer.currency_code
     FROM campaign
     WHERE campaign.id = ${safeCampaignId}
     LIMIT 1`,
  )
  const row = rows[0]
  if (!row) return null
  return {
    name: row.campaign.name,
    status: row.campaign.status,
    budgetAmountMicros: row.campaignBudget?.amountMicros ?? '0',
    currency: row.customer?.currencyCode ?? 'USD',
  }
}
