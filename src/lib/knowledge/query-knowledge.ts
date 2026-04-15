// src/lib/knowledge/query-knowledge.ts
// Hot path: LangChain SupabaseVectorStore similarity search → synthesize answer
// Keys fetched from DB integrations table (not env vars) — supports OpenRouter + Anthropic.
// Budget: ~50ms embed + ~50ms search + ~200ms synthesis = ~300ms (within 500ms Vapi limit)

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'
import { OpenAIEmbeddings } from '@langchain/openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

const FALLBACK_RESPONSE = "I don't have information about that in my knowledge base."

export async function queryKnowledge(
  query: string,
  organizationId: string,
  supabase: SupabaseClient<Database>
): Promise<string> {
  try {
    if (!query.trim()) return FALLBACK_RESPONSE

    // Step 1: Fetch OpenAI key for embedding
    const openaiKey = await getProviderKey('openai', organizationId, supabase)
    if (!openaiKey) return FALLBACK_RESPONSE

    // Step 2: Build LangChain SupabaseVectorStore with org-scoped filter
    const embeddings = new OpenAIEmbeddings({
      apiKey: openaiKey,
      model: 'text-embedding-3-small',
    })

    // LangChain's SupabaseVectorStore types against an untyped SupabaseClient,
    // but it only uses .from()/.rpc() at runtime — both work with our typed client.
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabase as unknown as SupabaseClient,
      tableName: 'documents',
      queryName: 'match_documents',
    })

    // Step 3: Similarity search filtered to this org (~100ms)
    const results = await vectorStore.similaritySearch(query.trim(), 5, {
      org_id: organizationId,
    })

    if (results.length === 0) return FALLBACK_RESPONSE

    // Step 4: Synthesize answer — prefer OpenRouter, fall back to Anthropic (~200ms)
    const context = results.map((doc) => doc.pageContent).join('\n\n---\n\n')

    const synthesisPrompt = `Answer the following question using ONLY the provided context. Be concise — 2-3 sentences maximum. If the context does not contain the answer, say you don't have that information.\n\nContext:\n${context}\n\nQuestion: ${query}`

    const openrouterKey = await getProviderKey('openrouter', organizationId, supabase)
    if (openrouterKey) {
      const openrouterClient = new OpenAI({
        apiKey: openrouterKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      const completion = await openrouterClient.chat.completions.create({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 256,
        messages: [{ role: 'user', content: synthesisPrompt }],
      })
      return completion.choices[0]?.message?.content ?? FALLBACK_RESPONSE
    }

    const anthropicKey = await getProviderKey('anthropic', organizationId, supabase)
    if (!anthropicKey) return FALLBACK_RESPONSE

    const anthropicClient = new Anthropic({ apiKey: anthropicKey })
    const message = await anthropicClient.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 256,
      messages: [{ role: 'user', content: synthesisPrompt }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    return textBlock?.text ?? FALLBACK_RESPONSE

  } catch (err) {
    console.error('[queryKnowledge] Error:', err)
    return FALLBACK_RESPONSE
  }
}
