// src/lib/knowledge/query-knowledge.ts
// Hot path: LangChain SupabaseVectorStore similarity search → synthesize answer
// AI provider resolved via shared resolver (Phase 132 MODEL-01/02: OpenRouter
// only — org key first, platform key second; no direct-Anthropic fallback).
// Budget: ~50ms embed + ~50ms search + ~200ms synthesis = ~300ms (within 500ms Vapi limit)
//
// Q4: Similarity threshold (default 0.5) — low-quality chunks are filtered out
//     before synthesis, reducing hallucinations on sparse KB hits.
// Q5: rawMode option — skips synthesis and returns formatted chunks with source
//     citations. Callers that inject the KB result into a system prompt (e.g.
//     run-agent.ts) should set rawMode:true so the agent LLM has full context.
//     Voice/tool paths that return the KB answer directly (execute-action.ts)
//     keep rawMode:false (default) for synthesized brevity.
//
// NOTE: the embedding client below (OpenAIEmbeddings) is a separate, sanctioned
// exception (132-PROVIDER-DRIFT-INVENTORY.md) — it talks to a real embeddings
// endpoint and its model/vector contract is intentionally left unchanged.

import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'
import { OpenAIEmbeddings } from '@langchain/openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { resolveCopilotProvider } from '@/lib/copilot/resolve-provider'
import { createOpenRouterClient } from '@/lib/llm/openrouter'
import { createLogger } from '@/lib/obs/logger'

const FALLBACK_RESPONSE = "I don't have information about that in my knowledge base."

// Q4: Minimum cosine similarity score for a chunk to be included.
// Supabase returns values in [0, 1] where 1 = identical.
const DEFAULT_SIMILARITY_THRESHOLD = 0.5

export type QueryKnowledgeOpts = {
  /**
   * When true, skips LLM synthesis and returns raw chunks formatted with
   * source metadata. Ideal for system-prompt injection where the downstream
   * agent LLM can reason directly over the full chunk text.  (Q5)
   */
  rawMode?: boolean
  /**
   * Minimum cosine similarity score [0–1] for a chunk to be included.
   * Chunks below this threshold are discarded before synthesis or injection.
   * Defaults to 0.5.  (Q4)
   */
  threshold?: number
  /**
   * Phase 132 (KNOW-01/KNOW-02): the calling agent's RESOLVED kb_scope
   * (ResolvedAgent.kbScope, from resolveAgent() — agents.kb_scope). Callers
   * MUST pass only resolveAgent()'s output here; never a scope derived from
   * a handoff payload or channel/ingress metadata (132-CONTEXT.md
   * "Knowledge scope" — trusted server-side context only).
   *
   *   - undefined/null: full-organization knowledge (legacy behavior).
   *   - []             : automatic retrieval is disabled entirely for this
   *                      agent — no embedding/search call is made at all.
   *   - non-empty      : retrieval is filtered to chunks whose
   *                      `knowledge_source_id` metadata is one of these
   *                      tenant-owned knowledge_sources ids.
   */
  kbScope?: string[] | null
}

export async function queryKnowledge(
  query: string,
  organizationId: string,
  supabase: SupabaseClient<Database>,
  opts?: QueryKnowledgeOpts,
): Promise<string> {
  const log = createLogger({ organizationId })
  const rawMode = opts?.rawMode ?? false
  const threshold = opts?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD
  const kbScope = opts?.kbScope ?? null

  try {
    if (!query.trim()) return FALLBACK_RESPONSE

    // KNOW-01: an explicit empty scope means automatic retrieval is disabled
    // for this agent — return the fallback without ever calling the
    // embedding/search provider. Distinct from `null` (full-org, legacy).
    if (kbScope !== null && kbScope.length === 0) return FALLBACK_RESPONSE

    // Step 1: Fetch OpenAI key for embedding
    const openaiKey = await getProviderKey('openai', organizationId, supabase)
    if (!openaiKey) return FALLBACK_RESPONSE

    // Step 2: Build LangChain SupabaseVectorStore with org-scoped filter
    const embeddings = new OpenAIEmbeddings({
      apiKey: openaiKey,
      model: 'text-embedding-3-small',
    })

    // LangChain's SupabaseVectorStore types against an untyped SupabaseClient,
    // but it only uses .from()/.rpc() at runtime | both work with our typed client.
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabase as unknown as SupabaseClient,
      tableName: 'documents',
      queryName: 'match_documents',
    })

    // KNOW-02: `match_documents`'s filter uses JSONB containment (`@>`), which
    // cannot express "one of several source ids" in a single call. When a
    // non-empty scope is active, over-fetch org-scoped candidates and filter
    // to tenant-owned scoped sources in-process, THEN apply the same top-5 /
    // threshold contract as the unscoped path.
    const scopeSet = kbScope !== null && kbScope.length > 0 ? new Set(kbScope) : null
    const fetchCount = scopeSet ? Math.max(20, scopeSet.size * 4) : 5

    // Step 3: Similarity search with scores — Q4 threshold filtering (~100ms)
    const rawResults = await vectorStore.similaritySearchWithScore(query.trim(), fetchCount, {
      org_id: organizationId,
    })

    // KNOW-02: filter to tenant-owned scoped knowledge_sources before
    // applying the threshold + top-5 cap, so scoping never leaks a chunk
    // from an out-of-scope (or cross-tenant) source.
    const scopedResults = scopeSet
      ? rawResults.filter(([doc]) => {
          const sourceId = (doc.metadata as Record<string, unknown> | undefined)?.knowledge_source_id
          return typeof sourceId === 'string' && scopeSet.has(sourceId)
        })
      : rawResults

    // Q4: Discard chunks below threshold, then cap to the top 5 (unchanged contract).
    const results = scopedResults.filter(([, score]) => score >= threshold).slice(0, 5)

    if (results.length === 0) return FALLBACK_RESPONSE

    // Q5: rawMode — return formatted chunks with source citations
    if (rawMode) {
      const chunks = results.map(([doc, score], i) => {
        const source = (doc.metadata as Record<string, unknown>)?.source
          ?? (doc.metadata as Record<string, unknown>)?.file_name
          ?? `chunk-${i + 1}`
        return `[Source: ${source} | score: ${score.toFixed(3)}]\n${doc.pageContent}`
      })
      return chunks.join('\n\n---\n\n')
    }

    // Step 4: Synthesize answer | OpenRouter only, org key first / platform
    // key second (Phase 132 MODEL-01/02 — no direct-Anthropic fallback) (~200ms)
    const context = results.map(([doc]) => doc.pageContent).join('\n\n---\n\n')

    const synthesisPrompt = `Answer the following question using ONLY the provided context. Be concise | 2-3 sentences maximum. If the context does not contain the answer, say you don't have that information.\n\nContext:\n${context}\n\nQuestion: ${query}`

    // Hot path: prefer Haiku for sub-500ms latency.
    const provider = await resolveCopilotProvider(organizationId, {
      openrouterModel: 'anthropic/claude-haiku-4-5',
    })
    if (!provider) return FALLBACK_RESPONSE

    const client = createOpenRouterClient(provider.apiKey)
    const completion = await client.chat.completions.create({
      model: provider.model,
      max_tokens: 256,
      messages: [{ role: 'user', content: synthesisPrompt }],
    })
    return completion.choices[0]?.message?.content ?? FALLBACK_RESPONSE

  } catch (err) {
    log.error('query_knowledge_failed', { error: (err as Error).message })
    return FALLBACK_RESPONSE
  }
}
