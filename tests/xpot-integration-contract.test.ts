// Contract tests for the Xpot ↔ Xphere sync boundary.
//
// Xpot (server/routes/xpot/helpers.ts: syncLeadToXphere, syncVisitToXphere)
// calls these two endpoints fire-and-forget on lead creation and visit
// check-out. Both sides evolve independently across repos, so a payload or
// response-shape drift here fails silently in production (see
// sales_sync_events). These tests pin the exact request/response contract
// each handler must keep honoring.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceRoleClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}))

// Audience reconciliation has its own route-level coverage. Keep this file
// focused on the Xpot payload contract and independent of audience tables.
vi.mock('@/lib/meta/audience-dirty', () => ({
  markMetaAudiencesDirty: vi.fn(async () => ({ marked: 0 })),
}))

type QueryResult = { data: unknown; error: unknown }

function makeQueryBuilder(overrides: {
  maybeSingleResult?: QueryResult
  singleResult?: QueryResult
  thenResult?: QueryResult
} = {}) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.neq = vi.fn(() => builder)
  builder.is = vi.fn(() => builder)
  builder.ilike = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.in = vi.fn(() => builder)
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => overrides.maybeSingleResult ?? { data: null, error: null })
  builder.single = vi.fn(async () => overrides.singleResult ?? { data: null, error: null })
  // Real supabase-js query builders are themselves thenable — several call
  // sites (`.update(...).eq(...)`, `.insert(...)` alone) await the builder
  // directly without a terminal .single()/.maybeSingle().
  builder.then = (onFulfilled: (result: QueryResult) => unknown) =>
    onFulfilled(overrides.thenResult ?? { data: null, error: null })
  return builder as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    neq: ReturnType<typeof vi.fn>
    is: ReturnType<typeof vi.fn>
    ilike: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
  }
}

function makeApiKeyBuilder(key: { id: string; org_id: string; scopes: string[] } | null) {
  return makeQueryBuilder({ maybeSingleResult: { data: key, error: null } })
}

const VALID_KEY = { id: 'key-1', org_id: 'org-1', scopes: ['contacts:write'] }

beforeEach(() => {
  createServiceRoleClientMock.mockReset()
  vi.resetModules()
})

describe('POST /api/v1/contacts — xpot lead sync target', () => {
  it('rejects a request without a valid Bearer token', async () => {
    createServiceRoleClientMock.mockReturnValue({ from: vi.fn(() => makeApiKeyBuilder(null)) })
    const { POST } = await import('@/app/api/v1/contacts/route')

    const res = await POST(
      new Request('https://xphere.app/api/v1/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Jane' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('rejects a key missing the contacts:write scope', async () => {
    createServiceRoleClientMock.mockReturnValue({
      from: vi.fn(() => makeApiKeyBuilder({ id: 'key-1', org_id: 'org-1', scopes: ['leads:write'] })),
    })
    const { POST } = await import('@/app/api/v1/contacts/route')

    const res = await POST(
      new Request('https://xphere.app/api/v1/contacts', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Jane' }),
      }),
    )

    expect(res.status).toBe(403)
  })

  it('creates a contact from the exact payload Xpot sends on lead creation, and returns { id, action }', async () => {
    const apiKeysBuilder = makeApiKeyBuilder(VALID_KEY)
    const phoneLookup = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } })
    const emailLookup = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } })
    const insertBuilder = makeQueryBuilder({ singleResult: { data: { id: 'contact-new-1' }, error: null } })
    const contactsBuilders = [phoneLookup, emailLookup, insertBuilder]
    let contactsCall = 0

    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeysBuilder
      if (table === 'contacts') return contactsBuilders[contactsCall++]
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/contacts/route')

    // Mirrors server/routes/xpot/helpers.ts syncLeadToXphere() exactly.
    const res = await POST(
      new Request('https://xphere.app/api/v1/contacts', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Prospect',
          email: 'jane.prospect@acmeroofing.com',
          phone: '+1 (305) 555-0100',
          company: 'Acme Roofing LLC',
          source_label: 'xpot',
        }),
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toEqual({ id: 'contact-new-1', action: 'created' })
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        name: 'Jane Prospect',
        phone: '+13055550100',
        email: 'jane.prospect@acmeroofing.com',
        company: 'Acme Roofing LLC',
        source: 'api',
        custom_fields: { _api_source: 'xpot' },
      }),
    )
  })

  it('updates the existing contact (dedup by phone) and returns action: updated with a 200', async () => {
    const apiKeysBuilder = makeApiKeyBuilder(VALID_KEY)
    const phoneLookup = makeQueryBuilder({ maybeSingleResult: { data: { id: 'contact-existing-1' }, error: null } })
    const updateBuilder = makeQueryBuilder({ thenResult: { data: null, error: null } })
    const contactsBuilders = [phoneLookup, updateBuilder]
    let contactsCall = 0

    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeysBuilder
      if (table === 'contacts') return contactsBuilders[contactsCall++]
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/contacts/route')

    const res = await POST(
      new Request('https://xphere.app/api/v1/contacts', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Prospect',
          phone: '+1 (305) 555-0100',
          source_label: 'xpot',
        }),
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ id: 'contact-existing-1', action: 'updated' })
    expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Prospect' }))
  })
})

