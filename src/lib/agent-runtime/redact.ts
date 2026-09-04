// src/lib/agent-runtime/redact.ts
// Phase 134 Plan 03 (OBS-02): redaction applied BEFORE an observability row
// is written to agent_invocations — never a display-time filter. Covers
// user_message, assistant_reply, tool_calls, and partner_calls, including
// nested JSON structures (see invocations.ts call sites, which are the only
// callers: insertInvocationStart() for user_message, updateInvocationEnd()
// for assistant_reply/tool_calls/partner_calls).
//
// This module does NOT touch src/lib/crypto.ts and does NOT change any
// encryption format — it exists to stop secrets from being WRITTEN into
// observability rows in the first place, not to manage encrypted-at-rest
// credentials (a sensitive path per CLAUDE.md that this plan must not alter).
//
// Two layers, both applied recursively so a credential nested inside
// extracted_params, tool args, or a tool result is never missed:
//   1. Key-based: any JSON object key that names a credential (password,
//      token, api_key, authorization, ...) has its ENTIRE value replaced,
//      regardless of the value's shape (string, object, array, number).
//      Matched case-insensitively against the exact key name only — never a
//      substring match (mirrors handoff.ts's FORBIDDEN_HANDOFF_KEYS approach,
//      so "role_name"-style false positives are avoided the same way).
//   2. Pattern-based: string leaves are scanned for credential-shaped
//      substrings (Bearer tokens, xph_ API keys, vendor sk-/pk- keys, JWTs)
//      and well-defined personal data (email addresses, payment card
//      numbers) even when the surrounding key name is innocuous (e.g. a
//      webhook response body stored as a plain string, or a user typing
//      their own email/card number into a chat message).
//
// Deliberately NOT included: a generic phone-number pattern. Loose digit-
// group heuristics collide with UUID segments (agent/invocation/workflow
// ids are exactly the kind of digit-and-dash string this module must never
// mangle), so it is safer to omit than to risk corrupting trace-linkage ids
// embedded in tool_calls/partner_calls (e.g. child_invocation_id, workflow_id).

import type { Json } from '@/types/database'

const REDACTED = '[REDACTED]'

// Exact-match only (case-insensitive) — never a substring match, so keys
// like "role_name" or "system_prompt_hint" style near-misses stay intact.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwords',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'token',
  'tokens',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'session_token',
  'sessiontoken',
  'api_key',
  'apikey',
  'api_keys',
  'apikeys',
  'authorization',
  'auth',
  'private_key',
  'privatekey',
  'client_secret',
  'clientsecret',
  'ssn',
  'social_security_number',
  'credit_card',
  'creditcard',
  'card_number',
  'cardnumber',
  'cvv',
  'cvc',
  'bank_account',
  'bankaccount',
  'iban',
  'routing_number',
])

// Credential/PII-shaped substrings, scanned inside any string leaf
// regardless of its key name.
const INLINE_PATTERNS: RegExp[] = [
  // Xphere public API tokens: xph_<64 hex chars> (see CLAUDE.md "Public REST
  // API" — the plaintext is never persisted elsewhere either; this is
  // defense in depth against a stray copy landing in a tool payload/reply).
  /\bxph_[0-9a-f]{64}\b/gi,
  // Bearer <token>, as captured from an Authorization header or echoed back
  // inside a webhook request/response body stored as a tool result.
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi,
  // Vendor-style secret keys (OpenAI/OpenRouter/Anthropic/Stripe-shaped).
  /\b(?:sk|pk|rk)-(?:ant-|or-)?[A-Za-z0-9_-]{10,}\b/g,
  // JWTs: three dot-separated base64url segments.
  /\bey[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  // Email addresses (unambiguous personal data — the "@domain.tld" shape
  // does not collide with ids, timestamps, or other operational strings).
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // Payment card numbers: exactly four groups of four digits separated by a
  // single space. Deliberately space-only (never dash, never zero-width) —
  // ids threaded through this codebase (trace_id, invocation_id,
  // workflow_id) are dash- or letter-separated and must never collide with
  // this pattern.
  /\b\d{4} \d{4} \d{4} \d{4}\b/g,
]

function redactStringValue(value: string): string {
  let out = value
  for (const pattern of INLINE_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

/** Pattern-based redaction for a single free-text field (user_message, assistant_reply). */
export function redactText(value: string): string {
  if (typeof value !== 'string') return value
  return redactStringValue(value)
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactStringValue(value)
  if (Array.isArray(value)) return value.map((v) => redactValue(v))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(v)
    }
    return out
  }
  return value
}

/**
 * Deep redaction for JSON structures (tool_calls, partner_calls). Safe to
 * call on an already-redacted or empty value; idempotent. Structural fields
 * (tool name, denied_reason, ids, timestamps, ok/denied booleans) pass
 * through untouched — only sensitive-named keys and credential/PII-shaped
 * string leaves are altered.
 */
export function redactJson<T extends Json>(value: T): T {
  return redactValue(value) as T
}
