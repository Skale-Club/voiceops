import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceRoleClientMock = vi.fn()
const markMetaAudiencesDirtyMock = vi.fn(async () => ({ marked: 1 }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}))

vi.mock('@/lib/meta/audience-dirty', () => ({
  markMetaAudiencesDirty: markMetaAudiencesDirtyMock,
}))

type QueryResult = { data: unknown; error: unknown }

function makeBuilder(results: {
  maybeSingle?: QueryResult
  single?: QueryResult
  awaited?: QueryResult
} = {}) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'ilike', 'insert', 'update', 'in', 'neq', 'limit', 'contains']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => results.maybeSingle ?? { data: null, error: null })
  builder.single = vi.fn(async () => results.single ?? { data: null, error: null })
  builder.then = (resolve: (result: QueryResult) => unknown) =>
    resolve(results.awaited ?? { data: null, error: null })
  return builder as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResult>
}

function requestFor(prospect: Record<string, unknown>) {
  return new Request('https://xphere.app/api/v1/prospects', {
    method: 'POST',
    headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
    body: JSON.stringify({ source: { type: 'xcraper' }, prospects: [prospect] }),
  })
}

function arrangeExistingAccount(existing: Record<string, unknown>, updateError: unknown = null) {
  const apiKey = makeBuilder({
    maybeSingle: { data: { id: 'key-1', org_id: 'org-skale', scopes: ['prospects:write'] }, error: null },
  })
  const runInsert = makeBuilder({ single: { data: { id: 'run-1' }, error: null } })
  const sourceLookup = makeBuilder({ maybeSingle: { data: existing, error: null } })
  const accountUpdate = makeBuilder({ awaited: { data: null, error: updateError } })
  const runClose = makeBuilder()
  const eventInsert = makeBuilder()
  const apiKeyTouch = makeBuilder()
  let prospectSourceCalls = 0
  let accountCalls = 0
  let apiKeyCalls = 0
  const from = vi.fn((table: string) => {
    if (table === 'api_keys') return apiKeyCalls++ === 0 ? apiKey : apiKeyTouch
    if (table === 'prospect_sources') return prospectSourceCalls++ === 0 ? runInsert : runClose
    if (table === 'accounts') return accountCalls++ === 0 ? sourceLookup : accountUpdate
    if (table === 'prospect_engagement_events') return eventInsert
    throw new Error(`unexpected table: ${table}`)
  })
  createServiceRoleClientMock.mockReturnValue({ from })
  return { accountUpdate }
}

beforeEach(() => {
  createServiceRoleClientMock.mockReset()
  markMetaAudiencesDirtyMock.mockClear()
  vi.resetModules()
})

