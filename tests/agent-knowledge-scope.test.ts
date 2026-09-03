// tests/agent-knowledge-scope.test.ts
// Phase 132 Plan 03 (KNOW-01): kb_scope enforcement at retrieval time.
//
// 132-CONTEXT.md "Knowledge scope" defines three explicit states, enforced
// IDENTICALLY in both the blocking and streaming runtime paths:
//   - null            : full-organization knowledge (legacy behavior)
//   - []              : automatic retrieval is disabled entirely
//   - non-empty array : retrieval is filtered to only those tenant-owned
//                       knowledge_sources ids
//
// queryKnowledge() must never accept a scope from a handoff payload or
// channel/ingress metadata — only resolveAgent()'s resolved ResolvedAgent.kbScope.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const similaritySearchWithScore = vi.fn()

vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: vi.fn().mockResolvedValue('fake-openai-key'),
}))
vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: vi.fn().mockImplementation(function OpenAIEmbeddings() {
    return {}
  }),
}))
vi.mock('@langchain/community/vectorstores/supabase', () => ({
  SupabaseVectorStore: vi.fn().mockImplementation(function SupabaseVectorStore() {
    return { similaritySearchWithScore }
  }),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import { queryKnowledge } from '@/lib/knowledge/query-knowledge'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

const FALLBACK = "I don't have information about that in my knowledge base."

function chunk(content: string, knowledgeSourceId: string, score: number) {
  return [
    { pageContent: content, metadata: { org_id: 'org-1', knowledge_source_id: knowledgeSourceId } },
    score,
  ] as const
}

// queryKnowledge only touches `supabase` via getProviderKey (mocked above),
// so an opaque object is a valid stand-in for the typed client parameter.
const fakeSupabase = {} as Parameters<typeof queryKnowledge>[2]

describe('queryKnowledge kb_scope enforcement (KNOW-01)', () => {
  beforeEach(() => {
    similaritySearchWithScore.mockReset()
    vi.mocked(getProviderKey).mockClear()
    vi.mocked(getProviderKey).mockResolvedValue('fake-openai-key')
  })

  it('null scope: full-organization retrieval — legacy behavior, no filtering applied', async () => {
    similaritySearchWithScore.mockResolvedValue([
      chunk('chunk from source A', 'src-a', 0.9),
      chunk('chunk from source B', 'src-b', 0.8),
    ])
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: null })
    expect(result).toContain('chunk from source A')
    expect(result).toContain('chunk from source B')
    // Unscoped requests keep the legacy top-5 fetch contract.
    expect(similaritySearchWithScore).toHaveBeenCalledWith('question', 5, { org_id: 'org-1' })
  })

  it('undefined scope behaves identically to null (kbScope omitted entirely)', async () => {
    similaritySearchWithScore.mockResolvedValue([chunk('chunk', 'src-a', 0.9)])
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true })
    expect(result).toContain('chunk')
    expect(similaritySearchWithScore).toHaveBeenCalledWith('question', 5, { org_id: 'org-1' })
  })

  it('empty array scope: disables automatic retrieval — never calls the embedding/search provider', async () => {
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: [] })
    expect(result).toBe(FALLBACK)
    expect(getProviderKey).not.toHaveBeenCalled()
    expect(similaritySearchWithScore).not.toHaveBeenCalled()
  })

  it('non-empty scope: filters retrieval to only the tenant-owned scoped sources', async () => {
    similaritySearchWithScore.mockResolvedValue([
      chunk('in-scope chunk', 'src-allowed', 0.95),
      chunk('out-of-scope chunk', 'src-other', 0.95),
    ])
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, {
      rawMode: true,
      kbScope: ['src-allowed'],
    })
    expect(result).toContain('in-scope chunk')
    expect(result).not.toContain('out-of-scope chunk')
  })

  it('non-empty scope excludes an out-of-scope source even at a higher similarity score', async () => {
    similaritySearchWithScore.mockResolvedValue([
      chunk('leak attempt from a source not in scope', 'src-not-mine', 0.99),
      chunk('my own scoped content', 'src-mine', 0.6),
    ])
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: ['src-mine'] })
    expect(result).toContain('my own scoped content')
    expect(result).not.toContain('leak attempt')
  })

  it('non-empty scope over-fetches beyond 5 candidates so scope filtering does not starve results', async () => {
    similaritySearchWithScore.mockResolvedValue([])
    await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: ['src-a'] })
    const [, fetchCount] = similaritySearchWithScore.mock.calls[0]
    expect(fetchCount).toBeGreaterThan(5)
  })

  it('returns the fallback when the scope excludes every retrieved chunk', async () => {
    similaritySearchWithScore.mockResolvedValue([chunk('irrelevant to this agent', 'src-other', 0.99)])
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: ['src-mine'] })
    expect(result).toBe(FALLBACK)
  })

  it('caps scoped results to the same top-5 contract as unscoped retrieval', async () => {
    // "payload-N" (not "chunk-N") avoids colliding with the rawMode Source
    // citation's own `chunk-${i + 1}` fallback label when metadata has no
    // `source`/`file_name` field, keeping the match count unambiguous.
    const many = Array.from({ length: 8 }, (_, i) => chunk(`payload-${i}`, 'src-a', 0.9 - i * 0.01))
    similaritySearchWithScore.mockResolvedValue(many)
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: ['src-a'] })
    const count = (result.match(/payload-/g) ?? []).length
    expect(count).toBe(5)
  })

  it('ignores a chunk with a missing/malformed knowledge_source_id under a non-empty scope (fail closed)', async () => {
    similaritySearchWithScore.mockResolvedValue([
      [{ pageContent: 'no source id at all', metadata: { org_id: 'org-1' } }, 0.99] as const,
      chunk('properly scoped content', 'src-mine', 0.6),
    ])
    const result = await queryKnowledge('question', 'org-1', fakeSupabase, { rawMode: true, kbScope: ['src-mine'] })
    expect(result).toContain('properly scoped content')
    expect(result).not.toContain('no source id at all')
  })
})

// ---------------------------------------------------------------------------
// Wiring contract: run-agent.ts must source kbScope ONLY from resolveAgent()'s
// output (ResolvedAgent.kbScope), identically in both runtime paths, and must
// never accept a scope from a handoff payload or channel/ingress metadata.
// ---------------------------------------------------------------------------

describe('run-agent.ts kb_scope wiring contract (KNOW-01)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/agent-runtime/run-agent.ts'), 'utf8')
  const kbScopeCallSites = [...source.matchAll(/queryKnowledge\([^)]*\)/gs)]

  it('calls queryKnowledge with kbScope in both the blocking and streaming paths', () => {
    expect(kbScopeCallSites.length).toBe(2)
    for (const [call] of kbScopeCallSites) {
      expect(call).toContain('kbScope: resolvedAgent.kbScope')
    }
  })

  it('never derives kbScope from a handoff payload, opts, or ingress/channel metadata', () => {
    expect(source).not.toMatch(/kbScope:\s*handoffArgs/)
    expect(source).not.toMatch(/kbScope:\s*opts\./)
    expect(source).not.toMatch(/kbScope:\s*args\./)
  })
})
