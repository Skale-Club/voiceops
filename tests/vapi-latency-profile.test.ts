// tests/vapi-latency-profile.test.ts
// Phase 135 Plan 02 (TEST-03): timed integration test for the Vapi ingress ->
// specialist -> tool-result path, measured against the written profile at
// docs/agents/latency-profile.md. Read that document FIRST — every figure,
// boundary, and formula here is a direct implementation of what it defines,
// not an independent second definition.
//
// This test walks REAL orchestration code end to end:
//   resolveChannelRoutingMode()  -> real (src/lib/agent-runtime/routing-mode.ts)
//   resolveTrustedAgentRoute()   -> real (src/lib/agent-runtime/invocation-gateway.ts)
//   resolveSpecialistRoute()     -> real (src/lib/agent-runtime/resolve-specialist-route.ts)
//   invokeInternalSpecialist()   -> real (src/lib/agent-runtime/invocation-gateway.ts)
//   checkChannelModelInvocationCeiling() + PartnerBudget -> real (guardrails.ts)
//   executeAction('xkedule_check_availability', ...) -> real (action-engine)
//   checkXkeduleAvailability() / xkeduleFetchJson() / xkeduleFetch() -> real (xkedule client)
//
// Only the boundaries the profile document names as simulated are mocked
// here: Supabase network round trips (.maybeSingle()), the specialist's own
// LLM call (run-agent.ts, mocked at its module boundary exactly like
// tests/agent-invocation-gateway.test.ts and
// tests/agent-voice-latency-policy.test.ts do), the Xkedule credentials DB
// read, and the underlying fetch() call to Xkedule's API. No live database,
// no network, no real model call — deterministic and CI-fast.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Injected latency figures — MUST match docs/agents/latency-profile.md
// exactly. These are not tuned to make the assertion pass; they are the
// documented, sourced/assumption-labeled figures the profile states.
// ---------------------------------------------------------------------------

const DB_ROUND_TRIP_MS = 30 // Assumption: same-region indexed point lookup
const SPECIALIST_MODEL_TURN_MS = 900 // Assumption: short voice-turn completion
const XKEDULE_VENDOR_CALL_MS = 300 // Assumption: warm-cache typical case (NOT client.ts's documented 5.1s cold-cache outlier)

const ITERATIONS = 50
const P95_TARGET_MS = 5000

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/**
 * Nearest-rank p95 over ascending-sorted durations, exactly as
 * docs/agents/latency-profile.md defines it: index Math.ceil(0.95 * N) - 1.
 */
function computeP95(durationsMs: number[]): number {
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const index = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

// ---------------------------------------------------------------------------
// Simulated boundary: Supabase (createServiceRoleClient) — used by
// resolveChannelRoutingMode() and resolveSpecialistRoute(). Every
// `.maybeSingle()` resolves after DB_ROUND_TRIP_MS with a canned row.
// ---------------------------------------------------------------------------

const ORG_ID = 'org-latency-1111-1111-1111-111111111111'
const ENTRY_AGENT_ID = 'agent-entry-latency-0000-0000-000000000001'
const SPECIALIST_AGENT_ID = 'agent-specialist-latency-0-0000-000000000002'
const SPECIALIST_SLUG = 'availability_specialist'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'agent_channel_routing_modes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => delay(DB_ROUND_TRIP_MS, { data: { mode: 'specialist' }, error: null })),
              })),
            })),
          })),
        }
      }
      if (table === 'agents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  delay(DB_ROUND_TRIP_MS, {
                    data: {
                      id: SPECIALIST_AGENT_ID,
                      organization_id: ORG_ID,
                      slug: SPECIALIST_SLUG,
                      is_active: true,
                      allowed_channels: ['voice'],
                    },
                    error: null,
                  }),
                ),
              })),
            })),
          })),
        }
      }
      throw new Error(`vapi-latency-profile test: unexpected table "${table}"`)
    }),
  })),
}))

vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

// executeAction() fire-and-forget logs every call via src/lib/logger.ts,
// which instantiates its OWN real @supabase/supabase-js client (not the
// @/lib/supabase/admin mock above) whenever Supabase env vars are present —
// exactly the live-network call this profile forbids. Mocked to a no-op;
// this is pure observability plumbing, not orchestration logic, so nothing
// about the measured path is weakened by not exercising it for real.
vi.mock('@/lib/logger', () => ({
  log: vi.fn(() => Promise.resolve()),
}))

// ---------------------------------------------------------------------------
// Simulated boundary: the specialist's own model call, inside runAgent().
// Mocked at the module boundary — same technique as
// tests/agent-invocation-gateway.test.ts / tests/agent-voice-latency-policy.test.ts.
// Everything in invocation-gateway.ts (invokeAgent, invokeInternalSpecialist,
// resolveTrustedAgentRoute, checkChannelModelInvocationCeiling/PartnerBudget)
// still runs for real — only the LLM call this function would make is
// replaced.
// ---------------------------------------------------------------------------

const { runAgentMock } = vi.hoisted(() => ({ runAgentMock: vi.fn() }))
vi.mock('@/lib/agent-runtime/run-agent', () => ({ runAgent: runAgentMock }))

// ---------------------------------------------------------------------------
// Simulated boundary: the Xkedule credentials DB read. Mocked directly
// (rather than mocking supabase.from('integrations') + crypto.decrypt) to
// avoid unrelated crypto.ts key setup — the profile documents this choice.
// ---------------------------------------------------------------------------

