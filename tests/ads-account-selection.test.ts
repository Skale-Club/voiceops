// tests/ads-account-selection.test.ts
//
// Phase 5 of docs/integrations/ads-connection-health-plan.md: a selection
// change must never alter health, and (mirrored in
// tests/ads-connection-health.test.ts) a health change must never alter
// status. account-selection.ts was verified rather than changed in Phase 2
// because both its writes are explicit `.update({ status: ... })` calls with
// no spread of other fields — this locks that in as a regression guard.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const getUserMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

type Row = { platform: string; ad_account_id: string; ad_account_name: string | null; status: string; health: string }

const state = vi.hoisted(() => ({ rows: [] as Row[] }))

function fakeClient() {
  return {
    from(table: string) {
      if (table !== 'ads_connections') throw new Error(`unexpected table ${table}`)
      let payload: Partial<Row> | null = null
      const eqFilters: Array<[string, unknown]> = []
      let inFilter: [string, string[]] | null = null
      const api = {
        select() {
          return api
        },
        update(p: Partial<Row>) {
          payload = p
          return api
        },
        eq(col: string, val: unknown) {
          eqFilters.push([col, val])
          return api
        },
        in(col: string, vals: string[]) {
          inFilter = [col, vals]
          return api
        },
        order() {
          return api
        },
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          const matches = state.rows.filter(
            (r) =>
              eqFilters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v) &&
              (!inFilter || inFilter[1].includes((r as unknown as Record<string, unknown>)[inFilter[0]] as string)),
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

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUserMock(),
  createClient: async () => fakeClient(),
}))

import { setActiveAdAccounts, setAdAccountObjective } from '@/app/(dashboard)/ads/_actions/account-selection'

function row(overrides: Partial<Row> = {}): Row {
  return { platform: 'meta', ad_account_id: 'act_1', ad_account_name: 'Acme', status: 'available', health: 'ok', ...overrides }
}

describe('Ad account selection never touches health', () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ id: 'user-1' })
  })

  it('setActiveAdAccounts hides everything else and activates the chosen ids, without altering health in either direction', async () => {
    state.rows = [
      row({ ad_account_id: 'act_1', status: 'active', health: 'error' }), // was selected AND broken
      row({ ad_account_id: 'act_2', status: 'active', health: 'ok' }), // was selected, healthy — being deselected now
      row({ ad_account_id: 'act_3', status: 'available', health: 'ok' }), // being newly selected
    ]

    const result = await setActiveAdAccounts('meta', ['act_1', 'act_3'])
    expect(result).toEqual({})

    const byId = new Map(state.rows.map((r) => [r.ad_account_id, r]))
    // Selection changed exactly as asked...
    expect(byId.get('act_1')!.status).toBe('active')
    expect(byId.get('act_2')!.status).toBe('available')
    expect(byId.get('act_3')!.status).toBe('active')
    // ...and health is untouched on every row, including the one that was
    // both selected AND broken (an admin picking a broken account back into
    // view must not silently re-mark it healthy).
    expect(byId.get('act_1')!.health).toBe('error')
    expect(byId.get('act_2')!.health).toBe('ok')
    expect(byId.get('act_3')!.health).toBe('ok')
  })

  it('setActiveAdAccounts with an empty selection hides every account and still never touches health', async () => {
    state.rows = [row({ ad_account_id: 'act_1', status: 'active', health: 'error' })]
    await setActiveAdAccounts('meta', [])
    expect(state.rows[0].status).toBe('available')
    expect(state.rows[0].health).toBe('error')
  })

  it('setAdAccountObjective writes only ad_objective, never status or health', async () => {
    state.rows = [row({ ad_account_id: 'act_1', status: 'active', health: 'error' })]
    await setAdAccountObjective('act_1', 'meta', 'leads')
    // ad_objective isn't modeled on this fixture row, so the meaningful
    // assertion is the negative one: neither selection nor health moved.
    expect(state.rows[0].status).toBe('active')
    expect(state.rows[0].health).toBe('error')
  })
})
