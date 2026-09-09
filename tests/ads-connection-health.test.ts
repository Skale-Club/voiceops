import { describe, expect, it, vi, beforeEach } from 'vitest'

// Shared, mutable row store for the `@/lib/supabase/admin` mock below.
// `vi.hoisted` is required here (not a plain `let`/`const`) because vi.mock
// factories are hoisted above the rest of this file, so anything they close
// over must be created the same way. Each test resets `state.rows` in its
// own setup rather than sharing rows across tests.
const state = vi.hoisted(() => ({ rows: [] as ConnRow[] }))

type ConnRow = {
  org_id: string
  platform: 'meta' | 'google'
  ad_account_id: string
  status: 'active' | 'available'
  health: 'ok' | 'error'
  connection_error: string | null
  last_error_at: string | null
  last_verified_at: string | null
}

/**
 * Minimal fake of the supabase-js query builder, just enough for the
 * `.from('ads_connections').update({...}).eq(...).eq(...)...` shape every
 * writer in `connection-health.ts` uses. Applies the update to whichever
 * rows in `rows` match every `.eq()` filter, mirroring real Postgres
 * row-scoping — so a test can assert not just that a write happened, but
 * exactly which fields it touched and which rows it left alone.
 */
function fakeAdminClient(rows: ConnRow[]) {
  return {
    from(table: string) {
      if (table !== 'ads_connections') throw new Error(`unexpected table ${table}`)
      let payload: Partial<ConnRow> | null = null
      const filters: Array<[string, unknown]> = []
      const api = {
        update(p: Partial<ConnRow>) {
          payload = p
          return api
        },
        eq(col: string, val: unknown) {
          filters.push([col, val])
          return api
        },
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          const matches = rows.filter((r) =>
            filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v),
          )
          if (payload) {
            for (const r of matches) Object.assign(r, payload)
          }
          return resolve({ data: matches, error: null })
        },
      }
      return api
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => fakeAdminClient(state.rows),
}))

import {
  isAuthError,
  daysUntilExpiry,
  EXPIRY_WARNING_DAYS,
  computeUsable,
  markConnectionError,
  markConnectionHealthy,
  withConnectionHealth,
  withMetaConnection,
} from '@/lib/ads/connection-health'
import { isBroken } from '@/app/(dashboard)/ads/_components/connection-health-banner'
import { MetaAdsError } from '@/lib/ads/meta-api'
import { GoogleAdsError } from '@/lib/ads/google-api'

function row(overrides: Partial<ConnRow> = {}): ConnRow {
  return {
    org_id: 'org-1',
    platform: 'meta',
    ad_account_id: 'act_1',
    status: 'active',
    health: 'ok',
    connection_error: null,
    last_error_at: null,
    last_verified_at: null,
    ...overrides,
  }
}

describe('Ads connection health — auth error detection', () => {
  it('treats Meta code 190 as a dead credential', () => {
    // 190 is what an expired or revoked user token comes back as. Before this
    // was recognised it surfaced as a generic 502 and the connection stayed
    // marked healthy forever.
    expect(isAuthError(new MetaAdsError('Error validating access token', 190))).toBe(true)
  })

  it('recognises the other Meta auth codes', () => {
    expect(isAuthError(new MetaAdsError('Session expired', 102))).toBe(true)
    expect(isAuthError(new MetaAdsError('Permission denied', 467))).toBe(true)
  })

  it('recognises expiry subcodes under a generic code', () => {
    expect(isAuthError(new MetaAdsError('Session has expired', 190, 463))).toBe(true)
  })

  it('does NOT treat a rate limit or upstream fault as a dead credential', () => {
    // Marking these would show the operator a Reconnect prompt for a problem
    // reconnecting cannot fix.
    expect(isAuthError(new MetaAdsError('User request limit reached', 17))).toBe(false)
    expect(isAuthError(new MetaAdsError('Please reduce the amount of data', 1))).toBe(false)
    expect(isAuthError(new MetaAdsError('Unknown error', 2))).toBe(false)
  })

  it('recognises Google auth failures by status and message', () => {
    expect(isAuthError(new GoogleAdsError('Request had invalid authentication', 'UNAUTHENTICATED'))).toBe(true)
    expect(isAuthError(new GoogleAdsError('The caller does not have permission', 'PERMISSION_DENIED'))).toBe(true)
    expect(isAuthError(new Error('Google token refresh failed: invalid_grant'))).toBe(true)
  })

  it('does NOT treat a Google quota error as a dead credential', () => {
    expect(isAuthError(new GoogleAdsError('Resource exhausted', 'RESOURCE_EXHAUSTED'))).toBe(false)
    expect(isAuthError(new GoogleAdsError('Internal error', 'INTERNAL'))).toBe(false)
  })

  it('handles non-error values without throwing', () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError('some string')).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
  })
})

