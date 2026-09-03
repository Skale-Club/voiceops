import { NextRequest } from 'next/server'
import { z } from 'zod'

import { captureApiError } from '@/lib/api-error'
import { createClient, getUser } from '@/lib/supabase/server'
import { createMemory } from '@/lib/ads/journey-db'
import type { AdsMemoryType } from '@/lib/ads/journey-db'
import { resolveOpenRouterCredential, createOpenRouterClient } from '@/lib/llm/openrouter'

export const runtime = 'nodejs'

/**
 * Extraction is a cheap background summarisation — override per deployment.
 * Model id is OpenRouter's vendor-prefixed form (Phase 132 MODEL-01/02: every
 * generative call goes through OpenRouter, tenant key first, platform key
 * second — no direct Anthropic path).
 */
const MEMORY_EXTRACTION_MODEL = process.env.ADS_MEMORY_MODEL ?? 'anthropic/claude-haiku-4.5'

const MEMORY_TYPES = ['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal'] as const

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

const ExtractSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(2),
  platform: z.enum(['meta', 'google']).optional(),
})

// POST /api/ads/memories/extract
// Receives a completed conversation and uses Claude to extract 0-3 memories.
// Saves them as 'needs_review' and returns the proposed list.
export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = ExtractSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const { messages, platform } = parsed.data

  // Only extract from conversations that have meaningful content
  const userMessages = messages.filter((m) => m.role === 'user')
  const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content.length > 50)
  if (userMessages.length < 1 || assistantMessages.length < 1) {
    return Response.json({ memories: [] })
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  let extracted: Array<{
    type: string
    title: string
    content: string
    campaign_name?: string
    confidence: number
  }> = []

  try {
    const credential = await resolveOpenRouterCredential(orgId as string, supabase)
    const client = createOpenRouterClient(credential.apiKey)

    // Structured tool use rather than "return only JSON" plus a regex: the
    // schema is enforced by the API, so a stray sentence before the object,
    // a code fence, or a nested brace can't silently produce zero memories
    // (the old `/\{[\s\S]*\}/` match was greedy and would swallow prose too).
    const response = await client.chat.completions.create({
      model: MEMORY_EXTRACTION_MODEL,
      max_tokens: 1024,
      tools: [
        {
          type: 'function',
          function: {
            name: 'record_memories',
            description: 'Record the memories worth keeping from this conversation.',
            parameters: {
              type: 'object',
              properties: {
                memories: {
                  type: 'array',
                  maxItems: 3,
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: MEMORY_TYPES },
                      title: { type: 'string', description: 'Short title, max 80 characters' },
                      content: { type: 'string', description: 'Concise description, max 300 characters' },
                      campaign_name: { type: 'string', description: 'Only when the memory is about one specific campaign' },
                      confidence: { type: 'integer', minimum: 1, maximum: 5 },
                    },
                    required: ['type', 'title', 'content', 'confidence'],
                  },
                },
              },
              required: ['memories'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'record_memories' } },
      messages: [
        {
          role: 'user',
          content: `Extract 0-3 memories worth keeping from this ads management conversation.

Keep only things that are genuinely useful context for a future session: strategic decisions made, performance insights discovered, plans established, risks identified, or goals set. Skip small talk, restatements of tool output, and anything a reader would already know. Returning an empty list is the right answer more often than not.

Conversation:
${conversationText.slice(0, 6000)}`,
        },
      ],
    })

    const toolCall = response.choices[0]?.message?.tool_calls?.find(
      (tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function',
    )
    if (toolCall) {
      try {
        const input = JSON.parse(toolCall.function.arguments) as { memories?: unknown[] }
        if (Array.isArray(input.memories)) {
          extracted = input.memories.slice(0, 3) as typeof extracted
        }
      } catch {
        // Malformed tool-call JSON — treat as zero extracted memories.
      }
    }
  } catch (e) {
    // Extraction is a nice-to-have on top of a conversation that already
    // succeeded — never fail the caller, but don't swallow the reason either.
    captureApiError(e, { route: 'ads/memories/extract', orgId })
    console.error('[ads/memories/extract] extraction failed:', e instanceof Error ? e.message : e)
    return Response.json({ memories: [] })
  }

  const created: Array<{ id: string; title: string; type: string }> = []

  for (const m of extracted) {
    if (!(MEMORY_TYPES as readonly string[]).includes(m.type)) continue
    if (!m.title?.trim() || !m.content?.trim()) continue

    const id = await createMemory({
      orgId: orgId as string,
      type: m.type as AdsMemoryType,
      source: 'chat',
      platform,
      title: m.title.trim().slice(0, 200),
      content: m.content.trim().slice(0, 2000),
      campaignName: m.campaign_name?.trim(),
      confidence: Math.min(5, Math.max(1, Math.round(m.confidence ?? 3))),
      proposed: true,
      status: 'needs_review',
    })

    if (id) created.push({ id, title: m.title, type: m.type })
  }

  return Response.json({ memories: created })
}
