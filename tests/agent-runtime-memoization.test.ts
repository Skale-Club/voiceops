// tests/agent-runtime-memoization.test.ts
// Perf (2026-09-05 re-analysis, FINDINGS-OUTSIDE-SCOPE.md item 9): unit
// coverage for resolveAgent()'s and checkDailyCostCap()'s memoisation.
// Each shares the same contract: a cache HIT within the TTL skips the
// underlying DB call, and a DENIAL/FAILURE is NEVER cached (so it never
// outlives the check that produced it, and a transient failure never
// sticks around).
//
// resolveLlmProvider()'s and the knowledge-base short-circuit's memos live
// in tests/agent-runtime-memoization-provider-kb.test.ts instead of here —
// they are private to run-agent.ts and can only be exercised by mocking
// '@/lib/agent-runtime/resolve-agent' entirely, and vi.mock() is hoisted
// file-wide, which would otherwise also shadow the REAL resolveAgent()
// this file imports below.
//
// clearMemo() runs in beforeEach in every describe block below because the
// underlying store (src/lib/cache/ttl-memo.ts) is a module-level singleton
// shared across every `it()` in this file's module graph.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearMemo } from '@/lib/cache/ttl-memo'

// ---------------------------------------------------------------------------
// Part 1: resolveAgent() — 30s memo keyed by (orgId, agentId, channel).
// See src/lib/agent-runtime/resolve-agent.ts.
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))
vi.mock('@/lib/org-templates/prompt-template', () => ({
  hasTenantFactTokens: vi.fn(() => false),
  renderPromptTemplate: vi.fn((s: string) => s),
  resolveTenantFacts: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-memo-1',
    name: 'Memo Test Agent',
    model: 'anthropic/claude-sonnet-4-6',
    temperature: 0.3,
    max_tokens: 1024,
    max_history: 20,
    fallback_message: null,
    allowed_channels: ['web_widget'],
    channel_overrides: null,
    is_active: true,
    active_prompt_version_id: 'v1',
    kb_scope: null,
    agent_prompt_versions: { id: 'v1', system_prompt: 'You are a test agent.' },
    ...overrides,
  }
}

function buildResolveAgentSupabaseMock(result: { data: unknown; error: unknown }) {
  const singleMock = vi.fn().mockResolvedValue(result)
  const mock = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: singleMock,
    })),
  }
  vi.mocked(createServiceRoleClient).mockReturnValue(mock as never)
  return singleMock
}

