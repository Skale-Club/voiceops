// src/lib/agent-runtime/handoff.ts
// Typed, allow-listed agent-to-agent handoff contract (Phase 132, ROUT-04/ROUT-05).
//
// Phase 38 shipped a synthetic `call_partner_<slug>` tool whose input schema was
// `{ additionalProperties: true }` and whose only guard was a shallow deny-list
// (`^role$|^system$|^instructions?$`) that walked plain objects but never arrays.
// It did not reject identity, organization, agent, secret/credential/token/API-key,
// runtime-control, or prototype-pollution keys, and the recursive child result was
// collapsed into a bare string, so a specialist's raw provider error or internal
// reasoning could reach the channel unfiltered.
//
// This module is pure (no I/O, no Supabase, no `ai` SDK) so it can be unit tested
// in isolation and reused by both the production tool wiring in run-agent.ts and
// legacy test suites that previously duplicated the deny-list.

// ---------------------------------------------------------------------------
// Handoff input contract
// ---------------------------------------------------------------------------

export type HandoffMessage = {
  role: 'user' | 'assistant'
  content: string
}

/** The only shape a handoff payload may take once validated. */
export type HandoffInput = {
  from_agent: string
  intent: string
  extracted_params?: Record<string, unknown>
  summary: string
  recent_messages?: HandoffMessage[]
}

export type HandoffValidationResult =
  | { valid: true; value: HandoffInput }
  | { valid: false; reason: string }

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'from_agent',
  'intent',
  'extracted_params',
  'summary',
  'recent_messages',
])

const MAX_FROM_AGENT_LENGTH = 200
const MAX_INTENT_LENGTH = 500
const MAX_SUMMARY_LENGTH = 2000
const MAX_MESSAGE_CONTENT_LENGTH = 4000
const MAX_RECENT_MESSAGES = 3

// Forbidden key names, matched case-insensitively against the exact key (never a
// substring match — "role_name" and "system_prompt_hint" must remain legal).
// Categories: role/system/instruction overrides (original DELEG-05 patterns),
// identity, organization, agent, secret/credential/token/API-key, runtime-control,
// and prototype-pollution keys.
const FORBIDDEN_HANDOFF_KEYS = new Set<string>([
  // role/system/instruction
  'role',
  'system',
  'instruction',
  'instructions',
  // identity
  'user_id',
  'userid',
  'contact_id',
  'contactid',
  'customer_id',
  'customerid',
  'external_id',
  'externalid',
  'actor_id',
  'actorid',
  'identity',
  // organization
  'org_id',
  'orgid',
  'organization_id',
  'organizationid',
  'organization',
  'org',
  'tenant_id',
  'tenantid',
  'tenant',
  // agent
  'agent_id',
  'agentid',
  'agent',
  'partner_agent_id',
  'partneragentid',
  'target_agent',
  'targetagent',
  // secret / credential / token / API-key
  'secret',
  'secrets',
  'credential',
  'credentials',
  'token',
  'tokens',
  'api_key',
  'apikey',
  'api_keys',
  'apikeys',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'password',
  'passwords',
  'authorization',
  'auth',
  // runtime-control overrides
  'model',
  'provider',
  'temperature',
  'max_tokens',
  'maxtokens',
  'stream',
  'tool_choice',
  'toolchoice',
  'system_prompt',
  'systemprompt',
  'mode',
  'thinking_budget_tokens',
  'thinkingbudgettokens',
  'stop',
  'top_p',
  'topp',
  // prototype pollution
  '__proto__',
  'prototype',
  'constructor',
])

/**
 * Recursively scans an arbitrary value (object or array, at any depth) for
 * forbidden key names. Returns a channel-safe description of the first
 * violation found, or null when the value is clean.
 *
 * Exported standalone (rather than folded into validateHandoffInput) so
 * callers that only need the deny-list primitive — e.g. legacy delegation
 * tests — can reuse the exact production logic instead of maintaining a
 * parallel copy.
 */
export function findForbiddenHandoffKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const nested = findForbiddenHandoffKey(value[i], `${path}[${i}]`)
      if (nested) return nested
    }
    return null
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_HANDOFF_KEYS.has(key.toLowerCase())) {
        return `forbidden key "${key}" at ${path || 'root'} | prompt injection blocked`
      }
      const childPath = path ? `${path}.${key}` : key
      const nested = findForbiddenHandoffKey((value as Record<string, unknown>)[key], childPath)
      if (nested) return nested
    }
    return null
  }
  return null
}

/**
 * Strict allow-listed parser for a `call_partner_<slug>` tool call payload.
 * Only from_agent, intent, extracted_params, summary, and recent_messages may
 * appear at the top level; extracted_params and recent_messages are the only
 * places a model can put structured data, and both are bounded and deep-scanned.
 */
