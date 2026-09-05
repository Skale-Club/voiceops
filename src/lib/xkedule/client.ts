// src/lib/xkedule/client.ts
// HTTP client for the Xkedule /api/v1 integration surface.
// Per-org credentials (Settings → Integrations → Xkedule): tenantBaseUrl
// resolves the tenant by host; apiKey is the connection token sent as
// X-Xkedule-Key and validated against the tenant's stored value. No env vars.

// 15s, not 5s: measured against the live demo tenant, a cold-cache
// availability computation (3 staff × union math) took 5.1s and the old 5s
// budget aborted it mid-flight — the agent then had to tell the customer the
// calendar was down. Booking creation does slot-lock + schedule re-validation
// and can run longer still. The agent turn budget is 30s with tools, so 15s
// leaves room for the LLM turn around one slow call.
export const DEFAULT_TIMEOUT_MS = 15000

// A write is not a read. On 2026-09-04 a real booking through the mesh took
// longer than 15s on Xkedule's side: our client aborted, the tool reported
// failure, the agent told the customer the booking had not gone through -
// and Xkedule had already created it (booking #471). Telling someone they
// have no appointment when they do is worse than making them wait, so the
// mutations get a longer budget than the reads.
export const WRITE_TIMEOUT_MS = 30000

export interface XkeduleCredentials {
  tenantBaseUrl: string
  apiKey: string
  /**
   * Set by getXkeduleCredentialsForOrg (it already has this in scope, at no
   * extra cost). Optional because a couple of test fixtures build
   * XkeduleCredentials by hand without it; those callers just don't get
   * availability prefetch/caching scoped by org (see availability-cache.ts).
   */
  organizationId?: string
}

async function xkeduleFetch(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: XkeduleCredentials,
  timeoutMs?: number,
): Promise<Response> {
  const url = `${credentials.tenantBaseUrl.replace(/\/$/, '')}${path}`
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Xkedule-Key': credentials.apiKey,
    },
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  return response
}

export async function xkeduleFetchJson<T>(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: XkeduleCredentials,
  timeoutMs?: number,
): Promise<T> {
  const response = await xkeduleFetch(path, method, body, credentials, timeoutMs)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Xkedule API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<T>
}
