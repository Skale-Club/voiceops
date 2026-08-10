// src/lib/prospects/qualify-llm.ts
//
// LLM-backed qualification + personalized opener generation for
// suggestQualification() in src/app/(dashboard)/prospects/actions.ts.
//
// Pattern B (canonical, 2026-07) — mirrors the provider resolution and model
// construction in src/lib/agent-runtime/run-agent.ts (org OpenRouter ->
// platform OpenRouter -> org Anthropic -> platform Anthropic), reuses
// COPILOT_MODEL_TIERS.fast (src/lib/copilot/resolve-provider.ts) for the
// cheap/fast model tier instead of hardcoding a new model literal, and
// mirrors the fenced-JSON extraction pattern from
// src/app/api/email-templates/generate/route.ts. No generateObject/zod here —
// this codebase's LLM JSON contracts are all prompt + parse + imperative
// validation.
//
// This module never touches prospect data or the authenticated request
// client — callers (actions.ts) fetch prospect + website-analysis signals
// themselves (RLS-scoped) and pass them in. Only provider-key lookups here
// use the service-role client, per getProviderKey/getPlatformSetting's
// signatures.
//
// Failure contract: every failure mode (no_llm_key, network/timeout error,
// malformed JSON, invalid enum value, missing field) throws. The caller is
// expected to catch and fall back to the deterministic heuristic — this
// module has no fallback behavior of its own.

import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { getPlatformSetting } from '@/lib/platform-settings'
import { anthropicApiModelId } from '@/lib/agents/models'
import { COPILOT_MODEL_TIERS } from '@/lib/copilot/resolve-provider'
import type { createServiceRoleClient } from '@/lib/supabase/admin'
import type { CrmIntentLevel, CrmQualificationStatus, CrmRecommendedChannel } from '@/types/database'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WebsiteSignals = {
  url: string | null
  leadScore: number | null
  services: string[]
  painPoints: string[]
  isMobileResponsive: boolean | null
  hasCTA: boolean | null
  hasContactInfo: boolean | null
  loadMs: number | null
  hasLogo: boolean
}

export type LlmQualificationSignals = {
  kind: 'person' | 'company'
  name: string | null
  companyName: string | null
  engagementStatus: string
  score: number
  hasReplied: boolean
  email: string | null
  phone: string | null
  /** "City, State" (or similar), sourced from custom_fields — used to infer the opener's language. */
  location: string | null
  tags: string[]
  /** null when not a company prospect, or no completed website_analyses row exists yet. */
  website: WebsiteSignals | null
}

export type LlmQualificationResult = {
  intentLevel: CrmIntentLevel
  qualificationStatus: CrmQualificationStatus
  recommendedChannel: CrmRecommendedChannel | null
  rationale: string
  opener: string
}

const VALID_INTENT: readonly CrmIntentLevel[] = ['none', 'low', 'medium', 'high']
const VALID_QUALIFICATION: readonly CrmQualificationStatus[] = ['unqualified', 'needs_review', 'qualified']
const VALID_CHANNEL: readonly CrmRecommendedChannel[] = [
  'email',
  'sms',
  'whatsapp',
  'call',
  'visit',
  'linkedin',
]

// ---------------------------------------------------------------------------
// LLM credential + provider resolution — trimmed copy of the precedence in
// src/lib/agent-runtime/run-agent.ts (org OpenRouter -> platform OpenRouter ->
// org Anthropic -> platform Anthropic).
// ---------------------------------------------------------------------------

type LlmProviderChoice = { kind: 'openrouter'; apiKey: string } | { kind: 'anthropic'; apiKey: string }

async function resolveLlmProvider(
  orgId: string,
  serviceClient: ReturnType<typeof createServiceRoleClient>,
): Promise<LlmProviderChoice> {
  const orgOpenRouterKey = await getProviderKey('openrouter', orgId, serviceClient)
  if (orgOpenRouterKey) return { kind: 'openrouter', apiKey: orgOpenRouterKey }

  const platformOpenRouterKey = await getPlatformSetting('OPENROUTER_API_KEY', serviceClient)
  if (platformOpenRouterKey) return { kind: 'openrouter', apiKey: platformOpenRouterKey }

  // OpenRouter only — see src/lib/copilot/resolve-provider.ts for why the
  // direct-Anthropic fallback was removed everywhere.
  throw new Error('no_llm_key')
}

