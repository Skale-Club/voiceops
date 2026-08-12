import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const getUserMock = vi.fn()
const getRbacContextMock = vi.fn()
const createServiceRoleClientMock = vi.fn(() => ({ service: true }))
const reconcileMetaAudienceMock = vi.fn()
const loadProjectedMembersMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, getUser: getUserMock }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: createServiceRoleClientMock }))
vi.mock('@/lib/rbac/server', () => ({ getRbacContext: getRbacContextMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/meta/audience-provider', () => ({
  OrgOAuthProvider: class OrgOAuthProvider {},
}))
vi.mock('@/lib/meta/audience-reconcile', () => ({
  reconcileMetaAudience: reconcileMetaAudienceMock,
  SupabaseAudienceReconcileStore: class SupabaseAudienceReconcileStore {
    loadProjectedMembers = loadProjectedMembersMock
  },
}))

type QueryResult = { data: unknown; error: unknown }

function builder(results: { maybeSingle?: QueryResult; awaited?: QueryResult } = {}) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'update']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn(async () => results.maybeSingle ?? { data: null, error: null })
  query.then = (resolve: (value: QueryResult) => unknown) =>
    resolve(results.awaited ?? { data: null, error: null })
  return query as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResult>
}

function authClient(from: ReturnType<typeof vi.fn>) {
  return {
    from,
    rpc: vi.fn(async () => ({ data: '11111111-1111-4111-8111-111111111111', error: null })),
  }
}

const CONFIG = {
  id: '22222222-2222-4222-8222-222222222222',
  org_id: '11111111-1111-4111-8111-111111111111',
  ads_connection_id: '33333333-3333-4333-8333-333333333333',
  meta_business_id: null,
  meta_ad_account_id: 'act_123',
  custom_audience_id: null,
  audience_name: 'Skale Club - Xcraper Prospects',
  audience_kind: 'xcraper_master',
  source_definition: { kind: 'xcraper_master', sourceType: 'xcraper' },
  sync_enabled: false,
  terms_accepted_at: null,
  terms_accepted_by: null,
  consent_basis: 'USER_PROVIDED_ONLY',
  operational_status: 'draft',
  dirty_at: null,
  last_synced_at: null,
  last_sync_stats: null,
  last_error_code: null,
  last_error_message: null,
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ id: 'user-1' })
  getRbacContextMock.mockResolvedValue({ role: 'admin', isPlatformAdmin: false })
})

