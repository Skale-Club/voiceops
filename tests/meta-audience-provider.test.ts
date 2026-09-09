import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MetaAudienceConnectionError,
  OrgOAuthProvider,
  type AdsConnectionQueryClient,
} from '@/lib/meta/audience-provider'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000002'
const TOKEN = 'fixture-meta-token-that-must-never-appear-in-errors'

type Row = {
  id: string
  org_id: string
  platform: string
  ad_account_id: string
  status: string
  usable: boolean
  encrypted_access_token: string | null
  token_expires_at: string | null
}

const activeRow: Row = {
  id: CONNECTION_ID,
  org_id: ORG_ID,
  platform: 'meta',
  ad_account_id: 'act_123',
  status: 'active',
  usable: true,
  encrypted_access_token: 'encrypted-fixture',
  token_expires_at: '2026-12-01T00:00:00.000Z',
}

function clientFor(row: Row | null, queryError = false) {
  const filters = new Map<string, string>()
  const query = {
    eq(column: string, value: string) {
      filters.set(column, value)
      return query
    },
    async maybeSingle() {
      if (queryError) return { data: null, error: { message: `unsafe ${TOKEN}` } }
      if (!row) return { data: null, error: null }
      const selected = [...filters].every(([column, value]) => row[column as keyof Row] === value)
      return { data: selected ? row : null, error: null }
    },
  }
  const client: AdsConnectionQueryClient = {
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
  }
  return { client, filters }
}

function providerFor(row: Row | null, options: { queryError?: boolean; decryptFails?: boolean } = {}) {
  const { client, filters } = clientFor(row, options.queryError)
  const decryptToken = options.decryptFails
    ? vi.fn(async () => { throw new Error(`unsafe ${TOKEN}`) })
    : vi.fn(async () => TOKEN)
  return {
    provider: new OrgOAuthProvider(client, {
      decryptToken,
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    }),
    decryptToken,
    filters,
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(MetaAudienceConnectionError)
  expect(caught).toMatchObject({ code })
  expect(String(caught)).not.toContain(TOKEN)
}

describe('OrgOAuthProvider', () => {
  afterEach(() => {
    delete process.env.META_SYSTEM_USER_TOKEN
  })

  it('returns only the explicit tenant-owned active connection token', async () => {
    const { provider, decryptToken, filters } = providerFor(activeRow)
    await expect(provider.getConnection(ORG_ID, 'act_123', CONNECTION_ID)).resolves.toEqual({
      token: TOKEN,
      adAccountId: 'act_123',
      connectionId: CONNECTION_ID,
    })
    expect(filters).toEqual(new Map([
      ['id', CONNECTION_ID],
      ['org_id', ORG_ID],
      ['platform', 'meta'],
    ]))
    expect(decryptToken).toHaveBeenCalledWith('encrypted-fixture')
  })

  it.each([
    ['CONNECTION_ID_REQUIRED', undefined, ORG_ID, 'act_123', activeRow],
    ['CONNECTION_NOT_FOUND', CONNECTION_ID, ORG_ID, 'act_123', null],
    ['CONNECTION_NOT_FOUND', CONNECTION_ID, 'wrong-org', 'act_123', activeRow],
    ['CONNECTION_INACTIVE', CONNECTION_ID, ORG_ID, 'act_123', { ...activeRow, usable: false }],
    ['CONNECTION_ACCOUNT_MISMATCH', CONNECTION_ID, ORG_ID, 'act_other', activeRow],
    ['CONNECTION_EXPIRY_UNKNOWN', CONNECTION_ID, ORG_ID, 'act_123', { ...activeRow, token_expires_at: null }],
    ['CONNECTION_EXPIRED', CONNECTION_ID, ORG_ID, 'act_123', { ...activeRow, token_expires_at: '2026-08-01T00:00:00Z' }],
    ['CONNECTION_TOKEN_MISSING', CONNECTION_ID, ORG_ID, 'act_123', { ...activeRow, encrypted_access_token: null }],
  ] as const)('fails closed with %s', async (code, connectionId, orgId, adAccountId, row) => {
    process.env.META_SYSTEM_USER_TOKEN = 'agency-token-must-not-be-used'
    const { provider, decryptToken } = providerFor(row)
    await expectCode(provider.getConnection(orgId, adAccountId, connectionId), code)
    if (code !== 'CONNECTION_TOKEN_MISSING') expect(decryptToken).not.toHaveBeenCalled()
  })

  it('maps lookup and decrypt failures to safe errors without leaking provider details', async () => {
    const inaccessible = providerFor(activeRow, { queryError: true })
    await expectCode(
      inaccessible.provider.getConnection(ORG_ID, 'act_123', CONNECTION_ID),
      'CONNECTION_INACCESSIBLE',
    )

    const decryptFailure = providerFor(activeRow, { decryptFails: true })
    await expectCode(
      decryptFailure.provider.getConnection(ORG_ID, 'act_123', CONNECTION_ID),
      'CONNECTION_DECRYPT_FAILED',
    )
  })

  it('never reaches Graph fetch while resolving or rejecting a credential', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { provider } = providerFor(activeRow)
    await provider.getConnection(ORG_ID, 'act_123', CONNECTION_ID)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
