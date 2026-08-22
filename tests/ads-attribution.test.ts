import { describe, expect, it, vi, beforeEach } from 'vitest'

// The module resolves its client at call time; stub both factories so the
// aggregation logic can be exercised without a database.
const serviceClient = { from: vi.fn() }

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => serviceClient,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => serviceClient,
}))

import { getAdsAttributionForOrg } from '@/lib/ads/attribution'

type Row = Record<string, unknown>

/**
 * Minimal stand-in for the PostgREST builder. Every filter method returns
 * `this`, and awaiting the builder resolves to the rows registered for that
 * table — enough surface for the queries the module actually issues.
 */
function tableStub(rowsByTable: Record<string, Row[]>) {
  return (table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const method of ['select', 'eq', 'gte', 'lte', 'not', 'in', 'order', 'limit']) {
      builder[method] = vi.fn(chain)
    }
    builder.then = (resolve: (v: { data: Row[] }) => unknown) =>
      resolve({ data: rowsByTable[table] ?? [] })
    return builder
  }
}

const ORG = '00000000-0000-4000-8000-0000000000aa'

function session(id: string, campaign: string, startedAt: string, visitorId: string) {
  return {
    id,
    visitor_id: visitorId,
    started_at: startedAt,
    utm_source: 'facebook',
    utm_medium: 'cpc',
    utm_campaign: campaign,
  }
}

beforeEach(() => {
  serviceClient.from.mockReset()
})

describe('Ads attribution — single-touch credit', () => {
  it('credits a multi-campaign contact to exactly one campaign', async () => {
    // One contact clicked three campaigns and produced one $10,000 deal.
    // The previous implementation reported $10k against each campaign, so the
    // summed totals claimed $30,000 of pipeline that never existed.
    serviceClient.from.mockImplementation(tableStub({
      analytics_sessions: [
        session('s1', 'awareness', '2026-08-01T10:00:00Z', 'v1'),
        session('s2', 'retargeting', '2026-08-05T10:00:00Z', 'v1'),
        session('s3', 'conversion', '2026-08-10T10:00:00Z', 'v1'),
      ],
      analytics_visitors: [{ id: 'v1', contact_id: 'c1' }],
      analytics_events: [],
      opportunities: [{ id: 'o1', contact_id: 'c1', value: 10000 }],
    }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'meta',
    })

    expect(result.totals.revenue).toBe(10000)
    expect(result.totals.opportunities).toBe(1)
    expect(result.totals.identified_contacts).toBe(1)

    // And the rows themselves sum to the totals — the property that makes the
    // headline figure trustworthy.
    const summed = result.rows.reduce((acc, r) => acc + r.revenue, 0)
    expect(summed).toBe(result.totals.revenue)
  })

  it('gives last_touch credit to the most recent identifying session', async () => {
    serviceClient.from.mockImplementation(tableStub({
      analytics_sessions: [
        session('s1', 'awareness', '2026-08-01T10:00:00Z', 'v1'),
        session('s3', 'conversion', '2026-08-10T10:00:00Z', 'v1'),
      ],
      analytics_visitors: [{ id: 'v1', contact_id: 'c1' }],
      analytics_events: [],
      opportunities: [{ id: 'o1', contact_id: 'c1', value: 10000 }],
    }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'meta',
      model: 'last_touch',
    })

    const winner = result.rows.find((r) => r.revenue > 0)
    expect(winner?.utm_campaign).toBe('conversion')
    expect(result.model).toBe('last_touch')
  })

  it('gives first_touch credit to the earliest identifying session', async () => {
    serviceClient.from.mockImplementation(tableStub({
      analytics_sessions: [
        session('s1', 'awareness', '2026-08-01T10:00:00Z', 'v1'),
        session('s3', 'conversion', '2026-08-10T10:00:00Z', 'v1'),
      ],
      analytics_visitors: [{ id: 'v1', contact_id: 'c1' }],
      analytics_events: [],
      opportunities: [{ id: 'o1', contact_id: 'c1', value: 10000 }],
    }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'meta',
      model: 'first_touch',
    })

    const winner = result.rows.find((r) => r.revenue > 0)
    expect(winner?.utm_campaign).toBe('awareness')
    expect(result.model).toBe('first_touch')
  })

  it('counts two opportunities of equal value separately', async () => {
    // The original SQL used SUM(DISTINCT value), which collapsed two genuinely
    // separate $1,000 deals into one. Guard against a regression.
    serviceClient.from.mockImplementation(tableStub({
      analytics_sessions: [session('s1', 'conversion', '2026-08-10T10:00:00Z', 'v1')],
      analytics_visitors: [{ id: 'v1', contact_id: 'c1' }],
      analytics_events: [],
      opportunities: [
        { id: 'o1', contact_id: 'c1', value: 1000 },
        { id: 'o2', contact_id: 'c1', value: 1000 },
      ],
    }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'meta',
    })

    expect(result.totals.opportunities).toBe(2)
    expect(result.totals.revenue).toBe(2000)
  })

  it('still counts sessions per campaign, not per attributed contact', async () => {
    serviceClient.from.mockImplementation(tableStub({
      analytics_sessions: [
        session('s1', 'awareness', '2026-08-01T10:00:00Z', 'v1'),
        session('s2', 'awareness', '2026-08-02T10:00:00Z', 'v2'),
        session('s3', 'conversion', '2026-08-10T10:00:00Z', 'v1'),
      ],
      analytics_visitors: [{ id: 'v1', contact_id: 'c1' }],
      analytics_events: [],
      opportunities: [],
    }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'meta',
    })

    expect(result.totals.sessions).toBe(3)
    expect(result.rows.find((r) => r.utm_campaign === 'awareness')?.sessions).toBe(2)
  })

  it('picks up contacts identified only by a session event', async () => {
    serviceClient.from.mockImplementation(tableStub({
      analytics_sessions: [session('s1', 'conversion', '2026-08-10T10:00:00Z', 'v9')],
      analytics_visitors: [],
      analytics_events: [{ session_id: 's1', contact_id: 'c7' }],
      opportunities: [{ id: 'o1', contact_id: 'c7', value: 500 }],
    }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'meta',
    })

    expect(result.totals.identified_contacts).toBe(1)
    expect(result.totals.revenue).toBe(500)
  })

  it('returns an empty summary when no sessions match', async () => {
    serviceClient.from.mockImplementation(tableStub({ analytics_sessions: [] }))

    const result = await getAdsAttributionForOrg({
      orgId: ORG,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
      platformFilter: 'google',
    })

    expect(result.rows).toEqual([])
    expect(result.totals).toEqual({ sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 })
  })
})