/**
 * Cheap/fast tier model, reusing COPILOT_MODEL_TIERS.fast rather than a new
 * hardcoded literal. OpenRouter takes the full vendor-prefixed id via
 * `.chat()` (the bare callable resolves to the legacy completions API);
 * Anthropic direct takes the bare id via anthropicApiModelId().
 */
function buildLanguageModel(providerChoice: LlmProviderChoice) {
  if (providerChoice.kind === 'openrouter') {
    const openrouterProvider = createOpenRouter({ apiKey: providerChoice.apiKey })
    return openrouterProvider.chat(COPILOT_MODEL_TIERS.fast.openrouterModel)
  }
  const anthropicProvider = createAnthropic({ apiKey: providerChoice.apiKey })
  return anthropicProvider(anthropicApiModelId(COPILOT_MODEL_TIERS.fast.anthropicModel))
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a sales-development qualification assistant for a multi-tenant CRM platform.
Given signals about a sales prospect, decide how qualified they are and draft a short personalized cold-outreach opener.

Return ONLY a JSON object (no prose, no markdown fences) matching exactly this shape:
{
  "intent_level": "none" | "low" | "medium" | "high",
  "qualification_status": "unqualified" | "needs_review" | "qualified",
  "recommended_channel": "email" | "sms" | "whatsapp" | "call" | "visit" | "linkedin" | null,
  "rationale": "1-2 sentence explanation, in English",
  "opener": "a short 2-4 sentence personalized cold-outreach opening message"
}

Rules:
- recommended_channel must be one of the reachable channels listed in the prompt (or null if none are reachable). Never recommend a channel the prospect has no known contact method for.
- rationale: 1-2 sentences, English, matching the rest of the qualification UI copy.
- opener: reference 1-2 CONCRETE observations from the website analysis when present (e.g. mobile-friendliness, missing call-to-action, detected services) instead of generic filler. No bracket placeholders — write the prospect's actual name/company inline when known. Write it in the language most appropriate for the prospect, inferred from their location (e.g. a US city implies English; a Brazilian city implies Portuguese) — default to English if location is unknown. Keep it appropriate for the recommended channel (e.g. shorter for SMS/WhatsApp, slightly longer for email).
- Output one valid JSON object, nothing else. No markdown fences, no commentary.`

function describeWebsiteProblems(w: WebsiteSignals): string[] {
  const problems: string[] = []
  if (w.isMobileResponsive === false) problems.push('site is not mobile responsive')
  if (w.hasCTA === false) problems.push('no clear call to action')
  if (w.hasContactInfo === false) problems.push('contact info is hard to find')
  if (!w.hasLogo) problems.push('no identifiable logo')
  if (typeof w.loadMs === 'number' && w.loadMs > 4000) {
    problems.push(`slow to load (${(w.loadMs / 1000).toFixed(1)}s)`)
  }
  return problems
}

export function buildQualificationPrompt(signals: LlmQualificationSignals): { system: string; user: string } {
  const reachable: string[] = []
  if (signals.email) reachable.push('email')
  if (signals.phone) reachable.push('call', 'sms', 'whatsapp')
  if (signals.kind === 'company') reachable.push('visit') // account address may support a field visit

  const lines: string[] = []
  lines.push(`PROSPECT KIND: ${signals.kind}`)
  lines.push(`NAME: ${signals.name ?? 'Unknown'}`)
  if (signals.companyName) lines.push(`COMPANY: ${signals.companyName}`)
  lines.push(`LOCATION: ${signals.location ?? 'Unknown'}`)
  lines.push(`ENGAGEMENT STATUS: ${signals.engagementStatus}`)
  lines.push(`LEAD SCORE: ${signals.score}`)
  lines.push(`HAS REPLIED BEFORE: ${signals.hasReplied ? 'yes' : 'no'}`)
  lines.push(`EMAIL ON FILE: ${signals.email ? 'yes' : 'no'}`)
  lines.push(`PHONE ON FILE: ${signals.phone ? 'yes' : 'no'}`)
  lines.push(`REACHABLE CHANNELS: ${reachable.length ? reachable.join(', ') : 'none known'}`)
  if (signals.tags.length) lines.push(`TAGS: ${signals.tags.join(', ')}`)

  if (signals.website) {
    const w = signals.website
    lines.push('')
    lines.push('WEBSITE ANALYSIS:')
    if (w.url) lines.push(`- URL: ${w.url}`)
    if (w.leadScore !== null) {
      lines.push(`- Opportunity score: ${w.leadScore} (higher = more opportunity, i.e. a weaker current site)`)
    }
    if (w.services.length) lines.push(`- Detected services: ${w.services.join(', ')}`)
    if (w.painPoints.length) lines.push(`- Detected pain points: ${w.painPoints.join(', ')}`)
    const problems = describeWebsiteProblems(w)
    if (problems.length) lines.push(`- Site issues: ${problems.join('; ')}`)
  } else if (signals.kind === 'company') {
    lines.push('')
    lines.push('WEBSITE ANALYSIS: not available yet')
  }

  lines.push('')
  lines.push('Return the JSON now.')

  return { system: SYSTEM_PROMPT, user: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Response extraction + validation — mirrors extractJson() in
// src/app/api/email-templates/generate/route.ts (strip ```json fences, parse,
// then imperative shape validation; no generateObject/zod anywhere in this
// codebase's LLM call sites).
// ---------------------------------------------------------------------------

export function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = fenced ? fenced[1] : trimmed
  return JSON.parse(candidate)
}

