import { NextRequest } from 'next/server'
import { z } from 'zod'

import { captureApiError } from '@/lib/api-error'
import { cachedReport, ADS_CACHE_TTL_SECONDS, ADS_CACHE_TTL_HISTORICAL_SECONDS } from '@/lib/ads/cache'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { getInsights, listCampaigns, listAdSets, listAds, getAdAccountInfo, type DatePreset } from '@/lib/ads/meta-api'
import { IsoDateSchema, MetaAdAccountIdSchema, MetaObjectIdSchema } from '@/lib/ads/validation'
import { decrypt } from '@/lib/crypto'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const REPORTS = ['overview', 'campaigns', 'adsets', 'ads', 'insights', 'daily_trend', 'campaign_leads'] as const

const QuerySchema = z.object({
  report: z.enum(REPORTS),
  ad_account_id: MetaAdAccountIdSchema,
  date_preset: z.string().default('last_30d'),
  since: IsoDateSchema.optional(),
  until: IsoDateSchema.optional(),
  campaign_id: MetaObjectIdSchema.optional(),
  adset_id: MetaObjectIdSchema.optional(),
  level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
})

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

async function getAccessToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  adAccountId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId)
    .eq('ad_account_id', adAccountId)
    .eq('platform', 'meta')
    .eq('usable', true)
    .maybeSingle()

  if (!data) return null
  return decrypt(data.encrypted_access_token)
}

/** A window that has already closed can be cached far longer than a live one. */
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
    ad_account_id: url.searchParams.get('ad_account_id') ?? undefined,
    date_preset: url.searchParams.get('date_preset') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    until: url.searchParams.get('until') ?? undefined,
    campaign_id: url.searchParams.get('campaign_id') ?? undefined,
    adset_id: url.searchParams.get('adset_id') ?? undefined,
    level: url.searchParams.get('level') ?? undefined,
  })
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')

  const { report, ad_account_id: adAccountId, date_preset: datePreset, since, until, campaign_id: campaignId, adset_id: adsetId, level } = parsed.data

  // Either an explicit custom range (since/until) or a named preset.
  const dateOpts = since && until
    ? { timeRange: { since, until } }
    : { datePreset: datePreset as DatePreset }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org', 400)

  const accessToken = await getAccessToken(supabase, orgId as string, adAccountId)
  if (!accessToken) return err('No active Meta Ads connection for this account', 404)

  const health = { orgId: orgId as string, platform: 'meta' as const, adAccountId }
  const cacheKey = {
    orgId: orgId as string,
    platform: 'meta' as const,
    accountId: adAccountId,
    report,
    params: { datePreset, since, until, campaignId, adsetId, level },
  }
  const ttl = ttlFor(until, datePreset)

  try {
    // Every branch runs through the cache and the health wrapper: the cache
    // collapses the dashboard's parallel fan-out onto one upstream call, and
    // the wrapper flips the connection to `error` when Meta rejects the token
    // so the UI can prompt for a reconnect instead of showing a bare 502.
    const payload = await cachedReport(cacheKey, () => withConnectionHealth(health, async () => {
      switch (report) {
        case 'overview': {
          const [accountInfo, insights] = await Promise.all([
            getAdAccountInfo(adAccountId, accessToken),
            getInsights(adAccountId, accessToken, { level: 'account', ...dateOpts }),
          ])
          return { account: accountInfo, insights: insights.data[0] ?? null }
        }

        case 'campaigns': {
          const [campaigns, insights] = await Promise.all([
            listCampaigns(adAccountId, accessToken),
            getInsights(adAccountId, accessToken, { level: 'campaign', ...dateOpts }),
          ])
          const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).campaign_id, i]))
          return { data: campaigns.map((c) => ({ ...c, insights: insightMap.get(c.id) ?? null })) }
        }

        case 'adsets': {
          const [adsets, insights] = await Promise.all([
            listAdSets(adAccountId, accessToken, campaignId),
            getInsights(adAccountId, accessToken, { level: 'adset', ...dateOpts }),
          ])
          const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).adset_id, i]))
          return { data: adsets.map((s) => ({ ...s, insights: insightMap.get(s.id) ?? null })) }
        }

        case 'ads': {
          const [ads, insights] = await Promise.all([
            listAds(adAccountId, accessToken, adsetId),
            getInsights(adAccountId, accessToken, { level: 'ad', ...dateOpts }),
          ])
          const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).ad_id, i]))
          return { data: ads.map((a) => ({ ...a, insights: insightMap.get(a.id) ?? null })) }
        }

        case 'insights':
          return getInsights(adAccountId, accessToken, { level, ...dateOpts })

        case 'daily_trend': {
          const data = await getInsights(adAccountId, accessToken, {
            level: 'account',
            timeIncrement: 1,
            ...dateOpts,
          })
          return { rows: [...data.data].sort((a, b) => a.date_start.localeCompare(b.date_start)) }
        }

        case 'campaign_leads': {
          const insights = await getInsights(adAccountId, accessToken, {
            level: 'campaign',
            ...dateOpts,
            fields: ['impressions', 'clicks', 'spend', 'reach', 'cpc', 'cpm', 'ctr', 'cpp', 'frequency', 'actions', 'campaign_id', 'campaign_name'],
          })
          const rows = insights.data
            .map((i) => {
              const raw = i as unknown as Record<string, string>
              const id = raw.campaign_id ?? ''
              const leads = parseFloat(i.actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
              const spend = parseFloat(i.spend ?? '0')
              return {
                id,
                name: raw.campaign_name || id,
                leads,
                spend,
                cpl: leads > 0 ? spend / leads : null,
                ctr: i.ctr ? parseFloat(i.ctr) : null,
              }
            })
            .sort((a, b) => b.leads - a.leads)
            .slice(0, 10)
          return { data: rows }
        }
      }
    }), ttl)

    return Response.json(payload)
  } catch (e) {
    captureApiError(e, { route: 'ads/meta/reports', report, orgId })
    const msg = e instanceof Error ? e.message : 'Meta API error'
    return Response.json({ error: msg }, { status: 502 })
  }
}