describe('resolveAgent() memoisation (30s per orgId+agentId+channel)', () => {
  beforeEach(() => {
    clearMemo()
    vi.clearAllMocks()
  })

  it('hits the cache on a second call within the TTL — the DB is queried only once', async () => {
    const singleMock = buildResolveAgentSupabaseMock({ data: agentRow(), error: null })

    const first = await resolveAgent('agent-memo-1', 'org-memo-1', 'web_widget')
    const second = await resolveAgent('agent-memo-1', 'org-memo-1', 'web_widget')

    expect(first?.systemPrompt).toBe('You are a test agent.')
    expect(second?.systemPrompt).toBe('You are a test agent.')
    expect(singleMock).toHaveBeenCalledTimes(1)
  })

  it('never caches a null resolution (row not found) — every call re-queries', async () => {
    const singleMock = buildResolveAgentSupabaseMock({ data: null, error: { message: 'not found' } })

    const first = await resolveAgent('agent-missing', 'org-memo-1', 'web_widget')
    const second = await resolveAgent('agent-missing', 'org-memo-1', 'web_widget')

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(singleMock).toHaveBeenCalledTimes(2)
  })

  it('never caches a null resolution (missing active prompt version) — every call re-queries', async () => {
    const singleMock = buildResolveAgentSupabaseMock({
      data: agentRow({ agent_prompt_versions: null }),
      error: null,
    })

    const first = await resolveAgent('agent-no-prompt', 'org-memo-1', 'web_widget')
    const second = await resolveAgent('agent-no-prompt', 'org-memo-1', 'web_widget')

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(singleMock).toHaveBeenCalledTimes(2)
  })

  it('keys the cache on channel — a different channel is a fresh lookup even for the same org+agent', async () => {
    const singleMock = buildResolveAgentSupabaseMock({ data: agentRow(), error: null })

    await resolveAgent('agent-memo-1', 'org-memo-1', 'web_widget')
    await resolveAgent('agent-memo-1', 'org-memo-1', 'voice')

    expect(singleMock).toHaveBeenCalledTimes(2)
  })

  it('clearMemo() forces a fresh lookup on the next call', async () => {
    const singleMock = buildResolveAgentSupabaseMock({ data: agentRow(), error: null })

    await resolveAgent('agent-memo-1', 'org-memo-1', 'web_widget')
    clearMemo()
    await resolveAgent('agent-memo-1', 'org-memo-1', 'web_widget')

    expect(singleMock).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Part 2: checkDailyCostCap() deliberately does not memoise. A cached
// below-cap result creates a spend window beyond the configured hard limit.
// ---------------------------------------------------------------------------

import { checkDailyCostCap } from '@/lib/agent-runtime/guardrails'

function buildCostCapSupabaseMock(opts: {
  dailyCostCapOverride: number | null
  invocationCostRows: Array<{ cost_usd: number }>
  dailyCostCapEnabled?: boolean
}) {
  const orgSingleMock = vi.fn().mockResolvedValue({
    data: {
      daily_cost_cap_enabled: opts.dailyCostCapEnabled ?? true,
      daily_cost_cap_usd_override: opts.dailyCostCapOverride,
    },
    error: null,
  })
  const invocationsQueryMock = vi.fn().mockResolvedValue({
    data: opts.invocationCostRows,
    error: null,
  })
  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: orgSingleMock }) }),
        }
      }
      if (table === 'agent_invocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ gte: vi.fn().mockReturnValue({ not: invocationsQueryMock }) }),
            }),
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createServiceRoleClient).mockReturnValue(mock as never)
  return { orgSingleMock, invocationsQueryMock }
}

describe('checkDailyCostCap() freshness', () => {
  const originalDefaultCap = process.env.AGENT_DAILY_COST_CAP_USD

  beforeEach(() => {
    process.env.AGENT_DAILY_COST_CAP_USD = '50.00'
    clearMemo()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalDefaultCap === undefined) delete process.env.AGENT_DAILY_COST_CAP_USD
    else process.env.AGENT_DAILY_COST_CAP_USD = originalDefaultCap
  })

  it('re-checks a second call even when the previous call was not denied', async () => {
    const { orgSingleMock } = buildCostCapSupabaseMock({
      dailyCostCapOverride: null,
      invocationCostRows: [{ cost_usd: 5 }],
    })

    const first = await checkDailyCostCap('org-cost-memo', 'agent-cost-memo')
    const second = await checkDailyCostCap('org-cost-memo', 'agent-cost-memo')

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(orgSingleMock).toHaveBeenCalledTimes(2)
  })

  it('never caches a denial — every call re-checks, so the cap lifts the moment spend actually drops', async () => {
    const { orgSingleMock } = buildCostCapSupabaseMock({
      dailyCostCapOverride: null,
      invocationCostRows: [{ cost_usd: 999 }],
    })

    const first = await checkDailyCostCap('org-cost-memo', 'agent-cost-memo')
    const second = await checkDailyCostCap('org-cost-memo', 'agent-cost-memo')

    expect(typeof first).toBe('string')
    expect(typeof second).toBe('string')
    expect(orgSingleMock).toHaveBeenCalledTimes(2)
  })

  it('observes a denial immediately after a non-denied result', async () => {
    buildCostCapSupabaseMock({ dailyCostCapOverride: null, invocationCostRows: [{ cost_usd: 1 }] })
    const notDenied = await checkDailyCostCap('org-cost-memo', 'agent-a')
    expect(notDenied).toBeNull()

    const { orgSingleMock: secondOrgMock } = buildCostCapSupabaseMock({
      dailyCostCapOverride: null,
      invocationCostRows: [{ cost_usd: 999 }],
    })
    const denied = await checkDailyCostCap('org-cost-memo', 'agent-a')
    expect(typeof denied).toBe('string')
    expect(secondOrgMock).toHaveBeenCalledTimes(1)
  })

})
