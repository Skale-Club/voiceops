import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Everything below the route boundary is stubbed so the test exercises the
// route's own decisions: permission gate, budget ceiling, currency conversion,
// and whether an audit record is written.

const canMock = vi.fn()
const getUserMock = vi.fn()
const recordMutationMock = vi.fn()
const updateStatusMock = vi.fn()
const updateBudgetMock = vi.fn()
const getCampaignMock = vi.fn()
const getAccountInfoMock = vi.fn()
const invalidateMock = vi.fn()

const connectionRow = { encrypted_access_token: 'encrypted' }
let connectionResult: { data: typeof connectionRow | null } = { data: connectionRow }

vi.mock('@/lib/rbac/server', () => ({ can: (key: string) => canMock(key) }))

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUserMock(),
  createClient: async () => ({
    rpc: async () => ({ data: 'org-1' }),
    from: () => {
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) builder[m] = vi.fn(() => builder)
      builder.maybeSingle = async () => connectionResult
      return builder
    },
  }),
}))

vi.mock('@/lib/crypto', () => ({ decrypt: async () => 'plaintext-token' }))

vi.mock('@/lib/ads/journey-db', () => ({
  recordMutationExecution: (args: unknown) => recordMutationMock(args),
}))

vi.mock('@/lib/ads/cache', () => ({
  invalidateAccountReports: (...args: unknown[]) => invalidateMock(...args),
  cachedReport: async (_k: unknown, f: () => unknown) => f(),
  ADS_CACHE_TTL_SECONDS: 120,
  ADS_CACHE_TTL_HISTORICAL_SECONDS: 900,
}))

vi.mock('@/lib/ads/connection-health', () => ({
  withConnectionHealth: async (_p: unknown, op: () => Promise<unknown>) => op(),
}))

vi.mock('@/lib/api-error', () => ({ captureApiError: vi.fn() }))

vi.mock('@/lib/ads/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/meta-api')>('@/lib/ads/meta-api')
  return {
    ...actual,
    updateCampaignStatus: (...a: unknown[]) => updateStatusMock(...a),
    updateCampaignDailyBudget: (...a: unknown[]) => updateBudgetMock(...a),
    getCampaign: (...a: unknown[]) => getCampaignMock(...a),
    getAdAccountInfo: (...a: unknown[]) => getAccountInfoMock(...a),
  }
})

import { POST } from '@/app/api/ads/meta/campaigns/route'

function request(body: unknown): Request {
  return new Request('https://xphere.app/api/ads/meta/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_STATUS_BODY = {
  action: 'set_status',
  campaign_id: '120200000000000',
  ad_account_id: 'act_123456789',
  status: 'PAUSED',
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionResult = { data: connectionRow }
  getUserMock.mockResolvedValue({ id: 'user-1' })
  canMock.mockResolvedValue(true)
  updateStatusMock.mockResolvedValue({ success: true })
  updateBudgetMock.mockResolvedValue({ success: true })
  getCampaignMock.mockResolvedValue({
    id: '120200000000000',
    name: 'Prospecting BR',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    daily_budget: '5000',
  })
  getAccountInfoMock.mockResolvedValue({ id: 'act_123456789', name: 'Acme BR', currency: 'BRL', account_status: 1 })
  delete process.env.ADS_MAX_DAILY_BUDGET
})

describe('Meta campaign mutations — access control', () => {
  it('rejects an unauthenticated caller', async () => {
    getUserMock.mockResolvedValue(null)
    const res = await POST(request(VALID_STATUS_BODY) as never)
    expect(res.status).toBe(401)
    expect(updateStatusMock).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user without ads.manage', async () => {
    // Reading performance and moving money are different privileges; before
    // this gate any org member could pause a campaign.
    canMock.mockResolvedValue(false)
    const res = await POST(request(VALID_STATUS_BODY) as never)
    expect(res.status).toBe(403)
    expect(updateStatusMock).not.toHaveBeenCalled()
  })

  it('checks the ads.manage permission specifically', async () => {
    await POST(request(VALID_STATUS_BODY) as never)
    expect(canMock).toHaveBeenCalledWith('ads.manage')
  })
})

