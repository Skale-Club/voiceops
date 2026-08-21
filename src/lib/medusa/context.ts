// src/lib/medusa/context.ts
// Signed commerce-context verification + pinning (anti-IDOR core). Verifies
// the storefront-minted HMAC token and merges its claims into
// conversations.memory.commerce, under the pinned key names Phase 132's
// executors already read (see pinned-context.ts / actions/get-cart.ts).
// See .planning/research/INTEGRATION-CONTRACT.md §3.
//
// The verify half is a structural clone of src/lib/email/unsubscribe-token.ts
// — the ONE change is the HMAC key source: raw UTF-8 bytes of the xph_...
// connection token (NOT the hex-decoded ENCRYPTION_SECRET that
// unsubscribe-token.ts / crypto.ts use). Node's createHmac('sha256', s) with
// a string key uses that string's UTF-8 bytes as the key; this must match
// byte-for-byte with stuscle's mint.
//
// No `server-only` import — this module is imported by the nodejs-runtime
// chat route AND by vitest (node env); keep it dependency-light (zod + Web
// Crypto globals only).

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPinnedContext } from './pinned-context'
import type { MedusaExecCtx } from './client'

const encoder = new TextEncoder()

// Copied verbatim from src/lib/email/unsubscribe-token.ts.
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

// CRITICAL: key = raw UTF-8 bytes of the xph_... connection-token STRING.
// Do NOT hex-decode (unlike unsubscribe-token.ts's ENCRYPTION_SECRET, a
// 64-char hex string decoded to 32 key bytes). Do NOT strip the xph_ prefix.
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
}

const ClaimsSchema = z.object({
  v: z.number(),
  org: z.string(),
  cart: z.string().nullable(),
  cus: z.string().nullable(),
  email: z.string().nullable(),
  wishlist_ref: z.string().nullable(),
  country_code: z.string(),
  region_id: z.string().nullable(),
  // v2 (X2 token binding, contract §3): one-time-use jti (consumed on pin,
  // replay rejected) + client-generated cnonce (binds the token to one
  // conversation). Both required — v1 tokens (lacking them) fail this parse
  // and are rejected below regardless, but requiring the keys here keeps the
  // schema honest about what a v2 payload actually contains.
  jti: z.string(),
  cnonce: z.string(),
  iat: z.number(),
  exp: z.number(),
})

export type CommerceClaims = z.infer<typeof ClaimsSchema>

/**
 * Verify a storefront-minted commerce-context token (contract §3 v2): split
 * on ".", recompute HMAC-SHA256 over the base64url payload STRING using the
 * org's decrypted Medusa connection token as raw-UTF8 key bytes, constant-time
 * compare via crypto.subtle.verify, then check v===2 (v1 — and anything else
 * — is rejected deliberately; no transition window, see X2 design doc) / exp
 * (unix seconds) / org. Fail-soft: any invalid input (expired, tampered,
 * wrong-org, wrong-version, malformed base64/JSON) returns null — NEVER
 * throws. This function stays PURE (no DB): jti-consumption and cnonce
 * binding happen in the caller (writeCommerceContext / the chat route), not
 * here.
 */
export async function verifyCommerceContext(
  token: string,
  secret: string,
  expectedOrg: string,
): Promise<CommerceClaims | null> {
  try {
    const dot = token.indexOf('.')
    if (dot === -1) return null
    const payloadB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    const key = await hmacKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), encoder.encode(payloadB64))
    if (!ok) return null
    const raw: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)))
    const claims = ClaimsSchema.safeParse(raw)
    if (!claims.success) return null
    const c = claims.data
    if (c.v !== 2) return null // v1 rejected deliberately — no v1 tokens in circulation (X2 design doc)
    if (c.exp <= Math.floor(Date.now() / 1000)) return null // exp is UNIX SECONDS, not ms
    if (c.org !== expectedOrg) return null // cross-org replay barrier
    return c
  } catch {
    return null
  }
}

/**
 * Merge verified claims into conversations.memory.commerce under the
 * VERBATIM contract §3 claim names — `cart` (matches the shipped
 * actions/get-cart.ts reader `commerce.cart`) and `cus` (the raw claim
 * name, not a longer synonym). Delegates to the medusa_write_commerce_context
 * SECURITY DEFINER RPC (migration 1284, X2 hardening — supersedes 1283's
 * 8-arg version), which does a `SELECT ... FOR UPDATE` + partial jsonb merge
 * inside one transaction — the read-modify-write this function used to do
 * client-side raced concurrent tool calls AND replaced the entire `commerce`
 * object, clobbering sibling keys like `write_count` even without a race.
 * The RPC touches only the eight claim-derived keys (adds `cnonce` to
 * 1283's seven).
 *
 * `cnonce` (X2 token binding, contract §3 v2) is recorded verbatim on the
 * conversation's FIRST pin; every later re-pin must present the SAME cnonce
 * or the RPC aborts the merge entirely (no write) and returns
 * `{ rejected: true }` — the prior pin is left completely untouched. Callers
 * MUST treat `{ rejected: true }` as a distinct outcome from a normal
 * (possibly repinned) success and must NOT log a repin or link a contact for
 * it (see the chat route's `commerce_ctx_cnonce_mismatch` branch).
 *
 * Returns `{ repinnedFrom }` when a different cart was previously pinned — a
 * fresh VERIFIED token (with a cnonce that matched) is the sole authority for
 * re-pinning (never message text or model output).
 */
