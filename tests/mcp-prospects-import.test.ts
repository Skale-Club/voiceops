// tests/mcp-prospects-import.test.ts
//
// Unit coverage for the prospects_import_to_xmail MCP tool (Fase 37 — Xphere
// half): stages verified prospects as Xmail leads WITHOUT enrolling them in
// any campaign. Real evidence (2026-09-08): three production runs verified 80
// sendable addresses (69 ok, 9 catch_all, 2 unknown) and none reached Xmail,
// because the only import path was prospects_enroll_in_campaign's
// confirmed:true, which also enrols and can activate sending.
//
// Covers: dry run imports nothing and reports counts; confirmed imports only
// email_status='ok'; catch_all/unknown/unverified/invalid are held back and
// counted, never silently dropped; already-imported prospects are skipped on
// a repeat call; customFields carries source_run_id and the web-presence /
// booking fields. Mirrors the mocking style of tests/mcp-prospects-verify.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
}))
const { isXmailConfigured, xmailBulkImportLeads } = vi.hoisted(() => ({
  isXmailConfigured: vi.fn(() => true),
  xmailBulkImportLeads: vi.fn(),
}))
const { loadWebsiteInsightsForAccounts } = vi.hoisted(() => ({
  loadWebsiteInsightsForAccounts: vi.fn(async () => new Map()),
}))
const { loadSourceRunIdsForEntities } = vi.hoisted(() => ({
  loadSourceRunIdsForEntities: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/outreach-eligibility', () => ({
  isDndBlocked: vi.fn(() => false),
  loadEmailSuppressions: vi.fn(async () => new Set<string>()),
  normalizeOutreachEmail: vi.fn((value: string | null) => value?.trim().toLowerCase() ?? null),
}))
vi.mock('@/lib/email-verification/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-verification/verify')>()
  return { ...actual, verifyProspectsBatch: vi.fn() }
})
vi.mock('@/lib/xmail/website-insights', () => ({ loadWebsiteInsightsForAccounts }))
vi.mock('@/lib/xmail/source-runs', () => ({ loadSourceRunIdsForEntities }))
vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured,
  xmailBulkImportLeads,
  // Unused by prospects_import_to_xmail but imported by the module.
  xmailListCampaigns: vi.fn(),
  xmailListEmailAccounts: vi.fn(),
  xmailAddLeadsToCampaign: vi.fn(),
  xmailActivateCampaign: vi.fn(),
  xmailNotifyVerificationComplete: vi.fn(),
}))

import { prospectsTools } from '@/lib/mcp/tools/prospects'

/** A chainable Supabase query-builder stub good enough for resolveProspects'
 *  own filtering/aggregation logic: every filter method is a no-op that
 *  returns itself, `.then()` resolves with the rows configured for that
 *  table, and `.update(data).in(col, ids)` records the write instead of
 *  re-running it as a read (mirrors makeDb in tests/mcp-prospects-verify.test.ts,
 *  extended with `.update()` capture for the xmail_imported_at stamp). */
function makeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  const updateCalls: Array<{ table: string; data: Record<string, unknown>; ids: unknown[] }> = []

  function makeQuery(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {}
    const chain = () => q
    let pendingUpdate: Record<string, unknown> | undefined
    q.select = vi.fn(chain)
    q.eq = vi.fn(chain)
    q.gte = vi.fn(chain)
    q.lte = vi.fn(chain)
    q.not = vi.fn(chain)
    q.contains = vi.fn(chain)
    q.ilike = vi.fn(chain)
    q.limit = vi.fn(chain)
    q.order = vi.fn(chain)
    q.update = vi.fn((data: Record<string, unknown>) => {
      pendingUpdate = data
      return q
    })
    q.in = vi.fn((_col: string, ids: unknown[]) => {
      if (pendingUpdate) {
        updateCalls.push({ table, data: pendingUpdate, ids })
        pendingUpdate = undefined
        return Promise.resolve({ data: null, error: null })
      }
      return chain()
    })
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve)
    return q
  }

  return { from: vi.fn((table: string) => makeQuery(table)), updateCalls }
}

function tool() {
  return prospectsTools.find((candidate) => candidate.name === 'prospects_import_to_xmail')!
}