describe('POST /api/integrations/xpot/visits — xpot visit sync target', () => {
  it('rejects a request without a valid API key', async () => {
    createServiceRoleClientMock.mockReturnValue({ from: vi.fn(() => makeApiKeyBuilder(null)) })
    const { POST } = await import('@/app/api/integrations/xpot/visits/route')

    const res = await POST(
      new Request('https://xphere.app/api/integrations/xpot/visits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ xphere_id: 'contact-1', xphere_kind: 'contact' }),
      }),
    )

    expect(res.status).toBe(401)
  })

  it('resolves the entity via xphere_id/xphere_kind, logs the visit, and stamps last_visit_at', async () => {
    const apiKeysBuilder = makeApiKeyBuilder({ id: 'key-1', org_id: 'org-1', scopes: [] })
    const entityLookup = makeQueryBuilder({ maybeSingleResult: { data: { id: 'contact-1' }, error: null } })
    const eventInsert = makeQueryBuilder({ thenResult: { data: null, error: null } })
    const contactUpdate = makeQueryBuilder({ thenResult: { data: null, error: null } })

    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeysBuilder
      if (table === 'contacts') return entityLookup
      if (table === 'prospect_engagement_events') return eventInsert
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/integrations/xpot/visits/route')

    // Mirrors server/routes/xpot/helpers.ts syncVisitToXphere() exactly —
    // note the composite lead.xphereRef ("contact:{id}") is split into
    // xphere_id/xphere_kind before this request leaves Xpot.
    const res = await POST(
      new Request('https://xphere.app/api/integrations/xpot/visits', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          xphere_id: 'contact-1',
          xphere_kind: 'contact',
          outcome: 'interested',
          summary: 'Owner asked for a follow-up quote next week.',
          sentiment: 'positive',
          occurred_at: '2026-07-01T18:30:00.000Z',
        }),
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(eventInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        entity_type: 'contact',
        entity_id: 'contact-1',
        event_type: 'visit',
        source_platform: 'xpot',
        payload: { outcome: 'interested', summary: 'Owner asked for a follow-up quote next week.', sentiment: 'positive' },
      }),
    )
  })

  it('returns ok:true with ignored:no_match when the referenced entity cannot be resolved', async () => {
    const apiKeysBuilder = makeApiKeyBuilder({ id: 'key-1', org_id: 'org-1', scopes: [] })
    const entityLookup = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } })

    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeysBuilder
      if (table === 'contacts') return entityLookup
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/integrations/xpot/visits/route')

    const res = await POST(
      new Request('https://xphere.app/api/integrations/xpot/visits', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({ xphere_id: 'contact-unknown', xphere_kind: 'contact' }),
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, ignored: 'no_match' })
  })
})

describe('POST /api/v1/prospects — xpot lead sync target (company-kind)', () => {
  // A sales_lead in Xpot is a business (legalName/industry, no personal name),
  // so syncLeadToXphere() sends kind: 'company'. Accounts have no first-class
  // email column, so the lead's email/legalName/industry ride in
  // custom_fields — which /api/v1/prospects persists verbatim on create. This
  // pins that behavior so no one has to rediscover it by reading both repos.

  it('rejects a key without the prospects:write scope', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return makeApiKeyBuilder({ id: 'key-1', org_id: 'org-1', scopes: ['contacts:write'] })
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/prospects/route')
    const res = await POST(
      new Request('https://xphere.app/api/v1/prospects', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({ source: { type: 'xpot' }, prospects: [{ kind: 'company', name: 'Acme Roofing' }] }),
      }),
    )

    expect(res.status).toBe(403)
  })

  it('creates a company prospect from the exact batch payload syncLeadToXphere sends, persisting email/legalName/industry via custom_fields', async () => {
    const apiKeysBuilder = makeApiKeyBuilder({ id: 'key-1', org_id: 'org-1', scopes: ['prospects:write'] })
    const sourceRunInsert = makeQueryBuilder({ singleResult: { data: { id: 'run-1' }, error: null } })
    const sourceIdLookup = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } })
    const nameLookup = makeQueryBuilder({ maybeSingleResult: { data: null, error: null } })
    const accountInsert = makeQueryBuilder({ singleResult: { data: { id: 'account-new-1' }, error: null } })
    const accountsCalls = [sourceIdLookup, nameLookup, accountInsert]
    let accountsCall = 0
    const eventInsert = makeQueryBuilder()

    const from = vi.fn((table: string) => {
      if (table === 'api_keys') return apiKeysBuilder
      if (table === 'prospect_sources') return sourceRunInsert
      if (table === 'accounts') return accountsCalls[accountsCall++]
      if (table === 'prospect_engagement_events') return eventInsert
      throw new Error(`unexpected table: ${table}`)
    })
    createServiceRoleClientMock.mockReturnValue({ from })

    const { POST } = await import('@/app/api/v1/prospects/route')

    // Mirrors server/routes/xpot/helpers.ts syncLeadToXphere() exactly.
    const res = await POST(
      new Request('https://xphere.app/api/v1/prospects', {
        method: 'POST',
        headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
        body: JSON.stringify({
          source: { type: 'xpot' },
          prospects: [
            {
              kind: 'company',
              name: 'Acme Roofing',
              phone: '+1 (305) 555-0100',
              source_id: '3',
              custom_fields: { email: 'jane@acmeroofing.com', legal_name: 'Acme Roofing LLC', industry: 'Roofing' },
            },
          ],
        }),
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toEqual({
      source_id: 'run-1',
      total: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      errors: 0,
      results: [{ id: 'account-new-1', kind: 'company', action: 'created' }],
    })
    expect(accountInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        name: 'Acme Roofing',
        phone: '+13055550100',
        lifecycle_stage: 'prospect',
        source_type: 'xpot',
        source_id: '3',
        custom_fields: { email: 'jane@acmeroofing.com', legal_name: 'Acme Roofing LLC', industry: 'Roofing' },
      }),
    )
  })
})
