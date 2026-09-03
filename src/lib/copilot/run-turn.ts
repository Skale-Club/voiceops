// Core multi-turn execution. Mirrors the flow builder Phase C loop, with audit
// log persistence (copilot_runs + copilot_tool_calls) and message persistence
// to copilot_messages using the parts-jsonb pattern.

import type OpenAI from 'openai'
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

import { resolveCopilotProvider, estimateCostUsd, type ProviderChoice } from './resolve-provider'
import { createOpenRouterClient } from '@/lib/llm/openrouter'
import { getActiveTools } from './tools'
import { dispatchCopilotTool } from './dispatch'
import { buildSystemPrompt } from './system-prompt'
import type { ToolContext } from './tools/types'
import { isBillingEnforced } from '@/lib/billing/config'
import { meterDebit } from '@/lib/billing/credits'

const MAX_TURNS = 12

export interface MessagePart {
  type: 'text' | 'tool_call' | 'image'
  text?: string
  url?: string           // for type='image': base64 data URL
  tool_name?: string
  input?: Record<string, unknown>
  output?: unknown
  error?: string
  success?: boolean
}

export interface RunTurnResult {
  runId: string
  parts: MessagePart[]
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

interface RunTurnInput {
  supabase: SupabaseClient<Database>
  orgId: string
  userId: string
  conversationId: string
  userMessage: string
  images?: string[]      // base64 data URLs
  writeMode: boolean
  currentEntity?: { type: 'contact' | 'account' | 'opportunity'; id: string } | null
  history: Array<{ role: 'user' | 'assistant'; parts: MessagePart[] }>
  /** Whether this turn's cost debits the credit wallet. Defaults to true; set
   *  false for platform-admin/internal turns that must not consume credits. */
  meterCredits?: boolean
  /** Org-level model overrides (Settings → Copilot model tier). */
  modelOverrides?: { openrouterModel?: string; anthropicModel?: string }
  /** Called as each part (text block / finished tool call) is produced, so
   *  callers can stream progress to the client while the turn runs. */
  onPart?: (part: MessagePart) => void
}

export async function runCopilotTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const provider = await resolveCopilotProvider(input.orgId, input.modelOverrides)
  if (!provider) {
    throw new Error('ai_not_configured: connect OpenRouter under Integrations')
  }

  // Open the audit run record up front so we can fill it in as we go.
  const { data: runRow, error: runErr } = await input.supabase
    .from('copilot_runs')
    .insert({
      org_id: input.orgId,
      conversation_id: input.conversationId,
      provider: provider.kind,
      model: provider.model,
      status: 'running' as const,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (runErr || !runRow) throw new Error(`run_audit_init_failed: ${runErr?.message ?? 'unknown'}`)
  const runId = runRow.id

  const activeTools = getActiveTools(input.writeMode)
  const toolDefs = Object.values(activeTools).map((t) => t.definition)
  const system = buildSystemPrompt({
    writeMode: input.writeMode,
    currentEntity: input.currentEntity,
  })

  const toolCtx: ToolContext = {
    supabase: input.supabase,
    orgId: input.orgId,
    userId: input.userId,
    conversationId: input.conversationId,
  }

  const parts: MessagePart[] = []
  let inputTokens = 0
  let outputTokens = 0

  try {
    const loopArgs: LoopArgs = {
      provider,
      system,
      history: input.history,
      userMessage: input.userMessage,
      images: input.images,
      toolDefs,
      toolCtx,
      runId,
      supabase: input.supabase,
      parts,
      onPart: input.onPart,
    }
    // Phase 132 (MODEL-01/02): OpenRouter only — resolveCopilotProvider()
    // never returns 'anthropic' anymore, so the loopAnthropic() fallback
    // branch this used to dispatch to has been removed.
    const usage = await loopOpenRouter(loopArgs)
    inputTokens = usage.inputTokens
    outputTokens = usage.outputTokens

    const costUsd = estimateCostUsd(provider.model, inputTokens, outputTokens)
    await input.supabase
      .from('copilot_runs')
      .update({
        status: 'succeeded' as const,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        ended_at: new Date().toISOString(),
      })
      .eq('id', runId)

    // Bill the Copilot credit wallet for the cost just incurred (enforcement only,
    // and never for unmetered turns like platform admins — meterCredits === false).
    // Fails open (see meterDebit) — credit accounting never blocks the response.
    if (isBillingEnforced() && input.meterCredits !== false) {
      await meterDebit(input.orgId, 'copilot_turn', costUsd, runId)
    }

    return {
      runId,
      parts,
      provider: provider.kind,
      model: provider.model,
      inputTokens,
      outputTokens,
      costUsd,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await input.supabase
      .from('copilot_runs')
      .update({
        status: 'failed' as const,
        error: msg,
        ended_at: new Date().toISOString(),
      })
      .eq('id', runId)
    throw err
  }
}

// ─── OpenRouter path ─────────────────────────────────────────────────────────

interface LoopArgs {
  provider: ProviderChoice
  system: string
  history: Array<{ role: 'user' | 'assistant'; parts: MessagePart[] }>
  userMessage: string
  images?: string[]
  toolDefs: Anthropic.Tool[]
  toolCtx: ToolContext
  runId: string
  supabase: SupabaseClient<Database>
  parts: MessagePart[]
  onPart?: (part: MessagePart) => void
}

function emitPart(args: LoopArgs, part: MessagePart) {
  args.parts.push(part)
  args.onPart?.(part)
}

// ─── History serialization ───────────────────────────────────────────────────
//
// Prior turns are replayed as plain text, but tool calls must survive the
// round-trip: without them the model can't see IDs or data it already fetched
// and is forced to re-query (or worse, guess). Outputs are truncated so a long
// conversation doesn't blow up the context window.

const HISTORY_TOOL_INPUT_MAX = 400
const HISTORY_TOOL_OUTPUT_MAX = 1200

function truncatedJson(value: unknown, max: number): string {
  let s: string
  try {
    s = JSON.stringify(value) ?? 'null'
  } catch {
    s = String(value)
  }
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s
}

function partsToHistoryText(parts: MessagePart[]): string {
  const chunks: string[] = []
  for (const p of parts) {
    if (p.type === 'text' && p.text) chunks.push(p.text)
    if (p.type === 'tool_call' && p.tool_name) {
      const outcome = p.success === false
        ? `error: ${p.error ?? 'unknown'}`
        : truncatedJson(p.output ?? null, HISTORY_TOOL_OUTPUT_MAX)
      chunks.push(
        `[tool_call ${p.tool_name} input=${truncatedJson(p.input ?? {}, HISTORY_TOOL_INPUT_MAX)} → ${outcome}]`,
      )
    }
  }
  return chunks.join('\n')
}

function toOpenAiTools(defs: Anthropic.Tool[]): OpenAI.ChatCompletionTool[] {
  return defs.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }))
}