function contact(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'c-default',
    first_name: 'Ada',
    last_name: 'Lovelace',
    name: null,
    email: 'ada@example.com',
    phone: null,
    custom_fields: {},
    score: 50,
    source_type: 'xcraper',
    engagement_status: 'not_contacted',
    dnd_enabled: false,
    dnd_channels: [],
    email_status: null,
    email_verified_at: null,
    email_verification_provider: null,
    email_risk: null,
    xmail_imported_at: null,
    ...overrides,
  }
}

describe('prospects_import_to_xmail input validation', () => {
  it('requires at least one of external_run_id or source_type', () => {
    expect(tool().inputSchema.safeParse({}).success).toBe(false)
  })

  it('accepts external_run_id alone', () => {
    expect(tool().inputSchema.safeParse({ external_run_id: 'run-1' }).success).toBe(true)
  })

  it('accepts source_type alone', () => {
    expect(tool().inputSchema.safeParse({ source_type: 'xcraper' }).success).toBe(true)
  })

  it('rejects max above the hard cap of 300', () => {
    expect(tool().inputSchema.safeParse({ external_run_id: 'run-1', max: 301 }).success).toBe(false)
  })

  it('accepts max at exactly the hard cap', () => {
    expect(tool().inputSchema.safeParse({ external_run_id: 'run-1', max: 300 }).success).toBe(true)
  })

  it('accepts confirmed:true', () => {
    expect(tool().inputSchema.safeParse({ external_run_id: 'run-1', confirmed: true }).success).toBe(true)
  })
})

