// tests/agent-runtime-memoization-provider-kb.test.ts
// Perf (2026-09-05 re-analysis, FINDINGS-OUTSIDE-SCOPE.md item 9): covers
// resolveLlmProvider()'s 60s-per-org memo and the knowledge-base
// short-circuit (org-has-documents fact, also 60s per org) — both private
// to src/lib/agent-runtime/run-agent.ts, so they are exercised indirectly
// through the full runAgent() blocking path with only I/O boundaries
// mocked, the same idiom as tests/agent-turn-timings.test.ts.
//
// Split out from tests/agent-runtime-memoization.test.ts because vi.mock()
// calls are hoisted file-wide: mocking '@/lib/agent-runtime/resolve-agent'
// here (required to drive runAgent() without a real DB) would otherwise
// also shadow that file's REAL resolveAgent() import.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearMemo } from '@/lib/cache/ttl-memo'

vi.mock('@/lib/agent-runtime/invocations', () => ({
  insertInvocationStart: vi.fn().mockResolvedValue('inv-memo-test'),
  updateInvocationEnd: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/agent-runtime/resolve-agent', () => ({
  resolveAgent: vi.fn(),
}))

vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() })),
}))

const getProviderKeyMock = vi.fn().mockResolvedValue('fake-openrouter-key')
vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: (...args: unknown[]) => getProviderKeyMock(...args),
}))

const queryKnowledgeMock = vi.fn().mockResolvedValue("I don't have information about that in my knowledge base.")
vi.mock('@/lib/knowledge/query-knowledge', () => ({
  queryKnowledge: (...args: unknown[]) => queryKnowledgeMock(...args),
}))

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

/**
 * Per-table-aware passthrough: every table behaves like the generic
 * always-empty chain from tests/agent-turn-timings.test.ts EXCEPT
 * `knowledge_sources`, whose `{count}` this test controls directly — that's
 * the exact shape orgHasKnowledgeDocuments() in run-agent.ts reads.
 */
function buildKnowledgeAwareSupabaseMock(knowledgeSourceCount: number) {
  function makeChain(finalValue: { data: unknown; error: unknown; count?: number }): unknown {
    const settled = Promise.resolve(finalValue)
    return new Proxy(settled, {
      get(target, prop, receiver) {
        if (prop in target) {
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return () => makeChain(finalValue)
      },
    })
  }
  return {
    from: (table: string) => {
      if (table === 'knowledge_sources') {
        return { select: () => makeChain({ data: null, error: null, count: knowledgeSourceCount }) }
      }
      return makeChain({ data: null, error: null })
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { runAgent } from '@/lib/agent-runtime'
import { resolveAgent as resolveAgentMocked } from '@/lib/agent-runtime/resolve-agent'
import { createServiceRoleClient as createServiceRoleClientMocked } from '@/lib/supabase/admin'

const RESOLVED_AGENT_NULL_SCOPE = {
  agentId: 'agent-provider-memo',
  orgId: 'org-provider-memo',
  name: 'Provider Memo Agent',
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

describe('resolveLlmProvider() memoisation (60s per org, private to run-agent.ts)', () => {
  beforeEach(() => {
    clearMemo()
    vi.clearAllMocks()
    getProviderKeyMock.mockResolvedValue('fake-openrouter-key')
    vi.mocked(resolveAgentMocked).mockResolvedValue(RESOLVED_AGENT_NULL_SCOPE as never)
    vi.mocked(createServiceRoleClientMocked).mockReturnValue(
      buildKnowledgeAwareSupabaseMock(0) as never,
    )
  })

  it('resolves the provider key once across two invocations for the same org', async () => {
    await runAgent({
      orgId: 'org-provider-memo',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'first turn',
    })
    await runAgent({
      orgId: 'org-provider-memo',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'second turn',
    })

    // getProviderKey is called once for 'openrouter' per uncached
    // resolution; a second invocation within the 60s TTL must not call it
    // again at all.
    expect(getProviderKeyMock).toHaveBeenCalledTimes(1)
  })

  it('never caches a no_llm_key failure — a later invocation retries the lookup', async () => {
    getProviderKeyMock.mockResolvedValue(null) // no org key
    // getPlatformSetting is dynamically imported inside resolveLlmProvider;
    // mock the module so it also resolves to "no key configured".
    vi.doMock('@/lib/platform-settings', () => ({
      getPlatformSetting: vi.fn().mockResolvedValue(null),
    }))

    const first = await runAgent({
      orgId: 'org-provider-memo-fail',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'first turn',
    })
    const second = await runAgent({
      orgId: 'org-provider-memo-fail',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'second turn',
    })

    expect(first.status).toBe('error')
    expect(first.errorDetail).toBe('no_llm_key')
    expect(second.status).toBe('error')
    expect(second.errorDetail).toBe('no_llm_key')
    // Both invocations actually queried the provider key — the failure was
    // never cached and stuck for 60s.
    expect(getProviderKeyMock).toHaveBeenCalledTimes(2)
  })
})

describe('knowledge-base short-circuit: skips queryKnowledge when kb_scope is null and the org has zero knowledge_sources rows', () => {
  beforeEach(() => {
    clearMemo()
    vi.clearAllMocks()
    getProviderKeyMock.mockResolvedValue('fake-openrouter-key')
    vi.mocked(resolveAgentMocked).mockResolvedValue(RESOLVED_AGENT_NULL_SCOPE as never)
  })

  it('never calls queryKnowledge for a null-scope agent when the org has no knowledge_sources rows', async () => {
    vi.mocked(createServiceRoleClientMocked).mockReturnValue(
      buildKnowledgeAwareSupabaseMock(0) as never,
    )

    const result = await runAgent({
      orgId: 'org-kb-empty',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'anything',
    })

    expect(result.status).toBe('success')
    expect(queryKnowledgeMock).not.toHaveBeenCalled()
  })

  it('still calls queryKnowledge for a null-scope agent when the org DOES have knowledge_sources rows', async () => {
    vi.mocked(createServiceRoleClientMocked).mockReturnValue(
      buildKnowledgeAwareSupabaseMock(3) as never,
    )

    const result = await runAgent({
      orgId: 'org-kb-populated',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'anything',
    })

    expect(result.status).toBe('success')
    expect(queryKnowledgeMock).toHaveBeenCalledTimes(1)
  })

  it('memoises "has documents" for 60s — the knowledge_sources table is read only once across two invocations for the same org', async () => {
    const mock = buildKnowledgeAwareSupabaseMock(0)
    const fromSpy = vi.fn(mock.from)
    vi.mocked(createServiceRoleClientMocked).mockReturnValue({ from: fromSpy } as never)

    await runAgent({
      orgId: 'org-kb-cache-check',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'first turn',
    })
    await runAgent({
      orgId: 'org-kb-cache-check',
      agentId: 'agent-provider-memo',
      channel: 'web_widget',
      userMessage: 'second turn',
    })

    const knowledgeSourcesCalls = fromSpy.mock.calls.filter(([table]) => table === 'knowledge_sources')
    expect(knowledgeSourcesCalls).toHaveLength(1)
  })
})
