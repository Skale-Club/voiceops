import { describe, expect, it, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

// Rows the stubbed client returns, keyed by the usable/health filter the
// query applies (ai-accounts.ts moved off `.eq('status', ...)` in Phase 3 of
// docs/integrations/ads-connection-health-plan.md — see connection-health-plan
// for why `usable` and `health` are separate columns now).
let activeRows: Row[] = []
let errorRows: Row[] = []

const serviceClient = {
  from: () => {
    let wantedUsable: boolean | null = null
    let wantedHealth: string | null = null
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.order = vi.fn(() => builder)
    builder.eq = vi.fn((column: string, value: unknown) => {
      if (column === 'usable') wantedUsable = value as boolean
      if (column === 'health') wantedHealth = value as string
      return builder
    })
    builder.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: wantedHealth === 'error' ? errorRows : wantedUsable === true ? activeRows : [], error: null })
    return builder
  },
}

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => serviceClient }))
vi.mock('@/lib/crypto', () => ({ decrypt: async (v: string) => `decrypted:${v}` }))

import { resolveAdAccount } from '@/lib/ads/ai-accounts'

const ORG = 'org-1'

function account(id: string, name: string) {
  return {
    ad_account_id: id,
    ad_account_name: name,
    encrypted_access_token: `tok_${id}`,
    status: 'active',
    connection_error: null,
  }
}

beforeEach(() => {
  activeRows = []
  errorRows = []
})

describe('AI ad-account resolution', () => {
  it('uses the only active account when none is specified', async () => {
    activeRows = [account('act_111', 'Acme BR')]
    const result = await resolveAdAccount(ORG, 'meta')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accountId).toBe('act_111')
      expect(result.token).toBe('decrypted:tok_act_111')
    }
  })

  it('refuses to guess when the org has several active accounts', async () => {
    // The old helper silently took the first row, so the AI could answer with
    // one account's numbers while the operator was looking at another.
    activeRows = [account('act_111', 'Acme BR'), account('act_222', 'Acme US')]
    const result = await resolveAdAccount(ORG, 'meta')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('ambiguous_account')
      expect(result.available).toHaveLength(2)
      // The candidates travel with the error so the model can ask a real question.
      expect(result.detail).toContain('ad_account_id')
    }
  })

  it('honours an explicitly requested account', async () => {
    activeRows = [account('act_111', 'Acme BR'), account('act_222', 'Acme US')]
    const result = await resolveAdAccount(ORG, 'meta', 'act_222')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.accountId).toBe('act_222')
  })

  it('reports a requested account that is not active', async () => {
    activeRows = [account('act_111', 'Acme BR')]
    const result = await resolveAdAccount(ORG, 'meta', 'act_999')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('account_not_found')
      expect(result.available).toHaveLength(1)
    }
  })

  it('never returns an account the admin has not opted into', async () => {
    // 'available' means connected but deliberately hidden from the dashboard.
    // Reading from it would answer with data the operator is not looking at.
    activeRows = []
    const result = await resolveAdAccount(ORG, 'meta')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_connection')
  })

  it('distinguishes a broken connection from no connection at all', async () => {
    // These need completely different things from the operator: one is
    // "reconnect", the other is "connect for the first time".
    activeRows = []
    errorRows = [{
      ad_account_id: 'act_111',
      ad_account_name: 'Acme BR',
      connection_error: 'The access token expired. Reconnect this account to resume reporting.',
    }]

    const result = await resolveAdAccount(ORG, 'meta')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('connection_error')
      expect(result.detail).toContain('re-authorize')
      expect(result.detail).toContain('expired')
    }
  })
})
