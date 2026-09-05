// tests/agent-runtime-guardrails.test.ts
// Unit tests for each guardrail function in src/lib/agent-runtime/guardrails.ts.
// Phase 34 RUNTIME-04..07 + RUNTIME-09 + GATE-03.
// Mocks Supabase for checkDailyCostCap — no real DB calls.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock: Supabase service-role client used by checkDailyCostCap
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  checkKillSwitch,
  checkDelegationDepth,
  checkLlmCallCount,
  checkTokenCap,
  checkDailyCostCap,
} from '@/lib/agent-runtime/guardrails'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRACE_ID = 'trace-00000000-0000-0000-0000-000000000001'
const ORG_ID = 'org-test-guardrails'
const AGENT_ID = 'agent-test-guardrails'

/** Build a chainable Supabase mock for checkDailyCostCap DB calls. */
function buildDailyCostMock(opts: {
  dailyCostCapOverride: number | null
  invocationCostRows: Array<{ cost_usd: number }>
  dailyCostCapEnabled?: boolean
}) {
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  daily_cost_cap_enabled: opts.dailyCostCapEnabled ?? true,
                  daily_cost_cap_usd_override: opts.dailyCostCapOverride,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'agent_invocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({
                    data: opts.invocationCostRows,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createServiceRoleClient).mockReturnValue(mockSupabase as never)
  return mockSupabase
}

// ---------------------------------------------------------------------------
// checkKillSwitch
// ---------------------------------------------------------------------------

describe('checkKillSwitch (RUNTIME-09 / GATE-03)', () => {
  const originalEnabled = process.env.AGENT_RUNTIME_ENABLED

  afterEach(() => {
    // Restore env to avoid test pollution
    if (originalEnabled === undefined) {
      delete process.env.AGENT_RUNTIME_ENABLED
    } else {
      process.env.AGENT_RUNTIME_ENABLED = originalEnabled
    }
  })

  it('returns null when AGENT_RUNTIME_ENABLED=true (runtime active)', () => {
    process.env.AGENT_RUNTIME_ENABLED = 'true'
    const result = checkKillSwitch(TRACE_ID)
    expect(result).toBeNull()
  })

  it('returns null when AGENT_RUNTIME_ENABLED is unset (default = enabled)', () => {
    delete process.env.AGENT_RUNTIME_ENABLED
    const result = checkKillSwitch(TRACE_ID)
    expect(result).toBeNull()
  })

  it('returns AgentRunResult with status=skipped when AGENT_RUNTIME_ENABLED=false', () => {
    process.env.AGENT_RUNTIME_ENABLED = 'false'
    const result = checkKillSwitch(TRACE_ID)

    expect(result).not.toBeNull()
    expect(result!.status).toBe('skipped')
    expect(result!.text).toBe('Service temporarily unavailable')
    expect(result!.traceId).toBe(TRACE_ID)
    expect(result!.invocationId).toBe('')
    expect(result!.errorDetail).toBe('AGENT_RUNTIME_ENABLED=false')
    expect(result!.usage).toEqual({ tokensIn: 0, tokensOut: 0 })
  })
})

// ---------------------------------------------------------------------------
// checkDelegationDepth (RUNTIME-04 / D-34-10)
// ---------------------------------------------------------------------------

