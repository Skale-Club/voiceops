'use server'

import type OpenAI from 'openai'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolveCopilotProvider } from '@/lib/copilot/resolve-provider'
import { createOpenRouterClient } from '@/lib/llm/openrouter'
import { FlowDefinition } from '@/lib/flows/schema'
import { AI_BUILDER_TOOLS, dispatchTool } from '@/lib/flows/ai-tools'

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

const SYSTEM_PROMPT = `You are an expert automation builder for Xphere. You build visual workflow graphs by calling tools that mutate a canvas.

CANVAS MODEL:
- A flow is a directed graph: nodes connected by edges.
- Node types: trigger (start), action (call integration), condition (if/else branch), wait (sleep or wait for event), agent (AI loop), end (terminate).
- Every flow needs exactly ONE trigger node. Most flows benefit from an end node.
- Linear sequences are preferred | most automations are: trigger → 2-5 actions → end.

RULES:
1. Before mutating, call list_nodes to see the current state.
2. Place new nodes with sensible y-coordinates (top-to-bottom: trigger ~50, then +120 per row).
3. Use x ~250 for the main column. Branch nodes (condition) put left/right children at x=100/400.
4. Always set a clear, short label on each node (e.g. "Create contact", "Send welcome WhatsApp").
5. Connect nodes after creating them. Use source_handle "true"/"false" for condition branches.
6. End with one end node when the flow has a clear termination.
7. Don't over-engineer. Linear is fine. Add branching only when the user asks for it.
8. After mutations, briefly explain what you built in plain language.

ACTION TYPES available (set as data.action_type on action nodes):
http_request, send_whatsapp, send_email, create_contact, create_task, create_note,
update_pipeline_stage, query_knowledge, execute_flow, log.

For configurable params, populate the action's data.config with the right shape.
Use {{ trigger.payload.field }} or {{ steps.node_id.output.field }} for variable interpolation.`

// Provider resolution is shared with the rest of the AI surfaces — see
// src/lib/copilot/resolve-provider.ts. OpenRouter (org key or env) is preferred.

// ─── Tool schema conversion: Anthropic → OpenAI (OpenRouter) ─────────────────

function toOpenAiTools(): OpenAI.ChatCompletionTool[] {
  return AI_BUILDER_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }))
}

// ─── OpenRouter path (OpenAI-compatible, tool-calling) ───────────────────────

async function buildViaOpenRouter(
  apiKey: string,
  model: string,
  userPrompt: string,
  workingDef: FlowDefinition,
): Promise<{ summary: string }> {
  const client = createOpenRouterClient(apiKey)

  type Msg = OpenAI.ChatCompletionMessageParam
  const messages: Msg[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let summary = ''
  const MAX_TURNS = 10

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages,
      tools: toOpenAiTools(),
    })

    const choice = completion.choices[0]
    if (!choice) break
    const msg = choice.message
    if (msg.content) summary += msg.content

    const toolCalls = (msg.tool_calls ?? []).filter(
      (tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === 'function',
    )
    if (toolCalls.length === 0) break

    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    })

    for (const tc of toolCalls) {
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
      const dispatch = dispatchTool(tc.function.name, parsed, workingDef)
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: dispatch.success
          ? JSON.stringify({ ok: true, data: dispatch.data })
          : JSON.stringify({ ok: false, error: dispatch.error }),
      })
    }

    if (choice.finish_reason === 'stop') break
  }

  return { summary }
}

// ─── Public action ───────────────────────────────────────────────────────────

export async function aiBuildFlow(input: {
  prompt: string
  currentDefinition: FlowDefinition
}): Promise<ActionResult<{ definition: FlowDefinition; summary: string; provider: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Phase 132 (MODEL-01/02): every generative call goes through OpenRouter —
  // tenant key first, platform key second. resolveCopilotProvider() only
  // ever returns 'openrouter' | null now (the direct-Anthropic fallback was
  // removed there); the ternary this used to require is gone.
  const provider = await resolveCopilotProvider(orgId as string)
  if (!provider) {
    return {
      ok: false,
      error: 'ai_not_configured: connect OpenRouter under Integrations',
    }
  }

  const workingDef: FlowDefinition = JSON.parse(JSON.stringify(input.currentDefinition))

  try {
    const { summary } = await buildViaOpenRouter(provider.apiKey, provider.model, input.prompt, workingDef)

    return {
      ok: true,
      data: { definition: workingDef, summary: summary.trim(), provider: provider.kind },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `ai_error: ${msg}` }
  }
}
