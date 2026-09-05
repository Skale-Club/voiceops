// src/lib/xkedule/availability-cache.ts
//
// check_availability is the slowest step on both the phone call and the web
// widget: 8-14s cold, ~150ms once the provider's own cache is warm within
// ~60s of the last call. The conversation design guarantees a get_quote call
// (src/lib/xkedule/actions/quote.ts), followed by a human confirming the
// price out loud, BEFORE the customer is ever asked for a day — a 5-10s
// window in which the likely dates' availability can already be in flight.
//
// This module gives that window somewhere to land:
//   - fetchXkeduleAvailabilityCached() is a keyed TTL memo (memoTtl, see
//     src/lib/cache/ttl-memo.ts) that check-availability.ts's single-date
//     lookup goes through, so a prefetched date is a ~0ms in-process hit
//     instead of a repeat network round trip.
//   - prefetchXkeduleAvailability() is what quote.ts fires (fire-and-forget)
//     right after a successful quote: today/+1/+2 in the org's timezone,
//     through the exact same cache key a subsequent real lookup would use.
//
// Never cache the range ("when's your next opening?") shape from
// check-availability.ts — a prefetch can't guess an arbitrary startDate/
// endDate window, so there is nothing to warm for it, and it stays a plain
// pass-through fetch.

import { xkeduleFetchJson, type XkeduleCredentials } from './client'
import { memoTtl } from '@/lib/cache/ttl-memo'

// 60s: mirrors the provider's own warm window (measured: ~150ms when hit
// within ~60s of a prior call, 8-14s cold). Caching longer would risk
// serving a slot that just got booked by someone else past the point the
// provider itself would still consider "fresh"; caching shorter throws away
// hits inside the confirm-then-ask-for-a-day window we're targeting.
export const AVAILABILITY_CACHE_TTL_MS = 60_000

// Business timezone barely ever changes; this only exists so a burst of
// quotes in one conversation doesn't re-fetch business-info before every
// prefetch. Long TTL is safe — a stale timezone by a few minutes shifts
// "today" only right at midnight in that zone.
const TIMEZONE_CACHE_TTL_MS = 10 * 60 * 1000

// How many days ahead (inclusive of today) get prefetched after a quote.
export const PREFETCH_WINDOW_DAYS = 3

export interface AvailabilityCacheKeyParams {
  /** Undefined when the caller has no org context — see fetchXkeduleAvailabilityCached. */
  organizationId?: string
  tenantBaseUrl: string
  serviceIds: Array<number | string>
  date: string
  staffId?: number | string
  /** Response shape differs when staff attribution is requested, so it's part of the key too. */
  includeStaff?: boolean
}

/**
 * Key = organization id + tenantBaseUrl + sorted service ids + date (+
 * staffId / includeStaff when given). Sorted + de-duped service ids so
 * `serviceIds=5,7` and `serviceIds=7,5` are the same lookup — the provider
 * treats the set of services, not their order, as the input.
 */
export function buildAvailabilityCacheKey(params: AvailabilityCacheKeyParams): string {
  const ids = [...new Set(params.serviceIds.map((id) => Number(id)))]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .join(',')
  const org = params.organizationId ?? 'no-org'
  const staffPart = params.staffId != null ? `:staff=${Number(params.staffId)}` : ''
  const includeStaffPart = params.includeStaff ? ':withStaff' : ''
  return `xk-avail:${org}:${params.tenantBaseUrl}:${ids}:${params.date}${staffPart}${includeStaffPart}`
}

/**
 * Runs `fetchFn` through the shared TTL memo under a key built from
 * `keyParams`. A fresh cache entry is returned without calling `fetchFn` at
 * all; concurrent callers for the same key share one in-flight call; a
 * rejection caches nothing (memoTtl's own guarantee — see ttl-memo.ts).
 *
 * `fetchFn` must be the exact same call check-availability.ts would make on
 * a cache miss, so a hit is byte-identical to what that fetch would return.
 */
