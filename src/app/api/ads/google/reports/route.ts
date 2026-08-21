import { NextRequest } from 'next/server'
import { z } from 'zod'

import { captureApiError } from '@/lib/api-error'
import { cachedReport, ADS_CACHE_TTL_SECONDS, ADS_CACHE_TTL_HISTORICAL_SECONDS } from '@/lib/ads/cache'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import {
  parseTokens,
  getAccountOverview,
  listCampaigns,
  listAdGroups,
  buildGaqlDateCondition,
} from '@/lib/ads/google-api'
import { getCustomerInfo, refreshAccessToken } from '@/lib/ads/google-oauth'
import { AdsValidationError, IsoDateSchema, NumericIdSchema } from '@/lib/ads/validation'
import { decrypt } from '@/lib/crypto'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// since/until and campaign_id all end up inside a GAQL string literal — the
// Google Ads API has no bound-parameter form. They are validated here as real
// calendar dates / digit-only ids before they reach the query builder, which
// asserts again at its own boundary.
const QuerySchema = z.object({
  report: z.enum(['overview', 'campaigns', 'adgroups']).default('overview'),
  customer_id: NumericIdSchema,
  date_preset: z.string().default('last_30d'),
  since: IsoDateSchema.optional(),
  until: IsoDateSchema.optional(),
  campaign_id: NumericIdSchema.optional(),
})

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

function ttlFor(until: string | undefined, preset: string): number {
  if (until && until < new Date().toISOString().slice(0, 10)) return ADS_CACHE_TTL_HISTORICAL_SECONDS
  if (preset === 'yesterday' || preset === 'last_month') return ADS_CACHE_TTL_HISTORICAL_SECONDS
  return ADS_CACHE_TTL_SECONDS
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    report: url.searchParams.get('report') ?? undefined,
    // Customer ids are sometimes pasted as 123-456-7890; store/query them bare.
    customer_id: url.searchParams.get('customer_id')?.replace(/-/g, '') ?? undefined,
    date_preset: url.searchParams.get('date_preset') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    until: url.searchParams.get('until') ?? undefined,
    campaign_id: url.searchParams.get('campaign_id') ?? undefined,
  })
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')

  const { report, customer_id: customerId, date_preset: datePreset, since, until, campaign_id: campaignId } = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token, ad_account_name')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', customerId)
    .eq('platform', 'google')
    .eq('status', 'active')
    .maybeSingle()

  if (!conn) return err('No active Google Ads connection for this customer', 404)

  const tokens = parseTokens(await decrypt(conn.encrypted_access_token))

  let duration: string
  try {
    duration = buildGaqlDateCondition(datePreset, since, until)
  } catch (e) {
    if (e instanceof AdsValidationError) return err(e.message)
    throw e
  }

  const health = { orgId: orgId as string, platform: 'google' as const, adAccountId: customerId }
  const cacheKey = {
    orgId: orgId as string,
    platform: 'google' as const,
    accountId: customerId,
    report,
    params: { datePreset, since, until, campaignId },
  }

  try {
    const payload = await cachedReport(cacheKey, () => withConnectionHealth(health, async () => {
      switch (report) {
        case 'overview': {
          const [info, overview] = await Promise.all([
            // The stored access token may be stale; mint a fresh one for the
            // metadata read. A failure here is cosmetic, so fall back to the
            // name already on the connection rather than failing the report.
            refreshAccessToken(tokens.refresh_token)
              .then((at) => getCustomerInfo(customerId, at))
              .catch(() => ({
                id: customerId,
                name: conn.ad_account_name ?? customerId,
                currency_code: 'USD',
                manager: false,
                test_account: false,
              })),
            getAccountOverview(customerId, tokens.refresh_token, duration),
          ])
          return { customer: info, metrics: overview }
        }

        case 'campaigns':
          return { data: await listCampaigns(customerId, tokens.refresh_token, duration) }

        case 'adgroups':
          return { data: await listAdGroups(customerId, tokens.refresh_token, duration, campaignId) }
      }
    }), ttlFor(until, datePreset))

    return Response.json(payload)
  } catch (e) {
    if (e instanceof AdsValidationError) return err(e.message)
    captureApiError(e, { route: 'ads/google/reports', report, orgId })
    const msg = e instanceof Error ? e.message : 'Google Ads API error'
    return Response.json({ error: msg }, { status: 502 })
  }
}