describe('checkDelegationDepth (RUNTIME-04)', () => {
  // Default cap is AGENT_MAX_DELEGATION_DEPTH env var (default=2)
  const originalCap = process.env.AGENT_MAX_DELEGATION_DEPTH

  afterEach(() => {
    if (originalCap === undefined) {
      delete process.env.AGENT_MAX_DELEGATION_DEPTH
    } else {
      process.env.AGENT_MAX_DELEGATION_DEPTH = originalCap
    }
  })

  it('returns null when depth=0 (below cap=2)', () => {
    process.env.AGENT_MAX_DELEGATION_DEPTH = '2'
    const result = checkDelegationDepth(0, ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns null when depth=1 (below cap=2)', () => {
    process.env.AGENT_MAX_DELEGATION_DEPTH = '2'
    const result = checkDelegationDepth(1, ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns denial string when depth=2 equals cap=2', () => {
    process.env.AGENT_MAX_DELEGATION_DEPTH = '2'
    const result = checkDelegationDepth(2, ORG_ID, AGENT_ID)
    expect(result).toBe('Delegation depth exceeded | answer from current agent')
  })

  it('returns denial string when depth=3 exceeds cap=2 (D-34-10 stub test)', () => {
    process.env.AGENT_MAX_DELEGATION_DEPTH = '2'
    const result = checkDelegationDepth(3, ORG_ID, AGENT_ID)
    expect(result).toBe('Delegation depth exceeded | answer from current agent')
  })
})

// ---------------------------------------------------------------------------
// checkLlmCallCount (RUNTIME-05)
// ---------------------------------------------------------------------------

describe('checkLlmCallCount (RUNTIME-05)', () => {
  const originalCap = process.env.AGENT_MAX_LLM_CALLS_PER_TURN

  afterEach(() => {
    if (originalCap === undefined) {
      delete process.env.AGENT_MAX_LLM_CALLS_PER_TURN
    } else {
      process.env.AGENT_MAX_LLM_CALLS_PER_TURN = originalCap
    }
  })

  it('returns null when callCount=5 is below cap=6', () => {
    process.env.AGENT_MAX_LLM_CALLS_PER_TURN = '6'
    const result = checkLlmCallCount(5, 'fallback msg', ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns fallbackMessage when callCount=6 equals cap=6', () => {
    process.env.AGENT_MAX_LLM_CALLS_PER_TURN = '6'
    const fallback = 'I have reached my thinking limit for this turn.'
    const result = checkLlmCallCount(6, fallback, ORG_ID, AGENT_ID)
    expect(result).toBe(fallback)
  })

  it('returns fallbackMessage when callCount=7 exceeds cap=6', () => {
    process.env.AGENT_MAX_LLM_CALLS_PER_TURN = '6'
    const fallback = 'Too many steps.'
    const result = checkLlmCallCount(7, fallback, ORG_ID, AGENT_ID)
    expect(result).toBe(fallback)
  })
})

// ---------------------------------------------------------------------------
// checkTokenCap (RUNTIME-06)
// ---------------------------------------------------------------------------

describe('checkTokenCap (RUNTIME-06)', () => {
  const originalCap = process.env.AGENT_MAX_CONV_TOKENS

  afterEach(() => {
    if (originalCap === undefined) {
      delete process.env.AGENT_MAX_CONV_TOKENS
    } else {
      process.env.AGENT_MAX_CONV_TOKENS = originalCap
    }
  })

  it('returns null when cumulativeTokens=100000 is below cap=200000', () => {
    process.env.AGENT_MAX_CONV_TOKENS = '200000'
    const result = checkTokenCap(100000, ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns null when cumulativeTokens=199999 (one below cap=200000)', () => {
    process.env.AGENT_MAX_CONV_TOKENS = '200000'
    const result = checkTokenCap(199999, ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns denial string when cumulativeTokens=200000 equals cap=200000', () => {
    process.env.AGENT_MAX_CONV_TOKENS = '200000'
    const result = checkTokenCap(200000, ORG_ID, AGENT_ID)
    expect(typeof result).toBe('string')
    expect(result).toContain('conversation length exceeded')
  })

  it('returns denial string when cumulativeTokens=300000 exceeds cap=200000', () => {
    process.env.AGENT_MAX_CONV_TOKENS = '200000'
    const result = checkTokenCap(300000, ORG_ID, AGENT_ID)
    expect(typeof result).toBe('string')
    expect(result).toContain('conversation length exceeded')
  })
})

// ---------------------------------------------------------------------------
// checkDailyCostCap (RUNTIME-07 / D-34-05 / D-34-15)
// ---------------------------------------------------------------------------

describe('checkDailyCostCap (RUNTIME-07)', () => {
  const originalDefaultCap = process.env.AGENT_DAILY_COST_CAP_USD

  beforeEach(() => {
    // Set default cap to $50 via env (matching D-34-05)
    process.env.AGENT_DAILY_COST_CAP_USD = '50.00'
  })

  afterEach(() => {
    if (originalDefaultCap === undefined) {
      delete process.env.AGENT_DAILY_COST_CAP_USD
    } else {
      process.env.AGENT_DAILY_COST_CAP_USD = originalDefaultCap
    }
    vi.clearAllMocks()
  })

  it('returns null when daily cost $10 is below default cap $50', async () => {
    buildDailyCostMock({
      dailyCostCapOverride: null,   // forces env default ($50)
      invocationCostRows: [
        { cost_usd: 5 },
        { cost_usd: 3 },
        { cost_usd: 2 },
      ],
    })

    const result = await checkDailyCostCap(ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns denial string when daily cost $55 exceeds default cap $50', async () => {
    buildDailyCostMock({
      dailyCostCapOverride: null,   // forces env default ($50)
      invocationCostRows: [
        { cost_usd: 30 },
        { cost_usd: 25 },
      ],
    })

    const result = await checkDailyCostCap(ORG_ID, AGENT_ID)
    expect(typeof result).toBe('string')
    expect(result).toContain('Daily cost limit')
  })

  it('returns null when daily cost is below per-org override cap', async () => {
    buildDailyCostMock({
      dailyCostCapOverride: 100,    // org-specific $100 cap
      invocationCostRows: [{ cost_usd: 80 }],
    })

    const result = await checkDailyCostCap(ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns denial string when daily cost exceeds per-org override cap', async () => {
    buildDailyCostMock({
      dailyCostCapOverride: 20,     // org-specific $20 cap
      invocationCostRows: [{ cost_usd: 25 }],
    })

    const result = await checkDailyCostCap(ORG_ID, AGENT_ID)
    expect(typeof result).toBe('string')
    expect(result).toContain('Daily cost limit')
  })

  it('returns null (no cap) when the cap switch is disabled, even when way over', async () => {
    buildDailyCostMock({
      dailyCostCapEnabled: false,   // switch off → unlimited spend
      dailyCostCapOverride: 20,     // ignored when disabled
      invocationCostRows: [{ cost_usd: 9999 }],
    })

    const result = await checkDailyCostCap(ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns null when there are zero cost rows (no spend today)', async () => {
    buildDailyCostMock({
      dailyCostCapOverride: null,
      invocationCostRows: [],
    })

    const result = await checkDailyCostCap(ORG_ID, AGENT_ID)
    expect(result).toBeNull()
  })
})
