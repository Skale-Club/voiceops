import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceRoleClientMock = vi.fn()
const markMetaAudiencesDirtyMock = vi.fn(async () => ({ marked: 1 }))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: createServiceRoleClientMock }))
vi.mock('@/lib/meta/audience-dirty', () => ({ markMetaAudiencesDirty: markMetaAudiencesDirtyMock }))

type QueryResult = { data: unknown; error: unknown }

function makeBuilder(results: { awaited?: QueryResult; maybeSingle?: QueryResult } = {}) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'filter', 'insert', 'update', 'upsert', 'in']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => results.maybeSingle ?? { data: null, error: null })
  builder.then = (resolve: (result: QueryResult) => unknown) =>
    resolve(results.awaited ?? { data: null, error: null })
  return builder as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResult>
}

beforeEach(() => {
  createServiceRoleClientMock.mockReset()
  markMetaAudiencesDirtyMock.mockClear()
  vi.resetModules()
})

describe('prospect opt-out propagation to Meta audiences', () => {
  it('finds an account by custom_fields.email, unsubscribes it, and marks only its org dirty', async () => {
    const apiKey = makeBuilder({
      maybeSingle: { data: { id: 'key-1', org_id: 'org-skale', scopes: ['optout:write'] }, error: null },
    })
    const contactLookup = makeBuilder({ awaited: { data: [], error: null } })
    const accountEmailLookup = makeBuilder({ awaited: { data: [{ id: 'account-1' }], error: null } })
    const accountUpdate = makeBuilder()
    const eventInsert = makeBuilder()
    const suppressionUpsert = makeBuilder()
    const keyTouch = makeBuilder()
    let apiKeyCalls = 0
    let accountCalls = 0
    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeyCalls++ === 0 ? apiKey : keyTouch
      if (table === 'contacts') return contactLookup
      if (table === 'accounts') return accountCalls++ === 0 ? accountEmailLookup : accountUpdate
      if (table === 'prospect_engagement_events') return eventInsert
      if (table === 'email_unsubscribes') return suppressionUpsert
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/optout/route')
    const response = await POST(new Request('https://xphere.app/api/v1/optout', {
      method: 'POST',
      headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
      body: JSON.stringify({ email: ' Owner@HudsonBarber.com ', source: 'campaign' }),
    }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ opted_out: true, affected_records: 1 })
    expect(accountEmailLookup.filter).toHaveBeenCalledWith(
      'custom_fields->>email', 'eq', 'owner@hudsonbarber.com',
    )
    expect(accountUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      engagement_status: 'unsubscribed', recommended_channel: null,
    }))
    expect(markMetaAudiencesDirtyMock).toHaveBeenCalledTimes(1)
    expect(markMetaAudiencesDirtyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-skale', reason: 'prospect_optout' }),
    )
  })

  it('does not dirty audiences when every opt-out write fails', async () => {
    const apiKey = makeBuilder({
      maybeSingle: { data: { id: 'key-1', org_id: 'org-skale', scopes: ['optout:write'] }, error: null },
    })
    const contactLookup = makeBuilder({ awaited: { data: [], error: null } })
    const accountEmailLookup = makeBuilder({ awaited: { data: [{ id: 'account-1' }], error: null } })
    const accountUpdate = makeBuilder({ awaited: { data: null, error: { message: 'write failed' } } })
    const suppressionUpsert = makeBuilder({ awaited: { data: null, error: { message: 'write failed' } } })
    const keyTouch = makeBuilder()
    let apiKeyCalls = 0
    let accountCalls = 0
    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeyCalls++ === 0 ? apiKey : keyTouch
      if (table === 'contacts') return contactLookup
      if (table === 'accounts') return accountCalls++ === 0 ? accountEmailLookup : accountUpdate
      if (table === 'email_unsubscribes') return suppressionUpsert
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/optout/route')
    await POST(new Request('https://xphere.app/api/v1/optout', {
      method: 'POST',
      headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@hudsonbarber.com' }),
    }))

    expect(markMetaAudiencesDirtyMock).not.toHaveBeenCalled()
  })
})