describe('prospects_import_to_xmail handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-1'] })
  })

  it('returns external_run_not_found when external_run_id matches no prospect_sources row', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ prospect_sources: [] }))
    const input = tool().inputSchema.parse({ external_run_id: 'ghost-run' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBe('external_run_not_found')
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
  })

  it('dry run (confirmed omitted) imports nothing and reports matched/importable/held_back counts', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [
        contact({ id: 'c-ok', email: 'ok@example.com', email_status: 'ok' }),
        contact({ id: 'c-catchall', email: 'catchall@example.com', email_status: 'catch_all' }),
        contact({ id: 'c-unknown', email: 'unknown@example.com', email_status: 'unknown' }),
        contact({ id: 'c-unverified', email: 'unverified@example.com', email_status: null }),
      ],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)

    const input = tool().inputSchema.parse({ external_run_id: 'run-1' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result).toMatchObject({
      dry_run: true,
      matched: 4,
      would_import: 1,
      importable: 1,
      already_imported: 0,
      held_back: { catch_all: 1, unknown: 1, unverified: 1, invalid: 0 },
    })
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
    expect(db.updateCalls).toHaveLength(0)
    expect(result.message).toMatch(/nothing was imported/i)
  })

  it('confirmed:true imports only email_status="ok" and stamps xmail_imported_at on those rows', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [
        contact({ id: 'c-ok', email: 'ok@example.com', email_status: 'ok' }),
        contact({ id: 'c-catchall', email: 'catchall@example.com', email_status: 'catch_all' }),
        contact({ id: 'c-invalid', email: 'invalid@example.com', email_status: 'invalid' }),
      ],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-ok'] })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(xmailBulkImportLeads).toHaveBeenCalledTimes(1)
    const leads = xmailBulkImportLeads.mock.calls[0][0] as Array<{ email: string }>
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('ok@example.com')

    expect(result).toMatchObject({
      imported: 1,
      importable: 1,
      held_back: { catch_all: 1, unknown: 0, unverified: 0, invalid: 1 },
    })
    expect(result.dry_run).toBeUndefined()

    expect(db.updateCalls).toHaveLength(1)
    expect(db.updateCalls[0].table).toBe('contacts')
    expect(db.updateCalls[0].ids).toEqual(['c-ok'])
    expect(typeof db.updateCalls[0].data.xmail_imported_at).toBe('string')
  })

  it('never calls Xmail and never updates the DB when nothing is importable (all held back)', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [
        contact({ id: 'c-catchall', email: 'catchall@example.com', email_status: 'catch_all' }),
        contact({ id: 'c-unverified', email: 'unverified@example.com', email_status: null }),
      ],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.imported).toBe(0)
    expect(result.held_back).toEqual({ catch_all: 1, unknown: 0, unverified: 1, invalid: 0 })
    expect(xmailBulkImportLeads).not.toHaveBeenCalled()
    expect(db.updateCalls).toHaveLength(0)
  })

  it('skips already-imported prospects on a repeat call (idempotency via xmail_imported_at)', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [
        // Simulates the state after a prior successful import call.
        contact({ id: 'c-ok-already', email: 'already@example.com', email_status: 'ok', xmail_imported_at: '2026-09-08T00:00:00.000Z' }),
        contact({ id: 'c-ok-new', email: 'new@example.com', email_status: 'ok' }),
      ],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-new'] })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.already_imported).toBe(1)
    expect(result.importable).toBe(1)
    expect(xmailBulkImportLeads).toHaveBeenCalledTimes(1)
    const leads = xmailBulkImportLeads.mock.calls[0][0] as Array<{ email: string }>
    expect(leads).toHaveLength(1)
    expect(leads[0].email).toBe('new@example.com')
    expect(db.updateCalls[0].ids).toEqual(['c-ok-new'])
  })

  it('carries source_run_id and the web-presence/booking fields in customFields for a company', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [],
      accounts: [
        {
          id: 'acct-1',
          name: 'Buffalo Cuts',
          domain: null,
          website: null,
          phone: '+17165550123',
          address: null,
          score: 74,
          source_type: 'xcraper',
          engagement_status: 'not_contacted',
          custom_fields: {
            email: 'hello@buffalocuts.example',
            has_owned_website: false,
            web_presence_type: 'booking_platform',
            booking_platform: 'Booksy',
            booking_url: 'https://booksy.com/buffalo-cuts',
          },
          email_status: 'ok',
          email_verified_at: '2026-09-01T00:00:00.000Z',
          email_verification_provider: 'millionverifier',
          email_risk: 'low',
          xmail_imported_at: null,
        },
      ],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-acct-1'] })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    await tool().handler(input, { auth: { orgId: 'org-1' } } as never)

    expect(xmailBulkImportLeads).toHaveBeenCalledTimes(1)
    const leads = xmailBulkImportLeads.mock.calls[0][0] as Array<{ customFields?: Record<string, unknown> }>
    expect(leads[0].customFields).toMatchObject({
      source_run_id: 'run-1',
      has_owned_website: false,
      web_presence_type: 'booking_platform',
      booking_platform: 'Booksy',
      booking_url: 'https://booksy.com/buffalo-cuts',
    })
    expect(loadSourceRunIdsForEntities).not.toHaveBeenCalled()
  })

  it('resolves source_run_id per-prospect via loadSourceRunIdsForEntities when filtering by source_type alone', async () => {
    loadSourceRunIdsForEntities.mockResolvedValue(new Map([['c-ok', 'resolved-run-9']]))
    const db = makeDb({
      contacts: [contact({ id: 'c-ok', email: 'ok@example.com', email_status: 'ok' })],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({ ok: true, imported: 1, leadIds: ['lead-1'] })

    const input = tool().inputSchema.parse({ source_type: 'xcraper', confirmed: true })
    await tool().handler(input, { auth: { orgId: 'org-1' } } as never)

    expect(loadSourceRunIdsForEntities).toHaveBeenCalledWith(expect.anything(), 'org-1', ['c-ok'])
    const leads = xmailBulkImportLeads.mock.calls[0][0] as Array<{ customFields?: Record<string, unknown> }>
    expect(leads[0].customFields?.source_run_id).toBe('resolved-run-9')
  })

  it('has no campaign_id field — enrolment is structurally impossible to request through this tool', () => {
    const result = tool().inputSchema.safeParse({ external_run_id: 'run-1', campaign_id: '11111111-1111-1111-1111-111111111111' })
    expect(result.success).toBe(false)
  })

  it('reports an error and does not mark rows imported when the Xmail bulk-import call fails', async () => {
    const db = makeDb({
      prospect_sources: [{ id: 'src-1' }],
      contacts: [contact({ id: 'c-ok', email: 'ok@example.com', email_status: 'ok' })],
      accounts: [],
    })
    createServiceRoleClient.mockReturnValue(db)
    xmailBulkImportLeads.mockResolvedValue({ ok: false, error: 'Xmail unreachable' })

    const input = tool().inputSchema.parse({ external_run_id: 'run-1', confirmed: true })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toMatch(/Xmail unreachable/)
    expect(db.updateCalls).toHaveLength(0)
  })
})
