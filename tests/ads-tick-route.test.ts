// tests/ads-tick-route.test.ts
//
// Regression guard for ITEM 0 of docs/integrations/ads-connection-health-plan.md:
// the nightly expiry watch in api/cron/ads-tick/route.ts used to write
// `status: 'error'` directly (the exact conflation the whole plan exists to
// remove), which would (a) violate migration 1300's narrowed status CHECK and
// throw, and (b) silently reintroduce the original bug every night. This
// asserts the fixed behavior: the expired-token path goes through
// markConnectionError (health only), and the untouched "expiring soon" path
// still writes connection_error only, never status.
//
// Mirrors tests/calendar-tick-route.test.ts's mock-Supabase + dynamic-import
// pattern: @supabase/supabase-js is intercepted so no real network/DB call
// can happen against this worktree's production-pointed .env.local, and the
// route is re-imported per test (via vi.resetModules) because it reads
// CRON_SECRET / SUPABASE_URL / SERVICE_KEY into module-level consts at
// import time, not per-request.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = {
  id: string
  org_id: string
  platform: string
  ad_account_id: string
  ad_account_name: string | null
  token_expires_at: string | null
  status: string
}

const supaState = vi.hoisted(() => ({
  client: null as null | { from: (table: string) => unknown },
  updateCalls: [] as Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
}))

const { markConnectionErrorMock } = vi.hoisted(() => ({
  markConnectionErrorMock: vi.fn(async () => {}),
}))

function fakeSupabase(rows: Row[]) {
  supaState.updateCalls = []
  function builder() {
    let mode: 'select' | 'update' = 'select'
    let payload: Record<string, unknown> | null = null
    const eqFilters: Array<[string, unknown]> = []
    const inFilters: Array<[string, unknown[]]> = []
    let notNullCol: string | null = null
    const api = {
      select() {
        return api
      },
      update(p: Record<string, unknown>) {
        mode = 'update'
        payload = p
        return api
      },
      in(col: string, vals: unknown[]) {
        inFilters.push([col, vals])
        return api
      },
      // route.ts only ever calls `.not(col, 'is', null)` — the operator and
      // value are fixed by that call shape, so this fake only needs the
      // column name.
      not(col: string) {
        notNullCol = col
        return api
      },
      eq(col: string, val: unknown) {
        eqFilters.push([col, val])
        return api
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        if (mode === 'update') {
          supaState.updateCalls.push({ payload: payload as Record<string, unknown>, filters: eqFilters })
          return resolve({ data: null, error: null })
        }
        const matches = rows.filter(
          (r) =>
            eqFilters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v) &&
            inFilters.every(([c, vs]) => vs.includes((r as unknown as Record<string, unknown>)[c])) &&
            (notNullCol === null || (r as unknown as Record<string, unknown>)[notNullCol] != null),
        )
        return resolve({ data: matches, error: null })
      },
    }
    return api
  }
  return {
    from(table: string) {
      if (table !== 'ads_connections') throw new Error(`unexpected table ${table}`)
      return builder()
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => supaState.client),
}))

vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() }),
}))

vi.mock('@/lib/api-error', () => ({ captureApiError: vi.fn() }))

vi.mock('@/lib/ads/snapshot-daily', () => ({
  captureDailyInsights: vi.fn(async () => []),
}))

// Hand-rolled instead of `importOriginal` + spread: the real module's import
// chain (meta-api.ts/google-api.ts) pulls in src/lib/redis.ts, which opens a
// real `redis.connect()` on import — against this worktree's
// production-pointed .env.local, that hung for ~30s and made the test flaky.
// `daysUntilExpiry`/`EXPIRY_WARNING_DAYS` are already covered directly in
// tests/ads-connection-health.test.ts, so duplicating their (tiny, pure)
// logic here keeps this test hermetic.
vi.mock('@/lib/ads/connection-health', () => ({
  EXPIRY_WARNING_DAYS: 7,
  daysUntilExpiry: (tokenExpiresAt: string | null, now = new Date()) => {
    if (!tokenExpiresAt) return null
    const expiry = new Date(tokenExpiresAt)
    if (Number.isNaN(expiry.getTime())) return null
    return Math.floor((expiry.getTime() - now.getTime()) / 86_400_000)
  },
  markConnectionError: markConnectionErrorMock,
}))

function makeRequest(qs = 'skip_snapshot=true'): Request {
  return new Request(`http://localhost/api/cron/ads-tick?${qs}`, {
    headers: { Authorization: 'Bearer test-ads-tick-secret' },
  })
}

async function importRoute() {
  vi.resetModules()
  process.env.CRON_SECRET = 'test-ads-tick-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  return import('@/app/api/cron/ads-tick/route')
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

describe('GET /api/cron/ads-tick — expiry watch writes health, never status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markConnectionErrorMock.mockClear()
  })

  it('an already-expired token goes through markConnectionError (health only) — no direct status write', async () => {
    const rows: Row[] = [
      {
        id: 'conn-expired',
        org_id: 'org-1',
        platform: 'meta',
        ad_account_id: 'act_expired',
        ad_account_name: 'Expired Co',
        token_expires_at: inDays(-5),
        status: 'active',
      },
    ]
    supaState.client = fakeSupabase(rows)
    const { GET } = await importRoute()

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.expiry).toEqual({ expiringSoon: 0, expired: 1 })

    // The only writer for the expired branch is markConnectionError — the
    // hand-rolled `.update({ status: 'error', ... })` this test guards
    // against no longer exists in the route.
    expect(markConnectionErrorMock).toHaveBeenCalledTimes(1)
    expect(markConnectionErrorMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      platform: 'meta',
      adAccountId: 'act_expired',
      error: expect.any(Error),
    })

    // And the raw update spy — which WOULD have recorded a hand-rolled
    // `.update({ status: 'error', ... })` had Item 0 not been fixed — was
    // never called at all for this row.
    expect(supaState.updateCalls).toHaveLength(0)
  })

  it('a token expiring soon (but not yet expired) still only writes connection_error — status untouched, as the code comment requires', async () => {
    const rows: Row[] = [
      {
        id: 'conn-soon',
        org_id: 'org-1',
        platform: 'google',
        ad_account_id: 'act_soon',
        ad_account_name: 'Expiring Soon Co',
        token_expires_at: inDays(3),
        status: 'active',
      },
    ]
    supaState.client = fakeSupabase(rows)
    const { GET } = await importRoute()

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.expiry).toEqual({ expiringSoon: 1, expired: 0 })

    expect(markConnectionErrorMock).not.toHaveBeenCalled()
    expect(supaState.updateCalls).toHaveLength(1)
    const call = supaState.updateCalls[0]
    expect(call.payload).toHaveProperty('connection_error')
    expect(call.payload).not.toHaveProperty('status')
    expect(call.payload).not.toHaveProperty('health')
  })

  it('a token nowhere near expiry triggers neither path', async () => {
    const rows: Row[] = [
      {
        id: 'conn-healthy',
        org_id: 'org-1',
        platform: 'meta',
        ad_account_id: 'act_healthy',
        ad_account_name: 'Healthy Co',
        token_expires_at: inDays(60),
        status: 'active',
      },
    ]
    supaState.client = fakeSupabase(rows)
    const { GET } = await importRoute()

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.expiry).toEqual({ expiringSoon: 0, expired: 0 })
    expect(markConnectionErrorMock).not.toHaveBeenCalled()
    expect(supaState.updateCalls).toHaveLength(0)
  })
})
