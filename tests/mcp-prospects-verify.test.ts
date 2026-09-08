// tests/mcp-prospects-verify.test.ts
//
// Unit coverage for the prospects_verify MCP tool (Fase 34 — Xphere part):
// input validation (no campaign_id, at least one of external_run_id/
// source_type required, max hard-capped), the external_run_id -> prospect_
// sources -> contacts/accounts.prospect_source_id linkage, credits measured
// as a before/after balance delta, and the best-effort Xmail notification.
//
// Mirrors the mocking style of tests/mcp-prospects-presence.test.ts and
// tests/xmail-external-run-registration.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
}))
const { verifyProspectsBatch } = vi.hoisted(() => ({
  verifyProspectsBatch: vi.fn(),
}))
const { getMillionVerifierCredits } = vi.hoisted(() => ({
  getMillionVerifierCredits: vi.fn(),
}))
const { isXmailConfigured, xmailNotifyVerificationComplete } = vi.hoisted(() => ({
  isXmailConfigured: vi.fn(() => true),
  xmailNotifyVerificationComplete: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/outreach-eligibility', () => ({
  isDndBlocked: vi.fn(() => false),
  loadEmailSuppressions: vi.fn(async () => new Set<string>()),
  normalizeOutreachEmail: vi.fn((value: string | null) => value?.trim().toLowerCase() ?? null),
}))
vi.mock('@/lib/email-verification/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-verification/verify')>()
  return { ...actual, verifyProspectsBatch }
})
vi.mock('@/lib/email-verification/credits', () => ({ getMillionVerifierCredits }))
vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured,
  xmailNotifyVerificationComplete,
  // Unused by prospects_verify but imported by the module.
  xmailBulkImportLeads: vi.fn(),
  xmailListCampaigns: vi.fn(),
  xmailListEmailAccounts: vi.fn(),
  xmailAddLeadsToCampaign: vi.fn(),
  xmailActivateCampaign: vi.fn(),
}))

import { prospectsTools } from '@/lib/mcp/tools/prospects'

/** A chainable Supabase query-builder stub: every filter method is a no-op
 *  that returns itself, and `.then()` resolves with the rows configured for
 *  that table — good enough for testing the tool's own aggregation/shaping
 *  logic without re-implementing Postgres filtering in a mock. */
function makeDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  function makeQuery(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {}
    const chain = () => q
    q.select = vi.fn(chain)
    q.eq = vi.fn(chain)
    q.in = vi.fn(chain)
    q.not = vi.fn(chain)
    q.order = vi.fn(chain)
    q.limit = vi.fn(chain)
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve)
    return q
  }
  return { from: vi.fn((table: string) => makeQuery(table)) }
}

function tool() {
  return prospectsTools.find((candidate) => candidate.name === 'prospects_verify')!
}

describe('prospects_verify input validation', () => {
  it('requires at least one of external_run_id or source_type', () => {
    const result = tool().inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts external_run_id alone', () => {
    expect(tool().inputSchema.safeParse({ external_run_id: 'run-42' }).success).toBe(true)
  })

  it('accepts source_type alone', () => {
    expect(tool().inputSchema.safeParse({ source_type: 'xcraper' }).success).toBe(true)
  })

  it('rejects campaign_id — this tool never enrols', () => {
    const result = tool().inputSchema.safeParse({ external_run_id: 'run-42', campaign_id: 'c1' })
    expect(result.success).toBe(false)
  })

  it('rejects max above the hard cap of 500', () => {
    const result = tool().inputSchema.safeParse({ external_run_id: 'run-42', max: 501 })
    expect(result.success).toBe(false)
  })

  it('accepts max at exactly the hard cap', () => {
    const result = tool().inputSchema.safeParse({ external_run_id: 'run-42', max: 500 })
    expect(result.success).toBe(true)
  })

  it('accepts force:true', () => {
    const result = tool().inputSchema.safeParse({ external_run_id: 'run-42', force: true })
    expect(result.success).toBe(true)
  })
})

