// src/lib/agent-runtime/idempotency.ts
// Idempotency helpers for side-effecting tool executors.
// IDEMP-01: tool_idempotency_keys table (exists from migration 038)
// IDEMP-02: check before execute, persist after execute
// IDEMP-03: key = sha256(invocationId + ':' + toolCallIndex)
// Phase 133 (SAFE-01, PERF-03): ingress-scoped derivation for channel
// retries + discriminated checkIdempotency outcome + abandoned-ownership
// recording for side-effecting work killed mid-flight.

import crypto from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'
import type { Json } from '@/types/database'

// ---------------------------------------------------------------------------
// IDEMP-03: Key derivation (invocation-scoped — UNCHANGED, byte-for-byte)
// ---------------------------------------------------------------------------
// This is the fallback derivation for paths with no ingress identity
// (widget, campaigns, cron). Do not change the format below: existing rows
// in tool_idempotency_keys were written under this exact derivation, and a
// format change would desync them from the keys callers derive on the next
// request, turning previously-guarded mutations into re-executable ones.

export function deriveIdempotencyKey(invocationId: string, toolCallIndex: number): string {
  return crypto.createHash('sha256').update(`${invocationId}:${toolCallIndex}`).digest('hex')
}

// ---------------------------------------------------------------------------
// SAFE-01: Ingress-scoped key derivation
// ---------------------------------------------------------------------------
// The identifiers that survive a channel retry (e.g. Vapi's call.id +
// toolCall.id) are stable across redeliveries even though a fresh agent
// invocation id is minted each time. This derivation must only ever be fed
// a trusted, server-side-resolved identity — never a value read out of tool
// arguments or model output, both of which are attacker/model-controlled.
//
// Namespaced with a literal "ingress:" prefix and the channel name so this
// keyspace can never collide with the legacy invocation-scoped keyspace,
// even for superficially similar identifiers.

export interface IngressIdentity {
  /** Channel the ingress request arrived on, e.g. 'voice'. */
  channel: string
  /** Stable per-delivery identifier from the channel provider, e.g. Vapi call.id. */
  externalCallId: string
  /** Stable per-tool-call identifier from the channel provider, e.g. Vapi toolCall.id. */
  externalToolCallId: string
}

export function deriveIngressIdempotencyKey(identity: IngressIdentity): string {
  if (!identity.channel) {
    throw new Error('deriveIngressIdempotencyKey: channel is required')
  }
  if (!identity.externalCallId) {
    throw new Error('deriveIngressIdempotencyKey: externalCallId is required')
  }
  if (!identity.externalToolCallId) {
    throw new Error('deriveIngressIdempotencyKey: externalToolCallId is required')
  }
  return crypto
    .createHash('sha256')
    .update(`ingress:${identity.channel}:${identity.externalCallId}:${identity.externalToolCallId}`)
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Side-effecting action types that require idempotency (IDEMP-02)
// ---------------------------------------------------------------------------

export const SIDE_EFFECTING_ACTIONS = new Set([
  'create_appointment',
  'send_sms',
  'create_contact',
  'custom_webhook',  // non-GET only | checked at call site via toolConfig
  'medusa_add_to_cart',
  'medusa_update_cart_item',
  // Phase 135 (WSL-02): wishlist writes are side-effecting for idempotency
  // purposes, but deliberately NOT in COMMERCE_WRITE_ACTIONS below -- they
  // stay out of the cart-only 3/turn + 25/conversation guardrail caps. The
  // wishlist read/list tool is intentionally absent from this set.
  'medusa_wishlist_add',
  'medusa_wishlist_remove',
])

// ---------------------------------------------------------------------------
// CRT-02/134-RESEARCH: commerce write action types. Exported separately so
// run-agent's tool loop can recognize a commerce write BEFORE dispatch (to
// enforce the per-turn cap via checkCommerceWritesPerTurn in guardrails.ts)
// without re-deriving the set from SIDE_EFFECTING_ACTIONS each time.
// ---------------------------------------------------------------------------

export const COMMERCE_WRITE_ACTIONS = new Set(['medusa_add_to_cart', 'medusa_update_cart_item'])

export function requiresIdempotency(actionType: string, toolConfig?: unknown): boolean {
  if (!SIDE_EFFECTING_ACTIONS.has(actionType)) return false
  // For custom_webhook: only wrap non-GET requests
  if (actionType === 'custom_webhook') {
    const cfg = toolConfig as Record<string, unknown> | null | undefined
    const method = ((cfg?.method as string | undefined) ?? 'POST').toUpperCase()
    return method !== 'GET'
  }
  return true
}

// ---------------------------------------------------------------------------
// Abandoned-ownership marker
// ---------------------------------------------------------------------------
// Stored in the `response` JSONB column so no schema migration is required.
// A genuine recorded response (recordIdempotency) is always the caller's
// plain tool-result string, which Postgres stores as a JSON string scalar —
// never a JSON object — so an object carrying this marker key can never
// collide with a real completed result.

const ABANDONED_MARKER = '__idempotency_abandoned__' as const

interface AbandonedMarker {
  __idempotency_marker: typeof ABANDONED_MARKER
  reason: string
  abandoned_at: string
}

function isAbandonedMarker(value: unknown): value is AbandonedMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__idempotency_marker === ABANDONED_MARKER
  )
}

