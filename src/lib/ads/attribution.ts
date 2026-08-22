import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type AttributionModel = 'last_touch' | 'first_touch'

export type AttributionRow = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  sessions: number
  identified_contacts: number
  opportunities: number
  revenue: number
}

export type AttributionSummary = {
  rows: AttributionRow[]
  totals: {
    sessions: number
    identified_contacts: number
    opportunities: number
    revenue: number
  }
  model: AttributionModel
  /** True when the row cap was hit, so the totals cover only what's returned. */
  truncated: boolean
}

/** The SQL function caps output at this many UTM combinations. */
const ROW_CAP = 500

/** Ceiling on sessions pulled by the JS path before aggregation. */
const SESSION_SCAN_LIMIT = 5000

const PLATFORM_SOURCES: Record<'meta' | 'google', string[]> = {
  meta: ['meta', 'facebook', 'instagram', 'fb'],
  google: ['google', 'adwords', 'google-ads'],
}

function sumRows(rows: AttributionRow[]): AttributionSummary['totals'] {
  return rows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      identified_contacts: acc.identified_contacts + r.identified_contacts,
      opportunities: acc.opportunities + r.opportunities,
      revenue: acc.revenue + r.revenue,
    }),
    { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 },
  )
}

/**
 * UTM-level attribution: sessions → identified contacts → CRM opportunities.
 *
 * Single-touch by design. Each contact — and therefore each opportunity — is
 * credited to exactly one campaign, so the rows partition the population and
 * summing them produces correct totals. The previous implementation credited
 * every campaign a contact had ever touched, so one $10k deal from a contact
 * who clicked three campaigns reported as $30k of pipeline; the JS fallback was
 * worse still, re-adding the deal once per session.
 *
 * Prefers the SQL function (one round trip, no row ceiling on the scan) and
 * falls back to the JS implementation when the migration hasn't been applied.
 */
export async function getAdsAttribution(opts: {
  from: string
  to: string
  platformFilter: 'meta' | 'google' | null
  model?: AttributionModel
}): Promise<AttributionSummary> {
  const supabase = await createClient()
  const model = opts.model ?? 'last_touch'

  const { data, error } = await supabase.rpc('get_ads_attribution', {
    p_from: opts.from,
    p_to: opts.to,
    p_platform: opts.platformFilter ?? undefined,
    p_model: model,
  })

  if (!error) {
    const rows = (data ?? []) as AttributionRow[]
    return { rows, totals: sumRows(rows), model, truncated: rows.length >= ROW_CAP }
  }

  // RLS scopes the fallback queries, so no explicit org filter is needed here.
  return computeAttribution(supabase, { ...opts, model })
}

/**
 * Same attribution, for callers that hold no user session — the MCP server and
 * Copilot tools run under the service-role client and must scope by org id
 * explicitly, since get_current_org_id() has nothing to resolve.
 */
export async function getAdsAttributionForOrg(opts: {
  orgId: string
  from: string
  to: string
  platformFilter: 'meta' | 'google' | null
  model?: AttributionModel
}): Promise<AttributionSummary> {
  const supabase = createServiceRoleClient()
  return computeAttribution(supabase, {
    from: opts.from,
    to: opts.to,
    platformFilter: opts.platformFilter,
    model: opts.model ?? 'last_touch',
    orgId: opts.orgId,
  })
}

type SessionRow = {
  id: string
  visitor_id: string
  started_at: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
}

/**
 * Shared single-touch aggregation. Mirrors the SQL semantics exactly so the two
 * paths can never disagree about what a number means.
 *
 * `orgId` is only supplied on the service-role path; under the authenticated
 * client RLS already restricts every table touched here.
 */