export function fetchXkeduleAvailabilityCached<T>(
  keyParams: AvailabilityCacheKeyParams,
  fetchFn: () => Promise<T>,
): Promise<T> {
  return memoTtl(buildAvailabilityCacheKey(keyParams), AVAILABILITY_CACHE_TTL_MS, fetchFn)
}

interface BusinessInfoTimezone {
  timezone?: string | null
}

/** Same /api/v1/business-info the business-info.ts action reads timezone
 * from; organizations.timezone (the Xphere-side column) isn't reachable from
 * here without a Supabase client, which quote.ts's action signature doesn't
 * carry — the Xkedule tenant's own declared timezone is the "existing way"
 * that's actually cheap given only `credentials` in scope. Falls back to UTC
 * on any failure (unset, timeout, malformed) — never lets a timezone lookup
 * fail the quote path or throw out of a fire-and-forget prefetch. */
async function resolveOrgTimezone(credentials: XkeduleCredentials): Promise<string> {
  const key = `xk-tz:${credentials.organizationId ?? credentials.tenantBaseUrl}`
  try {
    const info = await memoTtl(key, TIMEZONE_CACHE_TTL_MS, () =>
      xkeduleFetchJson<BusinessInfoTimezone>('/api/v1/business-info', 'GET', null, credentials),
    )
    return info.timezone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Today, today+1, ... today+(count-1) as YYYY-MM-DD in `tz`, computed by
 * calendar date (not a 24h-multiple offset) so a day boundary crossed by DST
 * still advances by exactly one calendar day. Never throws — an invalid tz
 * falls back to UTC. */
export function datesFromToday(tz: string, count: number): string[] {
  const dateParts = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })

  let todayStr: string
  try {
    todayStr = dateParts(tz).format(new Date())
  } catch {
    todayStr = dateParts('UTC').format(new Date())
  }

  const [y, m, d] = todayStr.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const utcParts = dateParts('UTC')
  return Array.from({ length: count }, (_, i) => utcParts.format(new Date(base + i * 86_400_000)))
}

/**
 * Fire-and-forget: warms the availability cache for `serviceIds` on
 * today/+1/+2 (PREFETCH_WINDOW_DAYS) in the org's timezone, through the same
 * cache a real check_availability call goes through. Call this right after a
 * successful get_quote — never await it.
 *
 * Skips silently (no throw, no log) when there's no org id to scope the
 * cache key by, or no valid service ids to prefetch. Every failure past that
 * point (timezone lookup, each availability fetch) is swallowed internally —
 * a prefetch miss just means the next real check_availability call pays the
 * normal cold-path cost, exactly as if prefetch didn't exist.
 */
export function prefetchXkeduleAvailability(
  credentials: XkeduleCredentials,
  serviceIds: Array<number | string>,
): void {
  const ids = [...new Set(serviceIds.map((id) => Number(id)))].filter((n) => Number.isFinite(n) && n > 0)
  if (!credentials.organizationId || ids.length === 0) return

  const organizationId = credentials.organizationId

  void (async () => {
    try {
      const tz = await resolveOrgTimezone(credentials)
      const dates = datesFromToday(tz, PREFETCH_WINDOW_DAYS)

      // Capped at PREFETCH_WINDOW_DAYS (3) concurrent requests by construction —
      // one per date, none sequential, none awaited by the caller.
      for (const date of dates) {
        const query = new URLSearchParams({ date, serviceIds: ids.join(',') })
        fetchXkeduleAvailabilityCached(
          { organizationId, tenantBaseUrl: credentials.tenantBaseUrl, serviceIds: ids, date },
          () => xkeduleFetchJson(`/api/v1/availability?${query.toString()}`, 'GET', null, credentials),
        ).catch(() => {
          // Swallowed by design — see doc comment above.
        })
      }
    } catch {
      // Swallowed by design — see doc comment above.
    }
  })()
}