describe('Token expiry window', () => {
  const now = new Date('2026-08-21T00:00:00.000Z')

  it('returns null when no expiry is recorded', () => {
    expect(daysUntilExpiry(null, now)).toBeNull()
    expect(daysUntilExpiry('not-a-date', now)).toBeNull()
  })

  it('counts days remaining', () => {
    expect(daysUntilExpiry('2026-08-28T00:00:00.000Z', now)).toBe(7)
    expect(daysUntilExpiry('2026-10-20T00:00:00.000Z', now)).toBe(60)
  })

  it('returns a non-positive number once the token has lapsed', () => {
    expect(daysUntilExpiry('2026-08-20T00:00:00.000Z', now)).toBeLessThanOrEqual(0)
    expect(daysUntilExpiry('2026-06-01T00:00:00.000Z', now)).toBeLessThan(0)
  })

  it('flags a token inside the warning window', () => {
    const days = daysUntilExpiry('2026-08-25T00:00:00.000Z', now)
    expect(days).not.toBeNull()
    expect(days! > 0 && days! <= EXPIRY_WARNING_DAYS).toBe(true)
  })
})

describe('usable semantics (mirrors the migration 1300 generated column)', () => {
  // The generated column itself (`status = 'active' AND health = 'ok'`) can
  // only be exercised against a live database — this is the pure-function
  // mirror every other test (and the UI) checks against instead.
  it('is usable only when active AND ok', () => {
    expect(computeUsable('active', 'ok')).toBe(true)
  })

  it('is not usable when hidden (available), regardless of health', () => {
    expect(computeUsable('available', 'ok')).toBe(false)
    expect(computeUsable('available', 'error')).toBe(false)
  })

  it('is not usable when the credential is broken, regardless of selection', () => {
    expect(computeUsable('active', 'error')).toBe(false)
  })
})

