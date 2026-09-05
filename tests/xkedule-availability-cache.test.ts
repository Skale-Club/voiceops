// tests/xkedule-availability-cache.test.ts
//
// check_availability is 8-14s cold, ~150ms warm within ~60s. The
// conversation design guarantees a get_quote call (with a human confirming
// the price) BEFORE the customer is asked for a day, so quote.ts prefetches
// today/+1/+2 in the background through the same cache check-availability.ts
// reads from. These tests pin:
//   - a real check_availability hit within TTL never calls the provider
//   - a different date/service set misses
//   - a successful quote fires exactly 3 non-awaited availability fetches
//     and does not delay the quote's own response
//   - prefetch errors (timezone lookup or an availability fetch) never
//     surface to the caller
//   - a failed fetch is never cached

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/xkedule/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xkedule/client')>()
  return {
    ...actual,
    xkeduleFetchJson: vi.fn(),
  }
})

import { xkeduleFetchJson, type XkeduleCredentials } from '@/lib/xkedule/client'
import { clearMemo } from '@/lib/cache/ttl-memo'
import {
  AVAILABILITY_CACHE_TTL_MS,
  PREFETCH_WINDOW_DAYS,
  buildAvailabilityCacheKey,
  datesFromToday,
  fetchXkeduleAvailabilityCached,
  prefetchXkeduleAvailability,
} from '@/lib/xkedule/availability-cache'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { getXkeduleQuote } from '@/lib/xkedule/actions/quote'

const CREDS: XkeduleCredentials = {
  tenantBaseUrl: 'https://tenant.xkedule.com',
  apiKey: 'xph_test',
  organizationId: 'org-1',
}

const SLOTS = { slots: [{ time: '09:00', available: true }] }

async function flush(ticks = 10) {
  // Lets a fire-and-forget async chain (timezone lookup, then N availability
  // fetches, all already-resolved mocks) settle before assertions run. Real
  // macrotask ticks, not vi.waitFor — there is no assertion to poll on here,
  // just pending promise chains that need turns of the event loop.
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearMemo()
})

describe('buildAvailabilityCacheKey', () => {
  it('is stable regardless of service-id order', () => {
    const a = buildAvailabilityCacheKey({
      organizationId: 'org-1',
      tenantBaseUrl: 'https://t.example',
      serviceIds: [5, 7],
      date: '2026-09-10',
    })
    const b = buildAvailabilityCacheKey({
      organizationId: 'org-1',
      tenantBaseUrl: 'https://t.example',
      serviceIds: [7, 5],
      date: '2026-09-10',
    })
    expect(a).toBe(b)
  })

  it('differs by organization, date, staffId and includeStaff', () => {
    const base = { tenantBaseUrl: 'https://t.example', serviceIds: [5], date: '2026-09-10' }
    const k = (extra: object) => buildAvailabilityCacheKey({ ...base, ...extra })
    const keys = new Set([
      k({ organizationId: 'org-1' }),
      k({ organizationId: 'org-2' }),
      k({ organizationId: 'org-1', date: '2026-09-11' }),
      k({ organizationId: 'org-1', staffId: 3 }),
      k({ organizationId: 'org-1', includeStaff: true }),
    ])
    expect(keys.size).toBe(5)
  })
})

describe('datesFromToday', () => {
  it('returns `count` consecutive YYYY-MM-DD calendar dates starting today', () => {
    const dates = datesFromToday('UTC', 3)
    expect(dates).toHaveLength(3)
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const [d0, d1, d2] = dates.map((d) => Date.parse(d))
    expect(d1 - d0).toBe(86_400_000)
    expect(d2 - d1).toBe(86_400_000)
  })

  it('falls back to UTC on an invalid timezone instead of throwing', () => {
    expect(() => datesFromToday('not/a/zone', 1)).not.toThrow()
    expect(datesFromToday('not/a/zone', 1)[0]).toBe(datesFromToday('UTC', 1)[0])
  })
})

