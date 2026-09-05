// tests/agent-turn-timings.test.ts
// Perf (2026-09-05 re-analysis, FINDINGS-OUTSIDE-SCOPE.md item 9): run-agent.ts
// now records per-stage latency and emits one `agent_turn_timings` structured
// log per turn (see logTurnTimings() in src/lib/agent-runtime/run-agent.ts).
// This exercises the blocking path end-to-end (mocking only I/O boundaries,
// the same idiom as tests/agent-runtime-kill-switch.test.ts) and asserts the
// log fires exactly once with every documented stage key present.

import { describe, it, expect, vi, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before the imports that use them
// ---------------------------------------------------------------------------

vi.mock('@/lib/agent-runtime/invocations', () => ({
  insertInvocationStart: vi.fn().mockResolvedValue('inv-timing-test'),
  updateInvocationEnd: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/agent-runtime/resolve-agent', () => ({
  resolveAgent: vi.fn(),
}))

vi.mock('@/lib/knowledge/query-knowledge', () => ({
  queryKnowledge: vi.fn().mockResolvedValue("I don't have information about that in my knowledge base."),
}))

vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: vi.fn().mockResolvedValue('fake-openrouter-key'),
}))

// createLogger() is called with different bound contexts throughout
// run-agent.ts (traceId+orgId, traceId+orgId+channel, ...) — every one of
// those loggers shares this single `infoMock`/`warnMock` so the test can
// filter by event name regardless of which call site logged it.
const infoMock = vi.fn()
const warnMock = vi.fn()
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({
    info: infoMock,
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  })),
}))

// Only generateText is mocked — dynamicTool/jsonSchema/stepCountIs (used by
// buildBuiltinTools and the tool-loop below) keep their real implementation.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: 'Hello from the mock model.',
      usage: { inputTokens: 12, outputTokens: 6 },
    }),
  }
})

// Minimal chainable Supabase passthrough — every table/column access
// resolves to {data: null, error: null}. That's enough for every read this
// turn touches (organizations, agent_tools x2, agent_partners) to come back
// empty without denying anything.
//
// Each chain link IS a real (already-settled) Promise, so `await` on it
// resolves through the genuine Promise.prototype.then rather than a fake
// thenable — a bare `{ get: () => () => make() }` proxy (as used by
// tests/agent-runtime-kill-switch.test.ts, whose passing cases never
// actually await this deep) answers `.then` with a plain function taking no
// resolve/reject callbacks, so an `await` on it never settles and hangs
// forever. Any non-Promise property access (`.select`, `.eq`, `.single`, …)
// returns a function that yields a fresh chain, so calls keep chaining.
function buildPassthroughSupabaseMock() {
  function makeChain(): unknown {
    const settled = Promise.resolve({ data: null, error: null })
    return new Proxy(settled, {
      get(target, prop, receiver) {
        if (prop in target) {
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return () => makeChain()
      },
    })
  }
  return { from: () => makeChain() }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => buildPassthroughSupabaseMock()),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { runAgent } from '@/lib/agent-runtime'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'

const TEST_OPTS = {
  orgId: 'org-timing-test',
  agentId: 'agent-timing-test',
  channel: 'web_widget' as const,
  userMessage: 'hello timing test',
}

const MOCK_RESOLVED_AGENT = {
  agentId: TEST_OPTS.agentId,
  orgId: TEST_OPTS.orgId,
  name: 'Timing Test Agent',
  systemPrompt: 'You are a test agent.',
  model: 'anthropic/claude-sonnet-4-6',
  temperature: undefined,
  maxTokens: 1024,
  maxHistory: 20,
  fallbackMessage: "I can't help right now.",
  allowedChannels: ['web_widget'] as const,
  isActive: true,
  kbScope: null,
}

/** Pulls the fields object out of the (single) `agent_turn_timings` log call. */
function getTimingsLogFields(): Record<string, unknown> {
  const timingCalls = infoMock.mock.calls.filter(([event]) => event === 'agent_turn_timings')
  expect(timingCalls).toHaveLength(1)
  return timingCalls[0][1] as Record<string, unknown>
}

afterEach(() => {
  delete process.env.AGENT_RUNTIME_ENABLED
  vi.clearAllMocks()
})

describe('agent_turn_timings structured log (blocking path)', () => {
  it('emits exactly one agent_turn_timings log carrying every documented stage key', async () => {
    vi.mocked(resolveAgent).mockResolvedValue(MOCK_RESOLVED_AGENT as never)

    const result = await runAgent(TEST_OPTS)

    expect(result.status).toBe('success')

    const fields = getTimingsLogFields()

    // Context fields (mirror the other structured logs in this module).
    expect(fields).toMatchObject({
      agentId: TEST_OPTS.agentId,
      channel: TEST_OPTS.channel,
      depth: 0,
      path: 'blocking',
    })

    // Every stage on the blocking path's hot path (run-agent.ts's
    // logTurnTimings() call in runAgentBlocking's `finally`) must be present
    // and numeric — "never reached" would mean the key is simply absent, not
    // coerced to 0, so a present numeric value here proves the stage ran.
    for (const key of [
      'resolve_agent_ms',
      'cost_cap_ms',
      'knowledge_ms',
      'invocation_insert_ms',
      'llm_provider_ms',
      'tool_build_ms',
      'model_first_call_ms',
      'total_ms',
    ]) {
      expect(typeof fields[key], `expected numeric "${key}"`).toBe('number')
      expect(fields[key] as number).toBeGreaterThanOrEqual(0)
    }
  })

  it('does not emit the timings log at all when the kill switch short-circuits before the main turn', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'false'

    const result = await runAgent(TEST_OPTS)

    expect(result.status).toBe('skipped')
    expect(infoMock.mock.calls.filter(([event]) => event === 'agent_turn_timings')).toHaveLength(0)
  })
})
