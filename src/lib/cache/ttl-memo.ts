// In-process memoisation with a TTL and in-flight de-duplication.
//
// Built for the Vapi tool route, where every tool call on a live phone call
// paid four sequential Supabase round trips before the provider was even
// contacted — org-by-assistant, routing mode, tool config, credentials —
// each ~100-300ms from the production container. Measured through
// production: business_info, a single provider GET, cost 1.8-2.2s of which
// the provider itself was ~0.2s. On a phone call that is silence.
//
// None of those answers change between two tool calls of one conversation,
// and an operator's change (a repointed assistant, a flipped routing mode, an
// edited description) reaching a live call up to `ttlMs` late is acceptable
// where a second of dead air per turn is not. Keep TTLs short; this is a
// freshness cache, never a store of record.
//
// Per-process only: a fresh container starts cold, and nothing here is
// shared across instances. Never cache a write, an idempotency check, or
// anything derived from the caller's own input.

interface Entry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Returns the cached value for `key` when fresh; otherwise runs `fn` once
 * (concurrent callers share the same promise) and caches its result for
 * `ttlMs`. A rejected `fn` caches nothing.
 */
export async function memoTtl<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) return hit.value as T

  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>

  const run = (async () => {
    try {
      const value = await fn()
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, run)
  return run
}

/** Test seam, and the escape hatch for a caller that just wrote what it cached. */
export function clearMemo(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
}