// ---------------------------------------------------------------------------
// IDEMP-02 / SAFE-01: Check for existing cached response
// ---------------------------------------------------------------------------
// Returns a discriminated outcome instead of a bare string:
//   - fresh:     no row for this key — safe to execute.
//   - replay:    row matches the caller's request hash — return the
//                recorded response WITHOUT re-executing.
//   - conflict:  a row exists under this key but the request hash differs.
//                This must NEVER be answered with the original response —
//                that is the exact failure mode idempotency exists to
//                prevent (a colliding/reused key masking a different call).
//   - abandoned: a row exists, the request hash matches, but the recorded
//                value is the abandoned-ownership marker (a prior
//                side-effecting execution was killed mid-flight by a
//                timeout/abort and never confirmed complete). A retry must
//                treat this as neither a free slot (would double-execute a
//                possibly-still-in-flight mutation) nor a completed result.

export type IdempotencyOutcome =
  | { status: 'fresh' }
  | { status: 'replay'; response: string }
  | { status: 'conflict' }
  | { status: 'abandoned' }

export async function checkIdempotency(
  organizationId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<IdempotencyOutcome> {
  const supabase = createServiceRoleClient()

  const { data } = await supabase
    .from('tool_idempotency_keys')
    .select('response, request_hash')
    .eq('organization_id', organizationId)
    .eq('idempotency_key', idempotencyKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!data) return { status: 'fresh' }

  if (data.request_hash !== requestHash) {
    return { status: 'conflict' }
  }

  if (isAbandonedMarker(data.response)) {
    return { status: 'abandoned' }
  }

  // response is JSONB | if it's a string, return it directly; if object, JSON.stringify
  const response = data.response
  const responseStr = typeof response === 'string' ? response : JSON.stringify(response)
  return { status: 'replay', response: responseStr }
}

// ---------------------------------------------------------------------------
// IDEMP-02: Persist response after successful execution
// ---------------------------------------------------------------------------

export async function recordIdempotency(params: {
  organizationId: string
  /**
   * The agent invocation that owns this execution, when there is one.
   * `agent_invocation_id` is a nullable FK: legacy ingress paths (the Vapi
   * tool webhook calls executeAction directly) have no invocation to point
   * at, and must pass `null` rather than a fabricated id that would fail the
   * FK or the UUID format check.
   */
  agentInvocationId: string | null
  idempotencyKey: string
  toolName: string
  requestHash: string
  response: string
}): Promise<void> {
  const supabase = createServiceRoleClient()

  const { error } = await supabase
    .from('tool_idempotency_keys')
    .upsert(
      {
        organization_id: params.organizationId,
        agent_invocation_id: params.agentInvocationId ?? null,
        idempotency_key: params.idempotencyKey,
        tool_name: params.toolName,
        request_hash: params.requestHash,
        response: params.response,
        // expires_at defaults to now() + 24h in the DB
      },
      { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true }
    )

  if (error) {
    // Non-fatal | log and continue; the tool already executed
    createLogger({ toolName: params.toolName })
      .warn('idempotency_record_failed', { idempotencyKey: params.idempotencyKey, error: error.message })
  }
}

// ---------------------------------------------------------------------------
// PERF-03: Record that a side-effecting execution was abandoned mid-flight
// ---------------------------------------------------------------------------
// Called when a timeout or abort kills a side-effecting execution before it
// can confirm success or failure. Writes the abandoned marker under the
// same key so a later retry sees `{ status: 'abandoned' }` from
// checkIdempotency rather than treating the slot as free.
//
// Uses the same ignoreDuplicates upsert as recordIdempotency: if the
// underlying execution actually completed and recordIdempotency already
// wrote the real result first, this call is a no-op and the completed
// result is never clobbered. Symmetrically, once an abandoned marker lands
// first, a later recordIdempotency() for the same key is also a no-op — the
// row stays "abandoned" until it expires, which is intentional: this phase
// only makes the abandonment traceable, it does not resolve it.

export async function recordAbandonedIdempotency(params: {
  organizationId: string
  /**
   * The agent invocation that owns this execution, when there is one.
   * `agent_invocation_id` is a nullable FK: legacy ingress paths (the Vapi
   * tool webhook calls executeAction directly) have no invocation to point
   * at, and must pass `null` rather than a fabricated id that would fail the
   * FK or the UUID format check.
   */
  agentInvocationId: string | null
  idempotencyKey: string
  toolName: string
  requestHash: string
  reason: string
}): Promise<void> {
  const supabase = createServiceRoleClient()

  const marker: AbandonedMarker = {
    __idempotency_marker: ABANDONED_MARKER,
    reason: params.reason,
    abandoned_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('tool_idempotency_keys')
    .upsert(
      {
        organization_id: params.organizationId,
        agent_invocation_id: params.agentInvocationId ?? null,
        idempotency_key: params.idempotencyKey,
        tool_name: params.toolName,
        request_hash: params.requestHash,
        response: marker as unknown as Json,
        // expires_at defaults to now() + 24h in the DB
      },
      { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true }
    )

  if (error) {
    createLogger({ toolName: params.toolName })
      .warn('idempotency_abandoned_record_failed', { idempotencyKey: params.idempotencyKey, error: error.message })
  }
}

// ---------------------------------------------------------------------------
// Request hash | stable fingerprint of tool args, used both for debugging
// and as the conflict-detection fingerprint in checkIdempotency above.
// ---------------------------------------------------------------------------

export function hashToolArgs(toolArgs: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(toolArgs)).digest('hex')
}
