// src/lib/knowledge/query-knowledge.ts
// Hot path: embed query → tenant-scoped similarity search → synthesize answer
// Budget: ~50ms embed + ~50ms RPC + ~200ms haiku = ~300ms (within 500ms Vapi limit)

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const FALLBACK_RESPONSE = "I don't have information about that in my knowledge base."

// Module-level clients to avoid reinstantiation on hot path
let openaiClient: OpenAI | null = null
let anthropicClient: Anthropic | null = null

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

export async function queryKnowledge(
  query: string,
  organizationId: string,
  supabase: SupabaseClient<Database>
): Promise<string> {
  try {
    if (!query.trim()) return FALLBACK_RESPONSE

    // Step 1: Embed the query (~50ms)
    const openai = getOpenAI()
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query.trim(),
      encoding_format: 'float',
    })
    const queryEmbedding = embeddingResponse.data[0].embedding

    // Step 2: Tenant-scoped similarity search via RPC (~50ms)
    const { data: chunks, error: rpcError } = await supabase.rpc('match_document_chunks', {
      p_organization_id: organizationId,
      query_embedding: queryEmbedding,
      match_count: 5,
      match_threshold: 0.7,
    })

    if (rpcError) {
      console.error('[queryKnowledge] RPC error:', rpcError.message)
      return FALLBACK_RESPONSE
    }

    if (!chunks || chunks.length === 0) {
      return FALLBACK_RESPONSE
    }

    // Step 3: Synthesize answer from top chunks (~200ms — haiku is fast)
    const context = chunks
      .map((c: { content: string }) => c.content)
      .join('\n\n---\n\n')

    const anthropic = getAnthropic()
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `Answer the following question using ONLY the provided context. Be concise — 2-3 sentences maximum. If the context does not contain the answer, say you don't have that information.\n\nContext:\n${context}\n\nQuestion: ${query}`,
        },
      ],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    return textBlock?.text ?? FALLBACK_RESPONSE

  } catch (err) {
    // Never let knowledge query crash the Vapi webhook response
    console.error('[queryKnowledge] Error:', err)
    return FALLBACK_RESPONSE
  }
}