describe('markConnectionError / markConnectionHealthy — health only, never status', () => {
  beforeEach(() => {
    state.rows = [row()]
  })

  it('markConnectionError writes health + error fields and leaves status untouched', async () => {
    await markConnectionError({
      orgId: 'org-1',
      platform: 'meta',
      adAccountId: 'act_1',
      error: new Error('The stored access token was rejected.'),
    })

    expect(state.rows[0]).toMatchObject({
      status: 'active', // unchanged — this is the whole point
      health: 'error',
      connection_error: 'The stored access token was rejected.',
    })
    expect(state.rows[0].last_error_at).not.toBeNull()
  })

  it('markConnectionError never touches a hidden (available) selection either', async () => {
    state.rows = [row({ status: 'available' })]
    await markConnectionError({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1', error: new Error('dead') })
    expect(state.rows[0].status).toBe('available')
    expect(state.rows[0].health).toBe('error')
  })

  it('markConnectionHealthy clears health and leaves status untouched, including a hidden selection', async () => {
    state.rows = [row({ status: 'available', health: 'error', connection_error: 'old error', last_error_at: '2026-08-01T00:00:00.000Z' })]

    await markConnectionHealthy({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' })

    expect(state.rows[0]).toMatchObject({
      status: 'available', // still hidden — recovering health must not force it back to active
      health: 'ok',
      connection_error: null,
      last_error_at: null,
    })
    expect(state.rows[0].last_verified_at).not.toBeNull()
  })

  it('markConnectionHealthy is a no-op on an already-healthy row (filtered by .eq(health,error))', async () => {
    const healthy = row({ health: 'ok', last_verified_at: null })
    state.rows = [healthy]
    await markConnectionHealthy({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' })
    // Filter excluded it — last_verified_at must not have been churned.
    expect(healthy.last_verified_at).toBeNull()
  })
})

describe('withConnectionHealth', () => {
  beforeEach(() => {
    state.rows = [row()]
  })

  it('an auth error sets health=error without touching status', async () => {
    state.rows = [row({ status: 'active' })]
    await expect(
      withConnectionHealth({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' }, async () => {
        throw new MetaAdsError('Error validating access token', 190)
      }),
    ).rejects.toBeInstanceOf(MetaAdsError)

    expect(state.rows[0].health).toBe('error')
    expect(state.rows[0].status).toBe('active')
  })

  it('a later success clears health back to ok, still without touching status', async () => {
    state.rows = [row({ status: 'active', health: 'error', connection_error: 'stale' })]
    const result = await withConnectionHealth(
      { orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' },
      async () => 'ok-result',
    )
    expect(result).toBe('ok-result')
    expect(state.rows[0].health).toBe('ok')
    expect(state.rows[0].status).toBe('active')
  })

  it('a rate limit or 5xx changes neither health nor status', async () => {
    state.rows = [row({ status: 'active', health: 'ok' })]
    await expect(
      withConnectionHealth({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' }, async () => {
        throw new MetaAdsError('User request limit reached', 17)
      }),
    ).rejects.toBeInstanceOf(MetaAdsError)

    // isAuthError(17) is false, so markConnectionError must never have run —
    // reconnecting cannot fix a rate limit, and marking it broken would send
    // the operator chasing the wrong problem.
    expect(state.rows[0].health).toBe('ok')
    expect(state.rows[0].status).toBe('active')
  })
})

describe('withMetaConnection (Phase 4 helper for meta-api.ts call sites)', () => {
  beforeEach(() => {
    state.rows = [row({ ad_account_id: 'act_9' })]
  })

  it('marks health=error on an auth failure without touching status', async () => {
    await expect(
      withMetaConnection('org-1', 'act_9', async () => {
        throw new MetaAdsError('Error validating access token', 190)
      }),
    ).rejects.toThrow()
    expect(state.rows[0].health).toBe('error')
    expect(state.rows[0].status).toBe('active')
  })

  it('recovers health=ok on success without touching status', async () => {
    state.rows = [row({ ad_account_id: 'act_9', health: 'error' })]
    const result = await withMetaConnection('org-1', 'act_9', async () => 42)
    expect(result).toBe(42)
    expect(state.rows[0].health).toBe('ok')
    expect(state.rows[0].status).toBe('active')
  })
})

describe('Round trip: a reconnect must fix health AND preserve the prior selection', () => {
  // This is the regression test for the defect this whole plan exists to fix
  // (commit b36d2aaa, 2026-08-21 — "fix(ads): fix connection health", which
  // shipped with 71 tests and never closed this loop). It shipped detection
  // (a dead credential could be spotted) but never verified recovery — a row
  // stuck on the old conflated status='error' never came back after a
  // successful reconnect. Asserting only "an error can be set" would have let
  // that ship again; this asserts the whole loop.
  it('a connection stuck at health=error with status=active preserved recovers to health=ok with the same status, and the banner stops flagging it', async () => {
    // Start exactly where production was measured on 2026-09-09: a selected
    // (status='active') account whose credential was rejected.
    state.rows = [
      row({
        status: 'active',
        health: 'error',
        connection_error: 'The stored access token was rejected.',
        last_error_at: '2026-08-23T00:00:00.000Z',
      }),
    ]

    // Sanity: the banner currently flags this connection as broken.
    expect(isBroken(state.rows[0])).toBe(true)

    // A successful reconnect (the OAuth callback, or any withConnectionHealth
    // -wrapped call that succeeds) writes health only — exactly what
    // markConnectionHealthy does, and what api/ads/meta/callback and
    // api/ads/google/callback do via their own upsert (Phase 2, already
    // shipped). It must never re-derive or overwrite the admin's selection.
    await markConnectionHealthy({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' })

    expect(state.rows[0].status).toBe('active') // preserved, not re-derived
    expect(state.rows[0].health).toBe('ok')
    expect(state.rows[0].connection_error).toBeNull()

    // The full loop closes only if the UI signal that started the incident
    // (the Reconnect banner) also clears.
    expect(isBroken(state.rows[0])).toBe(false)
  })

  it('the same round trip preserves a HIDDEN (available) selection too — recovering health must never re-show a hidden account', async () => {
    state.rows = [row({ status: 'available', health: 'error' })]
    expect(isBroken(state.rows[0])).toBe(true)

    await markConnectionHealthy({ orgId: 'org-1', platform: 'meta', adAccountId: 'act_1' })

    expect(state.rows[0].status).toBe('available')
    expect(state.rows[0].health).toBe('ok')
    expect(isBroken(state.rows[0])).toBe(false)
  })
})
