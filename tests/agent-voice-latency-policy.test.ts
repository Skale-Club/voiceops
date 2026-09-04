// tests/agent-voice-latency-policy.test.ts
// Phase 133 Plan 02 (PERF-01): voice channel latency policy expressed
// through the Phase 132 tree-shared PartnerBudget — no second, independent
// limiter. Covers:
//   Task 1: channel-policy.ts channel-keyed latency policy (data only).
//   Task 2: guardrails.ts ceiling check reusing PartnerBudget.callCount, and
//           invocation-gateway.ts's lean recoverable outcome + gate.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

import { getChannelLatencyPolicy } from '@/lib/agent-runtime/channel-policy'
import {
  createPartnerBudget,
  checkChannelModelInvocationCeiling,
} from '@/lib/agent-runtime/guardrails'

// ---------------------------------------------------------------------------
// Task 1: channel-policy.ts
// ---------------------------------------------------------------------------

describe('getChannelLatencyPolicy', () => {
  it('caps voice at one internal specialist model invocation per turn by default', () => {
    const policy = getChannelLatencyPolicy('voice')
    expect(policy.maxInternalSpecialistInvocations).toBe(1)
    expect(policy.wallClockCeilingMs).toBeGreaterThan(0)
    expect(Number.isFinite(policy.wallClockCeilingMs)).toBe(true)
  })

  it.each(['web_widget', 'whatsapp', 'messenger', 'instagram', 'manychat', 'telegram', 'sms', 'zernio', 'workflow'] as const)(
    'keeps today\'s looser (unrestricted) behavior for the %s channel',
    (channel) => {
      const policy = getChannelLatencyPolicy(channel)
      expect(policy.maxInternalSpecialistInvocations).toBe(Number.POSITIVE_INFINITY)
      expect(policy.wallClockCeilingMs).toBe(Number.POSITIVE_INFINITY)
    },
  )

  it('accepts an optional organizationId without changing today\'s result (tenant-overridable in principle)', () => {
    const withoutOrg = getChannelLatencyPolicy('voice')
    const withOrg = getChannelLatencyPolicy('voice', 'org-123')
    expect(withOrg).toEqual(withoutOrg)
  })

  it('is channel-neutral in shape: no tenant, vendor, or client name leaks into the module source', () => {
    // Guards against reintroducing a Vapi-specific or tenant-specific hack
    // (132/133-CONTEXT.md: "do not hardcode Vapi, any tenant slug, or Cuts & Culture").
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/lib/agent-runtime/channel-policy.ts'),
      'utf8',
    )
    expect(source.toLowerCase()).not.toMatch(/vapi|cuts.{0,4}culture/)
  })
})

// ---------------------------------------------------------------------------
// PERF-01 wiring: the ceiling must gate the RECURSIVE in-process handoff loop
// in run-agent.ts, not only the gateway entry point. Without this the policy
// is inert exactly where "a specialist three hops deep" lives.
// ---------------------------------------------------------------------------