describe('Meta campaign mutations — input validation', () => {
  it('rejects a malformed ad account id', async () => {
    const res = await POST(request({ ...VALID_STATUS_BODY, ad_account_id: '123456789' }) as never)
    expect(res.status).toBe(400)
    expect(updateStatusMock).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric campaign id', async () => {
    const res = await POST(request({ ...VALID_STATUS_BODY, campaign_id: "1' OR '1'='1" }) as never)
    expect(res.status).toBe(400)
  })

  it('rejects a budget request with neither budget field', async () => {
    const res = await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
    }) as never)
    expect(res.status).toBe(400)
    expect(updateBudgetMock).not.toHaveBeenCalled()
  })

  it('404s when the org has no active connection for the account', async () => {
    connectionResult = { data: null }
    const res = await POST(request(VALID_STATUS_BODY) as never)
    expect(res.status).toBe(404)
  })
})

describe('Meta campaign mutations — budget ceiling', () => {
  it('refuses a budget above the ceiling', async () => {
    // An extra zero should fail loudly, not become tomorrow's spend.
    const res = await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget: 250_000,
    }) as never)

    expect(res.status).toBe(422)
    expect(updateBudgetMock).not.toHaveBeenCalled()
  })

  it('honours a deployment-specific ceiling', async () => {
    process.env.ADS_MAX_DAILY_BUDGET = '100'
    const res = await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget: 500,
    }) as never)

    expect(res.status).toBe(422)
    expect(updateBudgetMock).not.toHaveBeenCalled()
  })

  it('allows a budget within the ceiling', async () => {
    const res = await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget: 80,
    }) as never)

    expect(res.status).toBe(200)
    expect(updateBudgetMock).toHaveBeenCalled()
  })
})

describe('Meta campaign mutations — currency handling', () => {
  it('converts major units using the account currency', async () => {
    await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget: 80,
    }) as never)

    // BRL has 100 minor units per major unit.
    expect(updateBudgetMock).toHaveBeenCalledWith('120200000000000', 8000, 'plaintext-token')
  })

  it('passes legacy cents through unchanged', async () => {
    await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget_cents: 7500,
    }) as never)

    expect(updateBudgetMock).toHaveBeenCalledWith('120200000000000', 7500, 'plaintext-token')
  })

  it('does not label a BRL budget with a dollar sign', async () => {
    await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget: 80,
    }) as never)

    const audit = recordMutationMock.mock.calls[0][0]
    expect(audit.afterValue).toContain('R$')
    expect(audit.afterValue).not.toMatch(/^\$/)
  })
})

describe('Meta campaign mutations — audit trail', () => {
  it('records a pause with the before and after status', async () => {
    // recordMutationExecution existed but was never called: pauses and budget
    // changes made from the dashboard left no trace whatsoever.
    await POST(request(VALID_STATUS_BODY) as never)

    expect(recordMutationMock).toHaveBeenCalledTimes(1)
    const audit = recordMutationMock.mock.calls[0][0]
    expect(audit).toMatchObject({
      orgId: 'org-1',
      platform: 'meta',
      toolName: 'pause_campaign',
      campaignId: '120200000000000',
      campaignName: 'Prospecting BR',
      beforeValue: 'ACTIVE',
      afterValue: 'PAUSED',
      executedByAi: false,
      actorId: 'user-1',
    })
  })

  it('records an enable as its own action', async () => {
    await POST(request({ ...VALID_STATUS_BODY, status: 'ACTIVE' }) as never)
    expect(recordMutationMock.mock.calls[0][0].toolName).toBe('enable_campaign')
  })

  it('records the previous budget alongside the new one', async () => {
    await POST(request({
      action: 'set_daily_budget',
      campaign_id: '120200000000000',
      ad_account_id: 'act_123456789',
      daily_budget: 80,
    }) as never)

    const audit = recordMutationMock.mock.calls[0][0]
    expect(audit.toolName).toBe('set_daily_budget')
    // Previous daily_budget was 5000 minor units = R$50.
    expect(audit.beforeValue).toContain('50')
    expect(audit.afterValue).toContain('80')
  })

  it('does not write an audit record when the mutation is rejected', async () => {
    canMock.mockResolvedValue(false)
    await POST(request(VALID_STATUS_BODY) as never)
    expect(recordMutationMock).not.toHaveBeenCalled()
  })

  it('busts the report cache so the operator sees their own change', async () => {
    await POST(request(VALID_STATUS_BODY) as never)
    expect(invalidateMock).toHaveBeenCalledWith('org-1', 'meta', 'act_123456789')
  })
})