describe('fetchXkeduleAvailabilityCached', () => {
  const keyParams = {
    organizationId: 'org-1',
    tenantBaseUrl: 'https://tenant.xkedule.com',
    serviceIds: [5],
    date: '2026-09-10',
  }

  it('hits within TTL: the underlying fetch runs once', async () => {
    const fetchFn = vi.fn().mockResolvedValue(SLOTS)
    const first = await fetchXkeduleAvailabilityCached(keyParams, fetchFn)
    const second = await fetchXkeduleAvailabilityCached(keyParams, fetchFn)
    expect(second).toBe(first)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('misses on a different date', async () => {
    const fetchFn = vi.fn().mockResolvedValue(SLOTS)
    await fetchXkeduleAvailabilityCached(keyParams, fetchFn)
    await fetchXkeduleAvailabilityCached({ ...keyParams, date: '2026-09-11' }, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('misses on a different service-id set', async () => {
    const fetchFn = vi.fn().mockResolvedValue(SLOTS)
    await fetchXkeduleAvailabilityCached(keyParams, fetchFn)
    await fetchXkeduleAvailabilityCached({ ...keyParams, serviceIds: [9] }, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('never caches a rejection', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(SLOTS)
    await expect(fetchXkeduleAvailabilityCached(keyParams, fetchFn)).rejects.toThrow('boom')
    const result = await fetchXkeduleAvailabilityCached(keyParams, fetchFn)
    expect(result).toBe(SLOTS)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('checkXkeduleAvailability + prefetch integration', () => {
  it('a real check_availability call for a prefetched date/service set is a cache hit (byte-identical, no network call)', async () => {
    // 1 business-info call (timezone) + PREFETCH_WINDOW_DAYS availability calls.
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ timezone: 'UTC' })
    vi.mocked(xkeduleFetchJson).mockResolvedValue(SLOTS)

    const dates = datesFromToday('UTC', PREFETCH_WINDOW_DAYS)
    prefetchXkeduleAvailability(CREDS, [5])
    await flush()

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1 + PREFETCH_WINDOW_DAYS)

    const result = await checkXkeduleAvailability({ serviceId: 5, date: dates[0] }, CREDS)

    // Still only the calls from the prefetch itself — the real lookup was
    // served from cache, no new network call.
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1 + PREFETCH_WINDOW_DAYS)
    expect(result).toBe('Available slots on ' + dates[0] + ': 09:00')
  })

  it('a different date is a cache miss and still hits the provider', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(SLOTS)
    prefetchXkeduleAvailability(CREDS, [5])
    await flush()
    vi.mocked(xkeduleFetchJson).mockClear()

    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ slots: [{ time: '15:00', available: true }] })
    const result = await checkXkeduleAvailability({ serviceId: 5, date: '2099-01-01' }, CREDS)

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1)
    expect(result).toContain('15:00')
  })

  it('a different service-id set is a cache miss', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(SLOTS)
    const dates = datesFromToday('UTC', PREFETCH_WINDOW_DAYS)
    prefetchXkeduleAvailability(CREDS, [5])
    await flush()
    vi.mocked(xkeduleFetchJson).mockClear()

    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(SLOTS)
    await checkXkeduleAvailability({ serviceId: 999, date: dates[0] }, CREDS)

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1)
  })
})

describe('getXkeduleQuote prefetch', () => {
  const QUOTE_RESPONSE = {
    items: [{ serviceId: 5, serviceName: 'Deep Clean', price: '120.00' }],
    subtotal: '120.00',
    totalDurationMinutes: 90,
    requiresConfirmation: false,
    currency: 'usd',
  }

  it('fires PREFETCH_WINDOW_DAYS non-awaited availability fetches after a successful quote, without delaying the quote result', async () => {
    let resolveTimezone!: (v: unknown) => void
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(QUOTE_RESPONSE)
    // business-info (timezone) call from resolveOrgTimezone: parked so it
    // hasn't resolved by the time getXkeduleQuote itself returns, proving
    // the quote response never waited on it.
    vi.mocked(xkeduleFetchJson).mockImplementationOnce(() => new Promise((resolve) => (resolveTimezone = resolve)))

    const result = await getXkeduleQuote({ serviceId: 5 }, CREDS)

    expect(result).toContain('Deep Clean: $120.00')
    // Only the quote call + the still-pending timezone call so far — the
    // three availability fetches haven't been reached because the prefetch
    // chain is still awaiting resolveOrgTimezone, and none of that blocked
    // getXkeduleQuote's own resolution above.
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(2)

    vi.mocked(xkeduleFetchJson).mockResolvedValue(SLOTS)
    resolveTimezone({ timezone: 'UTC' })
    await flush()

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(2 + PREFETCH_WINDOW_DAYS)
  })

  it('swallows a prefetch error (timezone lookup fails) without throwing or affecting future calls', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(QUOTE_RESPONSE)
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('business-info down'))
    vi.mocked(xkeduleFetchJson).mockResolvedValue(SLOTS)

    const result = await getXkeduleQuote({ serviceId: 5 }, CREDS)
    expect(result).toContain('Deep Clean: $120.00')

    await flush()
    // Falls back to UTC and still fires the 3 availability fetches.
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(2 + PREFETCH_WINDOW_DAYS)
  })

  it('swallows a prefetch error (an availability fetch fails) without throwing', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(QUOTE_RESPONSE)
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ timezone: 'UTC' })
    vi.mocked(xkeduleFetchJson).mockRejectedValue(new Error('provider down'))

    const result = await getXkeduleQuote({ serviceId: 5 }, CREDS)
    expect(result).toContain('Deep Clean: $120.00')

    await flush()
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(2 + PREFETCH_WINDOW_DAYS)
    // A failed prefetch caches nothing: a subsequent real lookup still hits the provider.
    vi.mocked(xkeduleFetchJson).mockClear()
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(SLOTS)
    const [today] = datesFromToday('UTC', 1)
    const avail = await checkXkeduleAvailability({ serviceId: 5, date: today }, CREDS)
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1)
    expect(avail).toContain('09:00')
  })

  it('does not prefetch when credentials carry no organizationId', async () => {
    const credsNoOrg: XkeduleCredentials = { tenantBaseUrl: 'https://tenant.xkedule.com', apiKey: 'xph_test' }
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce(QUOTE_RESPONSE)

    const result = await getXkeduleQuote({ serviceId: 5 }, credsNoOrg)
    expect(result).toContain('Deep Clean: $120.00')

    await flush()
    // Only the quote call — no timezone lookup, no availability fetches.
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1)
  })

  it('does not prefetch when the quote call itself fails', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 422: unknown_service'))

    const result = await getXkeduleQuote({ serviceId: 999 }, CREDS)
    expect(result).toContain('could not be found')

    await flush()
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledTimes(1)
  })
})

describe('AVAILABILITY_CACHE_TTL_MS', () => {
  it('is 60s', () => {
    expect(AVAILABILITY_CACHE_TTL_MS).toBe(60_000)
  })
})