describe('Xcraper company enrichment', () => {
  it('does not merge an unknown provider id into an account with a shared domain', async () => {
    const apiKey = makeBuilder({
      maybeSingle: { data: { id: 'key-1', org_id: 'org-skale', scopes: ['prospects:write'] }, error: null },
    })
    const runInsert = makeBuilder({ single: { data: { id: 'run-1' }, error: null } })
    const sourceLookup = makeBuilder({ maybeSingle: { data: null, error: null } })
    const accountInsert = makeBuilder({ single: { data: { id: 'account-new' }, error: null } })
    const runClose = makeBuilder()
    const eventInsert = makeBuilder()
    const apiKeyTouch = makeBuilder()
    let prospectSourceCalls = 0
    let accountCalls = 0
    let apiKeyCalls = 0
    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeyCalls++ === 0 ? apiKey : apiKeyTouch
      if (table === 'prospect_sources') return prospectSourceCalls++ === 0 ? runInsert : runClose
      if (table === 'accounts') return accountCalls++ === 0 ? sourceLookup : accountInsert
      if (table === 'prospect_engagement_events') return eventInsert
      if (table === 'website_analyses') return makeBuilder()
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/prospects/route')
    const response = await POST(requestFor({
      kind: 'company',
      name: 'Independent Buffalo Barber',
      domain: 'facebook.com',
      source_id: 'google-place-new',
    }))

    expect(response.status).toBe(201)
    expect(accountCalls).toBe(2)
    expect(accountInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Independent Buffalo Barber',
      domain: 'facebook.com',
      source_id: 'google-place-new',
    }))
  })

  it('deep-merges new enrichment and socials without erasing existing values', async () => {
    const { accountUpdate } = arrangeExistingAccount({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: {
        email: 'old@example.com',
        category: 'Barber shop',
        unrelated: 'keep-me',
      },
      source_payload: {
        place_id: 'place-1',
        socials: { facebook: 'https://facebook.com/old', linkedin: 'https://linkedin.com/company/old' },
        untouched: true,
      },
    })

    const { POST } = await import('@/app/api/v1/prospects/route')
    const response = await POST(requestFor({
      kind: 'company',
      name: 'Hudson Barber',
      domain: 'hudsonbarber.com',
      phone: '(978) 555-0100',
      phone_country: 'US',
      source_id: 'place-1',
      custom_fields: {
        email: 'hello@hudsonbarber.com',
        website: 'https://hudsonbarber.com',
        address: '1 Main St, Hudson, MA',
        category: null,
        rating: 4.8,
        review_count: 91,
        google_maps_url: 'https://maps.google.com/place-1',
      },
      source_payload: {
        place_id: 'place-1',
        socials: { facebook: null, instagram: 'https://instagram.com/hudsonbarber' },
      },
    }))

    expect(response.status).toBe(201)
    expect(accountUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'hudsonbarber.com',
      website: 'https://hudsonbarber.com',
      phone: '+19785550100',
      custom_fields: {
        email: 'hello@hudsonbarber.com',
        category: 'Barber shop',
        unrelated: 'keep-me',
        website: 'https://hudsonbarber.com',
        address: '1 Main St, Hudson, MA',
        rating: 4.8,
        review_count: 91,
        google_maps_url: 'https://maps.google.com/place-1',
      },
      source_payload: {
        place_id: 'place-1',
        socials: {
          facebook: 'https://facebook.com/old',
          linkedin: 'https://linkedin.com/company/old',
          instagram: 'https://instagram.com/hudsonbarber',
        },
        untouched: true,
      },
    }))
    expect(markMetaAudiencesDirtyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-skale', sourceType: 'xcraper' }),
    )
  })

  it('does not erase an existing email when the re-import sends null', async () => {
    const { accountUpdate } = arrangeExistingAccount({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: { email: 'existing@example.com' },
      source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')
    await POST(requestFor({
      kind: 'company', name: 'Hudson Barber', source_id: 'place-1', custom_fields: { email: null },
    }))

    expect(accountUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: { email: 'existing@example.com' },
    }))
  })

  it('skips a converted account and neither updates nor marks it dirty', async () => {
    const { accountUpdate } = arrangeExistingAccount({
      id: 'account-1', lifecycle_stage: 'customer', custom_fields: {}, source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')
    const response = await POST(requestFor({
      kind: 'company', name: 'Hudson Barber', source_id: 'place-1', custom_fields: { email: 'new@example.com' },
    }))
    const json = await response.json()

    expect(json.skipped).toBe(1)
    expect(accountUpdate.update).not.toHaveBeenCalled()
    expect(markMetaAudiencesDirtyMock).not.toHaveBeenCalled()
  })

  it('does not mark audiences dirty when the account write fails', async () => {
    arrangeExistingAccount(
      { id: 'account-1', lifecycle_stage: 'prospect', custom_fields: {}, source_payload: {} },
      { message: 'write failed' },
    )
    const { POST } = await import('@/app/api/v1/prospects/route')
    const response = await POST(requestFor({ kind: 'company', name: 'Hudson Barber', source_id: 'place-1' }))
    const json = await response.json()

    expect(json.errors).toBe(1)
    expect(markMetaAudiencesDirtyMock).not.toHaveBeenCalled()
  })
})
