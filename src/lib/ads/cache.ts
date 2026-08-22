// Short-lived cache for ad-platform report responses.
//
// Every dashboard render and every AI tool call used to hit the Graph API /
// Google Ads API directly — the overview page alone fans out four parallel
// requests per account, per render. That burns the per-ad-account rate limit
// and puts network latency in front of every Copilot answer.
//
// This wraps those reads in a short TTL keyed by org + account + report +
// window. It is deliberately a *freshness* cache, not a store of record: the
// daily snapshot (ads_insights_daily) is where durable history lives.
//
// Redis is optional. When REDIS_URL is unset or the connection is down, every
// call falls through to the live fetch — the module never throws and never
// blocks on a broken cache.

import redis from '@/lib/redis'

/** Live-ish reads: long enough to collapse a render's fan-out, short enough
 *  that an operator who just changed a budget sees it on the next refresh. */
export const ADS_CACHE_TTL_SECONDS = 120

/** Historical windows can't change any more; hold them much longer. */
export const ADS_CACHE_TTL_HISTORICAL_SECONDS = 900

const KEY_PREFIX = 'ads:report'

export type AdsCacheKey = {
  orgId: string
  platform: 'meta' | 'google'
  accountId: string
  report: string
  /** Everything that changes the answer: date window, level, drill-down ids. */
  params?: Record<string, string | number | undefined | null>
}

function buildKey(key: AdsCacheKey): string {
  const params = Object.entries(key.params ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return `${KEY_PREFIX}:${key.orgId}:${key.platform}:${key.accountId}:${key.report}:${params}`
}

async function readCache<T>(key: string): Promise<T | null> {
  if (!redis.isReady) return null
  try {
    const raw = await redis.get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!redis.isReady) return
  try {
    await redis.setEx(key, ttlSeconds, value)
  } catch {
    /* cache writes are best-effort */
  }
}

/**
 * Return the cached payload for `key`, or run `fetcher` and cache its result.
 * A thrown fetcher error propagates and nothing is cached, so a transient API
 * failure never poisons the cache.
 */
export async function cachedReport<T>(
  key: AdsCacheKey,
  fetcher: () => Promise<T>,
  ttlSeconds: number = ADS_CACHE_TTL_SECONDS,
): Promise<T> {
  const cacheKey = buildKey(key)
  const hit = await readCache<T>(cacheKey)
  if (hit !== null) return hit

  const fresh = await fetcher()
  await writeCache(cacheKey, JSON.stringify(fresh), ttlSeconds)
  return fresh
}

/**
 * Drop every cached report for one account. Called after a mutation so the
 * operator sees their own budget/status change immediately rather than waiting
 * out the TTL.
 */
export async function invalidateAccountReports(
  orgId: string,
  platform: 'meta' | 'google',
  accountId: string,
): Promise<void> {
  if (!redis.isReady) return
  try {
    const pattern = `${KEY_PREFIX}:${orgId}:${platform}:${accountId}:*`
    // scanIterator avoids KEYS, which blocks the Redis event loop.
    const stale: string[] = []
    for await (const entry of redis.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      // node-redis v4 yields strings; v5 may yield string[] per batch.
      if (Array.isArray(entry)) stale.push(...entry)
      else stale.push(entry as unknown as string)
    }
    if (stale.length) await redis.del(stale)
  } catch {
    /* invalidation is best-effort — the TTL is the backstop */
  }
}

// ─── Google access-token cache ────────────────────────────────────────────────
// Google access tokens live ~1 hour but the client used to mint a fresh one on
// every single API call, so one campaigns page could spend several round-trips
// on the token endpoint alone (which is itself rate limited).

const TOKEN_KEY_PREFIX = 'ads:gtoken'
const TOKEN_TTL_SECONDS = 55 * 60

/** Process-local fallback so a Redis-less deployment still gets the benefit. */
const memoryTokens = new Map<string, { token: string; expiresAt: number }>()

function tokenKey(refreshToken: string): string {
  // The refresh token is a secret; key on a stable non-reversible digest.
  let hash = 0
  for (let i = 0; i < refreshToken.length; i++) {
    hash = (hash * 31 + refreshToken.charCodeAt(i)) | 0
  }
  return `${TOKEN_KEY_PREFIX}:${hash >>> 0}:${refreshToken.length}`
}

export async function getCachedAccessToken(refreshToken: string): Promise<string | null> {
  const key = tokenKey(refreshToken)

  const local = memoryTokens.get(key)
  if (local && local.expiresAt > Date.now()) return local.token

  if (!redis.isReady) return null
  try {
    return await redis.get(key)
  } catch {
    return null
  }
}

export async function setCachedAccessToken(refreshToken: string, accessToken: string): Promise<void> {
  const key = tokenKey(refreshToken)
  memoryTokens.set(key, { token: accessToken, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 })
  await writeCache(key, accessToken, TOKEN_TTL_SECONDS)
}

/** Drop a cached access token after the API rejects it as invalid. */
export async function clearCachedAccessToken(refreshToken: string): Promise<void> {
  const key = tokenKey(refreshToken)
  memoryTokens.delete(key)
  if (!redis.isReady) return
  try {
    await redis.del(key)
  } catch {
    /* best-effort */
  }
}