describe('prospects_verify handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isXmailConfigured.mockReturnValue(true)
  })

  it('returns external_run_not_found when external_run_id matches no prospect_sources row', async () => {
    createServiceRoleClient.mockReturnValue(makeDb({ prospect_sources: [] }))
    const input = tool().inputSchema.parse({ external_run_id: 'ghost-run' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.error).toBe('external_run_not_found')
    expect(verifyProspectsBatch).not.toHaveBeenCalled()
  })

  it('returns a zero-checked shape and skips credits/verification/Xmail when nothing matches', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({ prospect_sources: [{ id: 'src-1' }], contacts: [], accounts: [] }),
    )
    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result).toMatchObject({ external_run_id: 'run-42', checked: 0, credits_used: null, results: [] })
    expect(getMillionVerifierCredits).not.toHaveBeenCalled()
    expect(verifyProspectsBatch).not.toHaveBeenCalled()
    expect(xmailNotifyVerificationComplete).not.toHaveBeenCalled()
  })

  it('verifies a run, measures credits as a balance delta, and notifies Xmail', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
        accounts: [{ id: 'a1', custom_fields: { email: 'biz@example.com' }, created_at: '2026-01-02T00:00:00.000Z' }],
      }),
    )
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: 253, ok: true })
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: 251, ok: true })
    verifyProspectsBatch.mockImplementation(async (_orgId: string, prospects: Array<{ kind: string; id: string; email: string }>) => ({
      results: prospects.map((p) => ({
        ...p,
        result: {
          status: p.id === 'c1' ? 'ok' : 'catch_all',
          risk: p.id === 'c1' ? 'low' : 'medium',
          provider: 'millionverifier',
          verifiedAt: '2026-09-08T12:00:00.000Z',
          cached: false,
        },
        sendable: true,
      })),
      aggregate: { ok: 1, catch_all: 1, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    }))
    xmailNotifyVerificationComplete.mockResolvedValue({
      ok: true,
      runId: 'xmail-run-1',
      eventId: 'evt-1',
      costEntryId: 'cost-1',
      idempotentReplay: false,
    })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    // verifyProspectsBatch got the resolved prospects, oldest (contact) first,
    // in the resolver's 'contact'/'account' vocabulary, with force defaulted.
    expect(verifyProspectsBatch).toHaveBeenCalledWith(
      'org-1',
      [
        { kind: 'contact', id: 'c1', email: 'alice@example.com' },
        { kind: 'account', id: 'a1', email: 'biz@example.com' },
      ],
      { force: undefined },
    )

    expect(result).toMatchObject({
      external_run_id: 'run-42',
      checked: 2,
      ok: 1,
      catch_all: 1,
      unknown: 0,
      invalid: 0,
      disposable: 0,
      bounced: 0,
      blocked_no_credits: 0,
      credits_used: 2,
      verification_provider: 'millionverifier',
      results: [
        { prospect_id: 'c1', kind: 'person', email: 'alice@example.com', status: 'ok' },
        { prospect_id: 'a1', kind: 'company', email: 'biz@example.com', status: 'catch_all' },
      ],
      xmail_notified: true,
      xmail_run_id: 'xmail-run-1',
      xmail_idempotent_replay: false,
    })
    expect(typeof result.verified_at).toBe('string')
    expect(() => new Date(result.verified_at as string).toISOString()).not.toThrow()

    expect(xmailNotifyVerificationComplete).toHaveBeenCalledWith('run-42', {
      provider: 'xcraper',
      checked: 2,
      ok: 1,
      catchAll: 1,
      unknown: 0,
      invalid: 0,
      creditsUsed: 2,
      verificationProvider: 'millionverifier',
      verifiedAt: result.verified_at,
    })
  })

  it('forwards force:true to verifyProspectsBatch', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
        accounts: [],
      }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 100, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42', force: true })
    await tool().handler(input, { auth: { orgId: 'org-1' } } as never)

    expect(verifyProspectsBatch).toHaveBeenCalledWith('org-1', expect.any(Array), { force: true })
  })

  it('reports credits_used: null when a credits read fails', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
        accounts: [],
      }),
    )
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: 100, ok: true })
    getMillionVerifierCredits.mockResolvedValueOnce({ configured: true, credits: null, ok: false, error: 'timeout' })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.credits_used).toBeNull()
  })

  it('never calls Xmail when only source_type was given (no external_run_id)', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({ contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }], accounts: [] }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 100, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    })

    const input = tool().inputSchema.parse({ source_type: 'xcraper' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.external_run_id).toBeNull()
    expect(xmailNotifyVerificationComplete).not.toHaveBeenCalled()
    expect(result.xmail_notified).toBeUndefined()
  })

  it('reports xmail_notified:false without failing the verification when Xmail is not configured', async () => {
    isXmailConfigured.mockReturnValue(false)
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
        accounts: [],
      }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 100, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.checked).toBe(1)
    expect(result.xmail_notified).toBe(false)
    expect(xmailNotifyVerificationComplete).not.toHaveBeenCalled()
  })

  it('reports xmail_notified:false with the 404 detail when Xmail does not know the run, without failing verification', async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
        accounts: [],
      }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 100, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true }],
      aggregate: { ok: 1, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: false, error: 'Xmail does not know external run "run-42" (404).', runNotFound: true })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.checked).toBe(1)
    expect(result.ok).toBe(1)
    expect(result.xmail_notified).toBe(false)
    expect(result.xmail_error).toMatch(/404/)
  })

  it("labels the provider 'mixed' when the batch used both providers", async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [
          { id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' },
          { id: 'c2', email: 'bob@example.com', created_at: '2026-01-01T00:01:00.000Z' },
        ],
        accounts: [],
      }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 100, ok: true })
    verifyProspectsBatch.mockResolvedValue({
      results: [
        { kind: 'contact', id: 'c1', email: 'alice@example.com', result: { status: 'ok', risk: 'low', provider: 'millionverifier', verifiedAt: 'x', cached: false }, sendable: true },
        { kind: 'contact', id: 'c2', email: 'bob@example.com', result: { status: 'ok', risk: 'low', provider: 'neverbounce', verifiedAt: 'x', cached: false }, sendable: true },
      ],
      aggregate: { ok: 2, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.verification_provider).toBe('mixed')
  })

  it("defaults the provider to 'millionverifier' when every result was blocked (no credits)", async () => {
    createServiceRoleClient.mockReturnValue(
      makeDb({
        prospect_sources: [{ id: 'src-1' }],
        contacts: [{ id: 'c1', email: 'alice@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
        accounts: [],
      }),
    )
    getMillionVerifierCredits.mockResolvedValue({ configured: true, credits: 0, ok: false })
    verifyProspectsBatch.mockResolvedValue({
      results: [{ kind: 'contact', id: 'c1', email: 'alice@example.com', result: { blocked: true, reason: 'no_verification_credits' }, sendable: false }],
      aggregate: { ok: 0, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 1 },
    })
    xmailNotifyVerificationComplete.mockResolvedValue({ ok: true, runId: 'r', eventId: 'e', costEntryId: 'c', idempotentReplay: false })

    const input = tool().inputSchema.parse({ external_run_id: 'run-42' })
    const result = (await tool().handler(input, { auth: { orgId: 'org-1' } } as never)) as Record<string, unknown>

    expect(result.blocked_no_credits).toBe(1)
    expect(result.verification_provider).toBe('millionverifier')
    expect((result.results as Array<Record<string, unknown>>)[0].status).toBe('blocked_no_credits')
  })
})