export function validateHandoffInput(raw: unknown): HandoffValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, reason: 'handoff payload must be a non-null object' }
  }
  const record = raw as Record<string, unknown>

  for (const key of Object.keys(record)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return {
        valid: false,
        reason: `unexpected key "${key}" | handoff payload only accepts from_agent, intent, extracted_params, summary, recent_messages`,
      }
    }
  }

  const fromAgent = record.from_agent
  if (typeof fromAgent !== 'string' || fromAgent.trim().length === 0) {
    return { valid: false, reason: 'from_agent must be a non-empty string' }
  }
  if (fromAgent.length > MAX_FROM_AGENT_LENGTH) {
    return { valid: false, reason: `from_agent exceeds ${MAX_FROM_AGENT_LENGTH} characters` }
  }

  const intent = record.intent
  if (typeof intent !== 'string' || intent.trim().length === 0) {
    return { valid: false, reason: 'intent must be a non-empty string' }
  }
  if (intent.length > MAX_INTENT_LENGTH) {
    return { valid: false, reason: `intent exceeds ${MAX_INTENT_LENGTH} characters` }
  }

  const summary = record.summary
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    return { valid: false, reason: 'summary must be a non-empty string' }
  }

  let extractedParams: Record<string, unknown> | undefined
  if (record.extracted_params !== undefined) {
    if (
      typeof record.extracted_params !== 'object' ||
      record.extracted_params === null ||
      Array.isArray(record.extracted_params)
    ) {
      return { valid: false, reason: 'extracted_params must be a plain object' }
    }
    const forbidden = findForbiddenHandoffKey(record.extracted_params, 'extracted_params')
    if (forbidden) return { valid: false, reason: forbidden }
    extractedParams = record.extracted_params as Record<string, unknown>
  }

  let recentMessages: HandoffMessage[] | undefined
  if (record.recent_messages !== undefined) {
    if (!Array.isArray(record.recent_messages)) {
      return { valid: false, reason: 'recent_messages must be an array' }
    }
    const parsed: HandoffMessage[] = []
    for (let i = 0; i < record.recent_messages.length; i++) {
      const item = record.recent_messages[i]
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return { valid: false, reason: `recent_messages[${i}] must be an object` }
      }
      const itemRecord = item as Record<string, unknown>
      for (const key of Object.keys(itemRecord)) {
        if (key !== 'role' && key !== 'content') {
          return { valid: false, reason: `unexpected key "${key}" in recent_messages[${i}]` }
        }
      }
      if (itemRecord.role !== 'user' && itemRecord.role !== 'assistant') {
        return { valid: false, reason: `recent_messages[${i}].role must be "user" or "assistant"` }
      }
      if (typeof itemRecord.content !== 'string') {
        return { valid: false, reason: `recent_messages[${i}].content must be a string` }
      }
      parsed.push({
        role: itemRecord.role,
        content: itemRecord.content.slice(0, MAX_MESSAGE_CONTENT_LENGTH),
      })
    }
    // Bound to the most recent N messages regardless of how many the model sent.
    recentMessages = parsed.slice(-MAX_RECENT_MESSAGES)
  }

  return {
    valid: true,
    value: {
      from_agent: fromAgent,
      intent,
      extracted_params: extractedParams,
      summary: summary.slice(0, MAX_SUMMARY_LENGTH),
      recent_messages: recentMessages,
    },
  }
}

// ---------------------------------------------------------------------------
// Specialist result contract
// ---------------------------------------------------------------------------
// The parent (delegating) agent is the sole owner of what reaches the channel.
// A specialist's raw text is only safe to surface verbatim on success; every
// other outcome is reduced to a generic, channel-safe reason so that internal
// reasoning and raw provider errors never leak through a tool result.

export type SpecialistResult =
  | { outcome: 'success'; message: string }
  | { outcome: 'business_failure'; reason: string }
  | { outcome: 'retryable_failure'; reason: string }
  | { outcome: 'handoff'; targetAgentSlug: string; reason: string }

const MAX_SPECIALIST_MESSAGE_LENGTH = 4000

/**
 * Minimal shape this module needs from AgentRunResult. Declared locally
 * (rather than imported) to keep this module dependency-free; run-agent.ts's
 * AgentRunResult is structurally assignable to this type.
 */
export type SpecialistRunOutcome = {
  status: 'success' | 'error' | 'aborted' | 'denied' | 'skipped'
  text: string
}

/** Normalizes a child agent's raw run result into the typed specialist result union. */
export function normalizeSpecialistResult(result: SpecialistRunOutcome): SpecialistResult {
  switch (result.status) {
    case 'success': {
      const message = (result.text ?? '').trim()
      if (message.length === 0) {
        return { outcome: 'retryable_failure', reason: 'Specialist agent returned an empty response.' }
      }
      return { outcome: 'success', message: message.slice(0, MAX_SPECIALIST_MESSAGE_LENGTH) }
    }
    case 'denied':
      return {
        outcome: 'business_failure',
        reason: 'Specialist agent denied the request due to policy or authorization limits.',
      }
    case 'skipped':
      return { outcome: 'business_failure', reason: 'Specialist agent could not process the request.' }
    case 'aborted':
      return { outcome: 'retryable_failure', reason: 'Specialist agent invocation timed out.' }
    case 'error':
    default:
      return { outcome: 'retryable_failure', reason: 'Specialist agent encountered an internal error.' }
  }
}

/** The single place channel-facing prose is derived from a SpecialistResult. */
export function specialistResultToToolMessage(result: SpecialistResult): string {
  switch (result.outcome) {
    case 'success':
      return result.message
    case 'business_failure':
      return `Specialist could not complete the request: ${result.reason}`
    case 'retryable_failure':
      return `Specialist is temporarily unavailable: ${result.reason}`
    case 'handoff':
      return `Specialist requests handoff to ${result.targetAgentSlug}: ${result.reason}`
  }
}
