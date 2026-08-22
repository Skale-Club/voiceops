import { describe, expect, it } from 'vitest'

import {
  resolvePresetRange,
  resolveNonNativeGoogleRange,
  previousRange,
  isAdsDatePreset,
} from '@/lib/ads/date-range'

// Fixed reference point so the assertions don't drift with the wall clock.
const NOW = new Date('2026-08-21T12:00:00.000Z')

describe('Ads date presets', () => {
  it('recognises the shared preset vocabulary', () => {
    expect(isAdsDatePreset('last_30d')).toBe(true)
    expect(isAdsDatePreset('last_6m')).toBe(true)
    expect(isAdsDatePreset('since_forever')).toBe(false)
  })

  it('resolves presets Google has no keyword for', () => {
    expect(resolveNonNativeGoogleRange('last_3m', NOW)).toEqual({ since: '2026-05-21', until: '2026-08-21' })
    expect(resolveNonNativeGoogleRange('last_2y', NOW)).toEqual({ since: '2024-08-21', until: '2026-08-21' })
  })

  it('returns null for presets Google handles natively', () => {
    expect(resolveNonNativeGoogleRange('last_30d', NOW)).toBeNull()
    expect(resolveNonNativeGoogleRange('this_month', NOW)).toBeNull()
  })

  it('resolves a single-day window for today and yesterday', () => {
    expect(resolvePresetRange('today', NOW)).toEqual({ since: '2026-08-21', until: '2026-08-21' })
    expect(resolvePresetRange('yesterday', NOW)).toEqual({ since: '2026-08-20', until: '2026-08-20' })
  })

  it('resolves month boundaries', () => {
    expect(resolvePresetRange('this_month', NOW)).toEqual({ since: '2026-08-01', until: '2026-08-21' })
    expect(resolvePresetRange('last_month', NOW)).toEqual({ since: '2026-07-01', until: '2026-07-31' })
  })
})

describe('previousRange', () => {
  it('returns the immediately preceding window of the same length', () => {
    // 2026-08-01..2026-08-31 spans 30 days of difference, so the baseline ends
    // the day before and reaches back the same distance.
    expect(previousRange({ since: '2026-08-01', until: '2026-08-31' }))
      .toEqual({ since: '2026-07-01', until: '2026-07-31' })
  })

  it('handles a single-day window', () => {
    expect(previousRange({ since: '2026-08-21', until: '2026-08-21' }))
      .toEqual({ since: '2026-08-20', until: '2026-08-20' })
  })

  it('never overlaps the window it is a baseline for', () => {
    const current = resolvePresetRange('last_7d', NOW)
    const prior = previousRange(current)
    expect(prior.until < current.since).toBe(true)
  })
})