describe('Meta audience operator actions', () => {
  it('rejects unauthenticated mutation before touching the database', async () => {
    getUserMock.mockResolvedValue(null)
    const { saveMetaAudienceConfig } = await import('@/app/(dashboard)/settings/integrations/meta-audience/actions')
    const result = await saveMetaAudienceConfig({
      ads_connection_id: '33333333-3333-4333-8333-333333333333',
      audience_name: 'Test', audience_kind: 'xcraper_master', terms_accepted: false,
    })
    expect(result).toMatchObject({ ok: false, code: 'NOT_AUTHENTICATED' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('creates a master audience from an explicitly org-scoped tenant connection', async () => {
    const connection = builder({ maybeSingle: { data: { id: CONFIG.ads_connection_id, ad_account_id: 'act_123' }, error: null } })
    const insert = builder()
    const from = vi.fn((table: string) => {
      if (table === 'ads_connections') return connection
      if (table === 'meta_audience_config') return insert
      throw new Error(`unexpected table ${table}`)
    })
    createClientMock.mockResolvedValue(authClient(from))
    const { saveMetaAudienceConfig } = await import('@/app/(dashboard)/settings/integrations/meta-audience/actions')
    const result = await saveMetaAudienceConfig({
      ads_connection_id: CONFIG.ads_connection_id,
      audience_name: CONFIG.audience_name,
      audience_kind: 'xcraper_master',
      terms_accepted: true,
    })

    expect(result).toEqual({ ok: true })
    expect(connection.eq).toHaveBeenCalledWith('org_id', CONFIG.org_id)
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: CONFIG.org_id,
      ads_connection_id: CONFIG.ads_connection_id,
      meta_ad_account_id: 'act_123',
      source_definition: { kind: 'xcraper_master', sourceType: 'xcraper' },
      terms_accepted_by: 'user-1',
      sync_enabled: false,
    }))
  })

  it('creates a second audience from an explicitly scoped saved prospect segment', async () => {
    const segmentId = '44444444-4444-4444-8444-444444444444'
    const connection = builder({ maybeSingle: { data: { id: CONFIG.ads_connection_id, ad_account_id: 'act_123' }, error: null } })
    const segment = builder({
      maybeSingle: {
        data: { id: segmentId, definition: { entityKeys: ['account:55555555-5555-4555-8555-555555555555'] } },
        error: null,
      },
    })
    const insert = builder()
    const from = vi.fn((table: string) => {
      if (table === 'ads_connections') return connection
      if (table === 'prospect_audiences') return segment
      if (table === 'meta_audience_config') return insert
      throw new Error(`unexpected table ${table}`)
    })
    createClientMock.mockResolvedValue(authClient(from))
    const { saveMetaAudienceConfig } = await import('@/app/(dashboard)/settings/integrations/meta-audience/actions')
    const result = await saveMetaAudienceConfig({
      ads_connection_id: CONFIG.ads_connection_id,
      audience_name: 'Hudson barbershops',
      audience_kind: 'prospect_segment',
      saved_segment_id: segmentId,
      terms_accepted: true,
    })

    expect(result).toEqual({ ok: true })
    expect(segment.eq).toHaveBeenCalledWith('org_id', CONFIG.org_id)
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: CONFIG.org_id,
      audience_kind: 'prospect_segment',
      source_definition: {
        kind: 'prospect_segment',
        prospectAudienceId: segmentId,
        entityKeys: ['account:55555555-5555-4555-8555-555555555555'],
      },
    }))
  })

  it('rejects a missing or wrong-org connection without creating config', async () => {
    const connection = builder({ maybeSingle: { data: null, error: null } })
    const from = vi.fn(() => connection)
    createClientMock.mockResolvedValue(authClient(from))
    const { saveMetaAudienceConfig } = await import('@/app/(dashboard)/settings/integrations/meta-audience/actions')
    const result = await saveMetaAudienceConfig({
      ads_connection_id: CONFIG.ads_connection_id,
      audience_name: 'Wrong org', audience_kind: 'xcraper_master', terms_accepted: false,
    })
    expect(result).toMatchObject({ ok: false, code: 'CONNECTION_NOT_FOUND' })
    expect(connection.eq).toHaveBeenCalledWith('org_id', CONFIG.org_id)
    expect(connection.insert).not.toHaveBeenCalled()
  })

  it('returns a count-only preview without identifiers, hashes, or tokens', async () => {
    const config = builder({ maybeSingle: { data: CONFIG, error: null } })
    createClientMock.mockResolvedValue(authClient(vi.fn(() => config)))
    loadProjectedMembersMock.mockResolvedValue({
      members: [
        { entityType: 'account', entityId: 'secret-id', emailHash: 'a'.repeat(64), phoneHash: null },
        { entityType: 'contact', entityId: 'secret-id-2', emailHash: null, phoneHash: 'b'.repeat(64) },
      ],
      suppressedCount: 3,
      invalidCount: 2,
    })
    const { previewMetaAudience } = await import('@/app/(dashboard)/settings/integrations/meta-audience/actions')
    const result = await previewMetaAudience(CONFIG.id)
    expect(result).toEqual({
      ok: true,
      preview: { entities: 2, emails: 1, phones: 1, suppressed: 3, invalid: 2, scope: 'Xcraper prospects' },
    })
    expect(JSON.stringify(result)).not.toContain('secret-id')
    expect(JSON.stringify(result)).not.toContain('a'.repeat(64))
  })

  it('blocks enablement for an expired tenant token before any update or Meta call', async () => {
    const config = builder({ maybeSingle: { data: { ...CONFIG, terms_accepted_at: '2026-08-01', terms_accepted_by: 'user-1' }, error: null } })
    const expired = builder({
      maybeSingle: {
        data: { id: CONFIG.ads_connection_id, status: 'active', ad_account_id: 'act_123', token_expires_at: '2026-08-09T00:00:00Z' },
        error: null,
      },
    })
    let calls = 0
    const from = vi.fn(() => calls++ === 0 ? config : expired)
    createClientMock.mockResolvedValue(authClient(from))
    const { toggleMetaAudienceSync } = await import('@/app/(dashboard)/settings/integrations/meta-audience/actions')
    const result = await toggleMetaAudienceSync(CONFIG.id, true)
    expect(result).toMatchObject({ ok: false, code: 'CONNECTION_EXPIRED' })
    expect(reconcileMetaAudienceMock).not.toHaveBeenCalled()
    expect(expired.update).not.toHaveBeenCalled()
  })
})