describe('run-agent partner recursion wiring', () => {
  const runAgentSource: string = require('node:fs').readFileSync(
    require('node:path').resolve(process.cwd(), 'src/lib/agent-runtime/run-agent.ts'),
    'utf8',
  )

  it('imports the ceiling guard from guardrails', () => {
    expect(runAgentSource).toMatch(/checkChannelModelInvocationCeiling/)
  })

  it('checks the ceiling against the shared budget and the resolved channel', () => {
    expect(runAgentSource).toMatch(
      /checkChannelModelInvocationCeiling\(\s*partnerBudget,\s*channel,/,
    )
  })

  it('denies before the traversal is counted, so the Nth call is refused rather than charged', () => {
    // Order matters: the check compares callCount < max, so it must run while
    // the counter still reflects calls already made — before the increment.
    const ceilingAt = runAgentSource.indexOf('checkChannelModelInvocationCeiling(partnerBudget')
    const incrementAt = runAgentSource.indexOf('partnerBudget.callCount += 1')
    expect(ceilingAt).toBeGreaterThan(-1)
    expect(incrementAt).toBeGreaterThan(-1)
    expect(ceilingAt).toBeLessThan(incrementAt)
  })

  it('returns the denial to the caller instead of throwing', () => {
    // Phase 134 Plan 03 (OBS-02) wraps the return in a block that also
    // records the denial to partnerCallsLog before returning — the pattern
    // tolerates that intermediate statement rather than requiring the
    // single-line `if (ceilingDenial) return ceilingDenial` shape.
    expect(runAgentSource).toMatch(
      /const ceilingDenial = checkChannelModelInvocationCeiling[\s\S]{0,300}?if \(ceilingDenial\) \{[\s\S]{0,200}?return ceilingDenial/,
    )
  })
})

// ---------------------------------------------------------------------------
// Task 2: guardrails.ts — checkChannelModelInvocationCeiling
// ---------------------------------------------------------------------------

describe('checkChannelModelInvocationCeiling', () => {
  it('allows the first internal specialist invocation on voice (budget starts at 0)', () => {
    const budget = createPartnerBudget()
    const denial = checkChannelModelInvocationCeiling(budget, 'voice', 'org-1', 'agent-1')
    expect(denial).toBeNull()
  })

  it('denies a second internal specialist invocation on voice once the shared budget already recorded one', () => {
    const budget = createPartnerBudget()
    // Simulate what run-agent.ts's buildPartnerTools already does today right
    // before recursing into a specialist: increment the SAME shared counter
    // used by resolvePartnerEdge() and checkPartnerBudgetTimeout().
    budget.callCount += 1

    const denial = checkChannelModelInvocationCeiling(budget, 'voice', 'org-1', 'agent-1')
    expect(denial).not.toBeNull()
    expect(typeof denial).toBe('string')
  })

  it('never throws on exhaustion — returns a lean string outcome instead', () => {
    const budget = createPartnerBudget()
    budget.callCount = 999
    expect(() => checkChannelModelInvocationCeiling(budget, 'voice', 'org-1', 'agent-1')).not.toThrow()
  })

  it('does not restrict text/widget channels even after many specialist calls (no regression)', () => {
    const budget = createPartnerBudget()
    budget.callCount = 50
    const denial = checkChannelModelInvocationCeiling(budget, 'web_widget', 'org-1', 'agent-1')
    expect(denial).toBeNull()
  })

  it('counts on the SAME PartnerBudget object shared across the whole tree, not a fresh per-call counter', () => {
    const treeSharedBudget = createPartnerBudget()

    // Root agent calls specialist A (a grandchild three hops deep would
    // still increment this same object by reference).
    expect(checkChannelModelInvocationCeiling(treeSharedBudget, 'voice', 'org-1', 'root')).toBeNull()
    treeSharedBudget.callCount += 1

    // Specialist A attempts to call specialist B — same object, already at
    // the voice ceiling.
    expect(checkChannelModelInvocationCeiling(treeSharedBudget, 'voice', 'org-1', 'specialist-a')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 2: invocation-gateway.ts — lean recoverable outcome + gateway gate
// ---------------------------------------------------------------------------

const { runAgentMock } = vi.hoisted(() => ({ runAgentMock: vi.fn() }))
vi.mock('@/lib/agent-runtime/run-agent', () => ({ runAgent: runAgentMock }))

import {
  buildSpecialistCeilingExhaustedResult,
  invokeInternalSpecialist,
} from '@/lib/agent-runtime/invocation-gateway'
import type { AgentRunResult } from '@/lib/agent-runtime/types'

function runtimeResult(traceId: string): AgentRunResult {
  return {
    text: 'ok',
    usage: { tokensIn: 1, tokensOut: 1 },
    invocationId: 'invocation-1',
    traceId,
    status: 'success',
  }
}

function envelope(channel: 'voice' | 'web_widget' = 'voice') {
  return {
    route: {
      orgId: 'trusted-org',
      agentId: 'trusted-agent',
      channel,
      externalInteractionId: 'external-1',
    },
    input: { userMessage: 'Quais horários estão disponíveis?' },
  } as const
}

describe('buildSpecialistCeilingExhaustedResult', () => {
  it('returns a lean, recoverable AgentRunResult — never an error status', () => {
    const result = buildSpecialistCeilingExhaustedResult('trace-1')

    expect(result.status).toBe('skipped')
    expect(result.traceId).toBe('trace-1')
    expect(result.invocationId).toBe('')
    expect(result.usage).toEqual({ tokensIn: 0, tokensOut: 0 })
    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
  })
})

describe('invokeInternalSpecialist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runAgentMock.mockImplementation((options: { traceId: string }) =>
      Promise.resolve(runtimeResult(options.traceId)),
    )
  })

  it('runs the first internal specialist invocation on voice normally', async () => {
    const budget = createPartnerBudget()
    const response = await invokeInternalSpecialist(envelope('voice'), budget)

    expect(response.result.status).toBe('success')
    expect(runAgentMock).toHaveBeenCalledTimes(1)
  })

  it('degrades cleanly (no exception, no hang) once the shared budget already spent the voice ceiling', async () => {
    const budget = createPartnerBudget()
    budget.callCount += 1 // simulate one internal specialist invocation already spent this turn

    const response = await invokeInternalSpecialist(envelope('voice'), budget)

    expect(response.result.status).toBe('skipped')
    expect(response.result.text.length).toBeGreaterThan(0)
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('never lets a second internal specialist model call happen on voice once denied (no partial side effect)', async () => {
    const budget = createPartnerBudget()

    await invokeInternalSpecialist(envelope('voice'), budget)
    budget.callCount += 1 // the first call above counts as the spent specialist invocation
    await invokeInternalSpecialist(envelope('voice'), budget)

    expect(runAgentMock).toHaveBeenCalledTimes(1)
  })

  it('does not regress text/widget behavior: multiple specialist invocations share the budget without being capped', async () => {
    const budget = createPartnerBudget()

    for (let i = 0; i < 5; i += 1) {
      const response = await invokeInternalSpecialist(envelope('web_widget'), budget)
      expect(response.result.status).toBe('success')
      budget.callCount += 1
    }

    expect(runAgentMock).toHaveBeenCalledTimes(5)
  })

  it('creates its own fresh budget when the caller supplies none (single-call turns are unaffected)', async () => {
    const response = await invokeInternalSpecialist(envelope('voice'))
    expect(response.result.status).toBe('success')
    expect(runAgentMock).toHaveBeenCalledTimes(1)
  })
})