function historyToOpenAiMessages(
  history: Array<{ role: 'user' | 'assistant'; parts: MessagePart[] }>,
): OpenAI.ChatCompletionMessageParam[] {
  const msgs: OpenAI.ChatCompletionMessageParam[] = []
  for (const m of history) {
    const text = partsToHistoryText(m.parts)
    if (text) msgs.push({ role: m.role, content: text })
  }
  return msgs
}

async function loopOpenRouter(args: LoopArgs): Promise<{ inputTokens: number; outputTokens: number }> {
  const client = createOpenRouterClient(args.provider.apiKey)

  // Build the first user message. If images are attached, use multipart content.
  const firstUserContent: OpenAI.ChatCompletionContentPart[] = [
    { type: 'text', text: args.userMessage },
    ...(args.images ?? []).map((dataUrl): OpenAI.ChatCompletionContentPart => ({
      type: 'image_url',
      image_url: { url: dataUrl, detail: 'auto' },
    })),
  ]

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: args.system },
    ...historyToOpenAiMessages(args.history),
    {
      role: 'user',
      content: firstUserContent.length === 1 ? args.userMessage : firstUserContent,
    },
  ]

  let inputTokens = 0
  let outputTokens = 0

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const completion = await client.chat.completions.create({
      model: args.provider.model,
      max_tokens: 4096,
      messages,
      tools: toOpenAiTools(args.toolDefs),
    })

    inputTokens += completion.usage?.prompt_tokens ?? 0
    outputTokens += completion.usage?.completion_tokens ?? 0

    const choice = completion.choices[0]
    if (!choice) break
    const msg = choice.message

    if (msg.content) {
      emitPart(args, { type: 'text', text: msg.content })
    }

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
      const { result, durationMs } = await dispatchCopilotTool(tc.function.name, parsed, args.toolCtx)

      emitPart(args, {
        type: 'tool_call',
        tool_name: tc.function.name,
        input: parsed,
        output: result.data,
        error: result.error,
        success: result.success,
      })

      await args.supabase.from('copilot_tool_calls').insert({
        run_id: args.runId,
        tool_name: tc.function.name,
        input: parsed,
        output: (result.data ?? null) as Record<string, unknown> | null,
        error: result.error ?? null,
        status: result.success ? ('succeeded' as const) : ('failed' as const),
        duration_ms: durationMs,
      })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result.success
          ? { ok: true, data: result.data }
          : { ok: false, error: result.error }),
      })
    }

    if (choice.finish_reason === 'stop') break
  }

  return { inputTokens, outputTokens }
}
