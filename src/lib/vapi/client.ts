// src/lib/vapi/client.ts
// Shared Vapi API client for RLS-scoped (per-request) callers: resolves +
// decrypts the current org's active Vapi API key via the authenticated
// Supabase client, and wraps authenticated fetches to api.vapi.ai with a hard
// timeout. Consolidates what /api/vapi/phone-numbers and /api/vapi/assistants
// were each reimplementing inline.
//
// Note: src/lib/vapi/sync-assistants.ts covers a different call shape (an
// explicit organizationId + a service-role client, used from server actions
// and the "save integration" hook) and is left as-is.

import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

const VAPI_BASE_URL = 'https://api.vapi.ai'
const DEFAULT_TIMEOUT_MS = 8000

export class VapiApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'VapiApiError'
    this.status = status
  }
}

/**
 * Resolves + decrypts the current org's active Vapi API key using the
 * authenticated (RLS-scoped) Supabase client. Returns null when the
 * integration isn't configured, isn't active, or the stored key fails to
 * decrypt — callers treat all three uniformly as "not connected."
 */
export async function getVapiApiKey(): Promise<string | null> {
  const supabase = await createClient()
  const { data: integration, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !integration?.encrypted_api_key) return null

  try {
    return await decrypt(integration.encrypted_api_key)
  } catch {
    return null
  }
}

/**
 * Authenticated GET against the Vapi API with an 8s hard timeout.
 * Throws VapiApiError (with `.status`) on a non-2xx response or network
 * failure/timeout (status 0).
 */
export async function vapiFetch<T>(apiKey: string, path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${VAPI_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new VapiApiError(timedOut ? 'Vapi request timed out' : 'Failed to reach Vapi', 0)
  }

  if (!response.ok) {
    throw new VapiApiError(`Vapi returned ${response.status}`, response.status)
  }

  return response.json() as Promise<T>
}

/**
 * Authenticated write (PATCH today; the signature leaves room for other verbs
 * without a breaking change) against the Vapi API, with the same 8s hard
 * timeout and VapiApiError contract as vapiFetch().
 */
export async function vapiFetchWrite<T>(
  apiKey: string,
  path: string,
  method: 'PATCH',
  body: unknown
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${VAPI_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new VapiApiError(timedOut ? 'Vapi request timed out' : 'Failed to reach Vapi', 0)
  }

  if (!response.ok) {
    throw new VapiApiError(`Vapi returned ${response.status}`, response.status)
  }

  return response.json() as Promise<T>
}

// ── Minimal Vapi resource shapes ────────────────────────────────────────────
// Only the fields Xphere reads directly. Real Vapi payloads carry more
// (provider-specific) fields — the index signature keeps those accessible
// without widening every property to `unknown`.

export interface VapiPhoneNumber {
  id: string
  number?: string
  name?: string
  provider?: string
  assistantId?: string | null
  status?: string
  createdAt?: string
  [key: string]: unknown
}

export interface VapiAssistant {
  id: string
  name?: string
  [key: string]: unknown
}

/** GET /phone-number — returns Vapi's raw array shape unmodified (existing client-side consumers depend on it). */
export async function listVapiPhoneNumbers(apiKey: string): Promise<VapiPhoneNumber[]> {
  const data = await vapiFetch<VapiPhoneNumber[]>(apiKey, '/phone-number')
  return Array.isArray(data) ? data : []
}

/** GET /assistant — returns Vapi's raw array shape unmodified (existing client-side consumers depend on it). */
export async function listVapiAssistants(apiKey: string): Promise<VapiAssistant[]> {
  const data = await vapiFetch<VapiAssistant[]>(apiKey, '/assistant')
  return Array.isArray(data) ? data : []
}