async function computeAttribution(
  // The two clients differ in generic parameters but expose the same query
  // surface used below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    from: string
    to: string
    platformFilter: 'meta' | 'google' | null
    model: AttributionModel
    orgId?: string
  },
): Promise<AttributionSummary> {
  const { from, to, platformFilter, model, orgId } = opts

  const empty: AttributionSummary = {
    rows: [],
    totals: { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 },
    model,
    truncated: false,
  }

  let query = supabase
    .from('analytics_sessions')
    .select('id, visitor_id, started_at, utm_source, utm_medium, utm_campaign')
    .gte('started_at', from)
    .lte('started_at', to)
    .not('utm_campaign', 'is', null)
    .order('started_at', { ascending: false })
    .limit(SESSION_SCAN_LIMIT)

  if (orgId) query = query.eq('organization_id', orgId)
  if (platformFilter) query = query.in('utm_source', PLATFORM_SOURCES[platformFilter])

  const { data: sessions } = await query
  const rows = (sessions ?? []) as SessionRow[]
  if (!rows.length) return empty

  const key = (s: SessionRow) => `${s.utm_source ?? ''}|${s.utm_medium ?? ''}|${s.utm_campaign ?? ''}`

  // Session counts are per-campaign and additive on their own.
  const sessionCounts = new Map<string, number>()
  for (const s of rows) {
    const k = key(s)
    sessionCounts.set(k, (sessionCounts.get(k) ?? 0) + 1)
  }

  // Two identification signals, same as the SQL: the visitor is linked to a
  // contact, or an identifying event fired during the session.
  const visitorIds = [...new Set(rows.map((s) => s.visitor_id).filter(Boolean))]
  const sessionIds = rows.map((s) => s.id)

  const [visitorResult, eventResult] = await Promise.all([
    visitorIds.length
      ? supabase.from('analytics_visitors').select('id, contact_id').in('id', visitorIds).not('contact_id', 'is', null)
      : Promise.resolve({ data: [] }),
    sessionIds.length
      ? supabase.from('analytics_events').select('session_id, contact_id').in('session_id', sessionIds).not('contact_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  const visitorContact = new Map<string, string>()
  for (const v of (visitorResult.data ?? []) as { id: string; contact_id: string }[]) {
    visitorContact.set(v.id, v.contact_id)
  }

  const eventContact = new Map<string, string>()
  for (const e of (eventResult.data ?? []) as { session_id: string; contact_id: string }[]) {
    if (!eventContact.has(e.session_id)) eventContact.set(e.session_id, e.contact_id)
  }

  // Pick the single winning touch per contact — the whole point of the fix.
  const winner = new Map<string, { campaignKey: string; startedAt: string }>()
  for (const s of rows) {
    const contactId = visitorContact.get(s.visitor_id) ?? eventContact.get(s.id)
    if (!contactId) continue

    const current = winner.get(contactId)
    const beats = !current
      || (model === 'first_touch' ? s.started_at < current.startedAt : s.started_at > current.startedAt)
    if (beats) winner.set(contactId, { campaignKey: key(s), startedAt: s.started_at })
  }

  const contactsPerCampaign = new Map<string, number>()
  for (const { campaignKey } of winner.values()) {
    contactsPerCampaign.set(campaignKey, (contactsPerCampaign.get(campaignKey) ?? 0) + 1)
  }

  // Each opportunity lands in exactly one campaign, because its contact does.
  const oppsPerCampaign = new Map<string, { count: number; revenue: number }>()
  const contactIds = [...winner.keys()]
  if (contactIds.length) {
    let oppQuery = supabase
      .from('opportunities')
      .select('id, contact_id, value')
      .in('contact_id', contactIds)
    if (orgId) oppQuery = oppQuery.eq('org_id', orgId)

    const { data: opps } = await oppQuery
    for (const opp of (opps ?? []) as { id: string; contact_id: string; value: number | null }[]) {
      const campaignKey = winner.get(opp.contact_id)?.campaignKey
      if (!campaignKey) continue
      const bucket = oppsPerCampaign.get(campaignKey) ?? { count: 0, revenue: 0 }
      bucket.count += 1
      bucket.revenue += opp.value ?? 0
      oppsPerCampaign.set(campaignKey, bucket)
    }
  }

  const result: AttributionRow[] = [...sessionCounts.entries()]
    .map(([campaignKey, sessionCount]) => {
      const [utmSource, utmMedium, utmCampaign] = campaignKey.split('|')
      const opp = oppsPerCampaign.get(campaignKey)
      return {
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
        utm_campaign: utmCampaign || null,
        sessions: sessionCount,
        identified_contacts: contactsPerCampaign.get(campaignKey) ?? 0,
        opportunities: opp?.count ?? 0,
        revenue: opp?.revenue ?? 0,
      }
    })
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions)

  return {
    rows: result,
    totals: sumRows(result),
    model,
    // The scan itself is capped; say so rather than implying full coverage.
    truncated: rows.length >= SESSION_SCAN_LIMIT,
  }
}