export async function writeCommerceContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  orgId: string,
  claims: CommerceClaims,
  cnonce: string,
): Promise<{ repinnedFrom?: string } | { rejected: true } | null> {
  const { data, error } = await supabase.rpc('medusa_write_commerce_context' as never, {
    p_conversation_id: conversationId,
    p_org_id: orgId,
    p_cart: claims.cart,
    p_cus: claims.cus,
    p_email: claims.email,
    p_wishlist_ref: claims.wishlist_ref,
    p_country_code: claims.country_code,
    p_region_id: claims.region_id,
    p_cnonce: cnonce,
  } as never)
  if (error) return null // fail-soft, matching this module's verify-half contract

  const result = data as unknown as { repinnedFrom?: string; rejected?: boolean } | null
  if (result?.rejected) return { rejected: true }
  return result?.repinnedFrom ? { repinnedFrom: result.repinnedFrom } : null
}

/**
 * Consume a token's one-time `jti` claim (X2 token binding, contract §3 v2).
 * Delegates to the medusa_consume_context_jti SECURITY DEFINER RPC (migration
 * 1284), which inserts `(org_id, jti)` into the commerce_context_jti ledger
 * and returns true on a fresh insert, false when that pair already exists
 * (replay). MUST be called — and must succeed — before writeCommerceContext
 * on every pin attempt; a false/errored result means the caller drops the
 * context entirely (fail-soft — never throws, never pins).
 */
export async function consumeContextJti(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
  jti: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('medusa_consume_context_jti' as never, {
    p_org_id: orgId,
    p_jti: jti,
  } as never)
  if (error) return false // fail-closed on RPC failure — never pin on an unconfirmed jti
  return data === true
}

/**
 * Thin wrapper around Phase 132's shipped loadPinnedContext — the canonical
 * reader for the pinned commerce context. Does NOT fork a second, divergent
 * query shape (see 133-RESEARCH.md Open Q3): it delegates entirely.
 */
export async function readCommerceContext(ctx: MedusaExecCtx): Promise<Record<string, unknown>> {
  const { commerce } = await loadPinnedContext(ctx)
  return commerce
}

/**
 * Cart-only re-pin after a write executor creates a cart with no prior
 * pinned token (contract §3 — the ONE legitimate non-token re-pin). Delegates
 * to the medusa_pin_cart_id SECURITY DEFINER RPC (migration 1283), which does
 * a `SELECT ... FOR UPDATE` + jsonb_set touching ONLY `commerce.cart` inside
 * one transaction — no client-side read-modify-write race. It does NOT
 * reconstruct a full CommerceClaims and does NOT stamp `verified_at` (a
 * self-created cart is not a verified-token claim; see 134-RESEARCH.md
 * Pitfall 5). All other commerce keys (region_id/cus/email/wishlist_ref/
 * write_count/...) survive unchanged, including under concurrent callers.
 */
export async function pinCartId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  orgId: string,
  cartId: string,
): Promise<void> {
  await supabase.rpc('medusa_pin_cart_id' as never, {
    p_conversation_id: conversationId,
    p_org_id: orgId,
    p_cart_id: cartId,
  } as never)
}

/**
 * Per-conversation write budget (CRT-02's 25-writes-per-conversation cap,
 * on top of R7/R8's time-windowed limits). Delegates to the
 * medusa_increment_write_count SECURITY DEFINER RPC (migration 1283), which
 * does a `SELECT ... FOR UPDATE` + jsonb_set-based increment inside one
 * transaction — the old client-side read-modify-write could lose an
 * increment when two tool calls in the same conversation raced each other.
 * Returns `{ allowed: false, count }` WITHOUT writing once `write_count`
 * reaches `cap`; callers MUST turn a denial into a clean tool-result string,
 * never a throw. All other commerce keys survive unchanged on both the allow
 * and deny paths.
 */
export async function bumpConversationWriteCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  orgId: string,
  cap = 25,
): Promise<{ allowed: boolean; count: number }> {
  const { data, error } = await supabase.rpc('medusa_increment_write_count' as never, {
    p_conversation_id: conversationId,
    p_org_id: orgId,
    p_cap: cap,
  } as never)
  if (error) return { allowed: false, count: cap } // fail-closed on RPC failure, mirroring R7/R8's fail-closed budgets

  const result = data as unknown as { allowed: boolean; count: number }
  return { allowed: result.allowed, count: result.count }
}