export function parseLlmQualificationResponse(raw: unknown): LlmQualificationResult {
  if (!raw || typeof raw !== 'object') throw new Error('response must be a JSON object')
  const r = raw as Record<string, unknown>

  if (typeof r.intent_level !== 'string' || !VALID_INTENT.includes(r.intent_level as CrmIntentLevel)) {
    throw new Error(`invalid intent_level: ${JSON.stringify(r.intent_level)}`)
  }
  if (
    typeof r.qualification_status !== 'string' ||
    !VALID_QUALIFICATION.includes(r.qualification_status as CrmQualificationStatus)
  ) {
    throw new Error(`invalid qualification_status: ${JSON.stringify(r.qualification_status)}`)
  }

  let recommendedChannel: CrmRecommendedChannel | null = null
  if (r.recommended_channel !== null && r.recommended_channel !== undefined) {
    if (typeof r.recommended_channel !== 'string' || !VALID_CHANNEL.includes(r.recommended_channel as CrmRecommendedChannel)) {
      throw new Error(`invalid recommended_channel: ${JSON.stringify(r.recommended_channel)}`)
    }
    recommendedChannel = r.recommended_channel as CrmRecommendedChannel
  }

  if (typeof r.rationale !== 'string' || !r.rationale.trim()) {
    throw new Error('rationale missing or empty')
  }
  if (typeof r.opener !== 'string' || !r.opener.trim()) {
    throw new Error('opener missing or empty')
  }

  return {
    intentLevel: r.intent_level as CrmIntentLevel,
    qualificationStatus: r.qualification_status as CrmQualificationStatus,
    recommendedChannel,
    rationale: r.rationale.trim(),
    opener: r.opener.trim(),
  }
}

/** Extraction + validation in one step, for convenience and for the main call path. */
export function parseQualificationText(text: string): LlmQualificationResult {
  return parseLlmQualificationResponse(extractJsonBlock(text))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Resolves an LLM provider, calls it with the qualification + opener prompt,
 * and returns a validated result. Throws on any failure (no key configured,
 * timeout, malformed/invalid JSON) — callers must catch and fall back to the
 * deterministic heuristic (see heuristicQualification() in
 * src/app/(dashboard)/prospects/actions.ts).
 */
export async function qualifyProspectWithLlm(
  orgId: string,
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  signals: LlmQualificationSignals,
): Promise<LlmQualificationResult> {
  const providerChoice = await resolveLlmProvider(orgId, serviceClient)
  const model = buildLanguageModel(providerChoice)
  const { system, user } = buildQualificationPrompt(signals)

  const result = await generateText({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxOutputTokens: 700,
    abortSignal: AbortSignal.timeout(8000),
  })

  return parseQualificationText(result.text)
}