// execute-action.ts's xkedule_* cases call getXkeduleCredentialsForOrgCached
// (a 60s per-org memo over the same DB read, added so a conversation's
// second/third xkedule tool call doesn't repeat this round trip) -- mocked
// here in full replacement of the module, so this file's own DB_ROUND_TRIP_MS
// simulation is what runs, not the real memo.
vi.mock('@/lib/xkedule/credentials', () => ({
  getXkeduleCredentialsForOrgCached: vi.fn(() =>
    delay(DB_ROUND_TRIP_MS, { tenantBaseUrl: 'https://tenant.example.xkedule.test', apiKey: 'test-key' }),
  ),
}))

// ---------------------------------------------------------------------------
// Simulated boundary: the Xkedule vendor HTTP call itself. Only global
// fetch() is replaced — xkeduleFetch()/xkeduleFetchJson()/
// checkXkeduleAvailability() all run for real on top of it.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn(() =>
  delay(XKEDULE_VENDOR_CALL_MS, {
    ok: true,
    status: 200,
    json: async () => ({ slots: [{ time: '14:00', available: true }, { time: '14:30', available: true }] }),
    text: async () => '',
  }),
)

import { resolveChannelRoutingMode } from '@/lib/agent-runtime/routing-mode'
import { resolveTrustedAgentRoute, invokeInternalSpecialist } from '@/lib/agent-runtime/invocation-gateway'
import { createPartnerBudget } from '@/lib/agent-runtime/guardrails'
import { executeAction } from '@/lib/action-engine/execute-action'

describe('Vapi path latency profile (TEST-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runAgentMock.mockImplementation((options: { traceId: string }) =>
      delay(SPECIALIST_MODEL_TURN_MS, {
        text: 'We have 2:00pm and 2:30pm open Thursday.',
        usage: { tokensIn: 42, tokensOut: 18 },
        invocationId: 'invocation-sim-1',
        traceId: options.traceId,
        status: 'success' as const,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the simple voice lookup turn through the real orchestration path', async () => {
    // Sanity check independent from the timed run below: confirms the
    // wiring actually reaches the tool result before we trust any timing
    // numbers built on top of it.
    const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(mode).toBe('specialist')

    const route = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: SPECIALIST_SLUG,
    })
    expect(route.specialistMatched).toBe(true)
    expect(route.agentId).toBe(SPECIALIST_AGENT_ID)

    const budget = createPartnerBudget()
    const invocation = await invokeInternalSpecialist(
      {
        route: {
          orgId: ORG_ID,
          agentId: route.agentId,
          channel: 'voice',
          externalInteractionId: 'vapi-call-sim-1',
        },
        input: { userMessage: 'Do you have anything open Thursday afternoon?' },
      },
      budget,
    )
    expect(invocation.result.status).toBe('success')
    expect(budget.callCount).toBe(1)

    const toolResult = await executeAction(
      'xkedule_check_availability',
      { date: '2026-09-10', serviceId: 1 },
      {} as never,
      { organizationId: ORG_ID, supabase: {} as never },
    )
    // checkXkeduleAvailability() returns a natural-language string (built to
    // read back naturally on a voice call), not JSON — assert it reflects
    // the canned slot data returned by the mocked fetch() above.
    expect(toolResult).toContain('14:00')
    expect(toolResult).toContain('14:30')
  })

  it(`p95 over ${ITERATIONS} iterations of the simple voice lookup is under ${P95_TARGET_MS}ms (docs/agents/latency-profile.md)`, async () => {
    async function runOneSimulatedTurn(): Promise<number> {
      const start = Date.now()

      // 2. Trusted ingress routing-mode resolution
      await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })

      // 3. Trusted specialist routing (no router/orchestrator model call)
      const route = await resolveTrustedAgentRoute({
        organizationId: ORG_ID,
        channel: 'voice',
        entryAgentId: ENTRY_AGENT_ID,
        intent: SPECIALIST_SLUG,
      })

      // 4 + 5. Partner budget / channel ceiling, then the specialist's own
      // (simulated) model turn.
      const budget = createPartnerBudget()
      await invokeInternalSpecialist(
        {
          route: {
            orgId: ORG_ID,
            agentId: route.agentId,
            channel: 'voice',
            externalInteractionId: `vapi-call-sim-${Math.random().toString(36).slice(2)}`,
          },
          input: { userMessage: 'Do you have anything open Thursday afternoon?' },
        },
        budget,
      )

      // 6. Deterministic tool execution
      await executeAction(
        'xkedule_check_availability',
        { date: '2026-09-10', serviceId: 1 },
        {} as never,
        { organizationId: ORG_ID, supabase: {} as never },
      )

      return Date.now() - start
    }

    // Iterations run concurrently (see docs/agents/latency-profile.md,
    // "Iterations and p95 computation") — each iteration's own duration is
    // timed independently around its own await chain, so running them
    // concurrently changes only the wall-clock time of this test file, not
    // any individual iteration's measured duration.
    const durations = await Promise.all(
      Array.from({ length: ITERATIONS }, () => runOneSimulatedTurn()),
    )

    const p95 = computeP95(durations)

    expect(
      p95,
      `Measured p95 over ${ITERATIONS} iterations was ${p95}ms against docs/agents/latency-profile.md's ` +
        `${P95_TARGET_MS}ms target — ${p95 - P95_TARGET_MS}ms over budget. Durations: ${JSON.stringify(
          [...durations].sort((a, b) => a - b),
        )}`,
    ).toBeLessThan(P95_TARGET_MS)
  })
})
