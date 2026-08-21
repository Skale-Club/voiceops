// src/lib/medusa/client.ts
// HTTP client for the Medusa Store API (Stuscle commerce backend). Every call
// enforces the R11 per-org budget BEFORE issuing the network request, sends
// the org's publishable API key, and aborts after 8s. See
// .planning/research/INTEGRATION-CONTRACT.md §4.1.
//
// Phase 135 adds `medusaAgentFetch` for the privileged, HMAC-signed
// /agent/* surface (contract §4.2) — same R11 budget + 8s timeout, but signs
// the request with the connection token instead of sending the publishable
// key. See ./agent-sig.ts for the signing helper.

import { rateLimit } from '@/lib/rate-limit'
import { signAgentBody } from './agent-sig'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface MedusaCredentials {
  baseUrl: string // integrations.location_id, e.g. http://localhost:9000
  connectionToken: string // decrypt(encrypted_api_key) — used in Phase 135, not here
  publishableKey: string // config.publishable_key — sent as the store API pk header
  storefrontUrl?: string // config.storefront_url
}

// Passed from execute-action's ActionContext (structurally compatible).
export interface MedusaExecCtx {
  organizationId: string
  supabase: SupabaseClient<Database>
  conversationId?: string
  // Streaming SSE emitter (contract §6 `commerce` events, Phase 134). Only
  // run-agent's STREAMING call site passes this through; the blocking path
  // omits it entirely, so executors must null-check (`ctx.emitStructured?.(...)`).
  emitStructured?: (obj: Record<string, unknown>) => void
}

export class MedusaApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`Medusa API ${status}: ${body}`)
  }
}

export class MedusaRateLimitError extends Error {
  constructor() {
    super('medusa_rate_limited')
  }
}

export class MedusaUnsafeBaseUrlError extends Error {}

// X10 (SSRF hardening): `baseUrl` is `integrations.location_id`, an
// org-admin-controlled value (see saveIntegrationCredentials in
// src/app/(dashboard)/integrations/actions.ts, which also calls this
// validator at save time). Both medusaStoreFetch and medusaAgentFetch send a
// signed/keyed request to this URL, so an unvalidated value is an SSRF +
// cleartext-credential primitive — an org admin could point it at an
// internal service or the cloud metadata endpoint and have this server sign
// requests to it. Requires https: (http: only for localhost/dev) and rejects
// literal private/link-local/metadata IP hosts. NOTE: this only inspects the
// literal hostname in the URL — it does not resolve DNS, so it does not
// defend against DNS-rebinding (a hostname that resolves to a private IP at
// request time). That is out of scope here; `redirect: 'error'` on the fetch
// calls below at least closes the 302-after-validation variant of the same
// class of bug.
function isIPv4PrivateOrReserved(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return false
  const [a, b] = parts
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 — covers the 169.254.169.254 metadata IP
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true // 127.0.0.0/8 loopback (127.0.0.1 itself is allowed separately via the localhost dev path)
  return false
}

function isIPv6PrivateOrReserved(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === '::1') return false // loopback — handled via the localhost dev allowance, not rejected here
  if (h.startsWith('fc') || h.startsWith('fd')) return true // fc00::/7 unique local
  if (h.startsWith('fe80')) return true // fe80::/10 link-local
  return false
}

export function assertSafeBaseUrl(baseUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new MedusaUnsafeBaseUrlError(`Invalid Medusa base URL: "${baseUrl}"`)
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isDevLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isDevLocalhost)) {
    throw new MedusaUnsafeBaseUrlError(
      `Unsafe Medusa base URL protocol "${parsed.protocol}" — only https: is allowed (http: is permitted for localhost only).`,
    )
  }

  if (!isDevLocalhost && (isIPv4PrivateOrReserved(hostname) || isIPv6PrivateOrReserved(hostname))) {
    throw new MedusaUnsafeBaseUrlError(
      `Medusa base URL host "${hostname}" resolves to a private/link-local/metadata address and is not allowed.`,
    )
  }
}

export async function medusaStoreFetch<T>(
  creds: MedusaCredentials,
  path: string,
  orgId: string,
  init?: RequestInit,
): Promise<T> {
  assertSafeBaseUrl(creds.baseUrl)

  const rl = await rateLimit(`medusa:org:${orgId}`, 120, 60, { failMode: 'memory' }) // R11 — BEFORE fetch
  if (!rl.allowed) throw new MedusaRateLimitError()

  const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...init,
    headers: { 'x-publishable-api-key': creds.publishableKey, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
    redirect: 'error', // a permitted https base URL must not 302 into an internal/http target
  })
  if (!res.ok) throw new MedusaApiError(res.status, await res.text())
  return res.json() as Promise<T>
}

/**
 * Signed POST to the privileged /agent/* surface (contract §4.2). Enforces
 * R11 (shared with medusaStoreFetch) BEFORE the network call, 8s timeout,
 * throws MedusaApiError on non-2xx so callers can branch on `.status`
 * (e.g. 409 wishlist_full).
 *
 * BYTE-AGREEMENT INVARIANT (SECURITY CRITICAL): stringify the body ONCE,
 * sign THAT string, send THAT identical string as the fetch body — do NOT
 * re-stringify. Sign with the exact `ts` string placed in the header.
 */
export async function medusaAgentFetch<T>(
  creds: MedusaCredentials,
  path: string,
  orgId: string,
  body: Record<string, unknown>,
): Promise<T> {
  assertSafeBaseUrl(creds.baseUrl)

  const rl = await rateLimit(`medusa:org:${orgId}`, 120, 60, { failMode: 'memory' }) // R11 — shared with medusaStoreFetch, BEFORE fetch
  if (!rl.allowed) throw new MedusaRateLimitError()

  const raw = JSON.stringify(body) // stringify ONCE
  const ts = Math.floor(Date.now() / 1000).toString() // seconds, as a STRING
  const sig = await signAgentBody(creds.connectionToken, ts, raw) // bare hex

  const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xphere-Timestamp': ts,
      'X-Xphere-Signature': `v1=${sig}`, // the ONLY place the v1= scheme tag is applied
    },
    body: raw, // send the SAME string that was signed
    signal: AbortSignal.timeout(8000),
    redirect: 'error', // a permitted https base URL must not 302 into an internal/http target
  })
  if (!res.ok) throw new MedusaApiError(res.status, await res.text())
  return res.json() as Promise<T>
}
