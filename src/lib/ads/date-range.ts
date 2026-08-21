// Server-side resolution of the shared Ads date presets.
//
// The dashboard sends either an explicit since/until pair or a named preset.
// Meta understands most presets natively; Google understands a subset. Presets
// neither platform supports natively (last_3m, last_6m, last_2y) are resolved
// to a concrete range here instead of silently collapsing to last_30d — which
// is what the Google path used to do, quietly answering a different question
// than the one the operator asked.

export type PresetRange = { since: string; until: string }

export const ADS_DATE_PRESETS = [
  'today',
  'yesterday',
  'last_7d',
  'last_14d',
  'last_30d',
  'last_3m',
  'last_6m',
  'last_90d',
  'this_month',
  'last_month',
  'last_year',
  'last_2y',
  'maximum',
] as const

export type AdsDatePreset = (typeof ADS_DATE_PRESETS)[number]

export function isAdsDatePreset(value: string): value is AdsDatePreset {
  return (ADS_DATE_PRESETS as readonly string[]).includes(value)
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Concrete range for presets that Google Ads has no native keyword for.
 * Returns null when the preset maps to a native GAQL duration.
 */
export function resolveNonNativeGoogleRange(preset: string, now = new Date()): PresetRange | null {
  const until = toIso(now)

  if (preset === 'last_3m') {
    const since = new Date(now)
    since.setUTCMonth(since.getUTCMonth() - 3)
    return { since: toIso(since), until }
  }
  if (preset === 'last_6m') {
    const since = new Date(now)
    since.setUTCMonth(since.getUTCMonth() - 6)
    return { since: toIso(since), until }
  }
  if (preset === 'last_2y') {
    const since = new Date(now)
    since.setUTCFullYear(since.getUTCFullYear() - 2)
    return { since: toIso(since), until }
  }
  // 'maximum' is Meta-only. Google's furthest equivalent is a wide explicit
  // window — two years back matches what the UI offers as "All time" there.
  if (preset === 'maximum') {
    const since = new Date(now)
    since.setUTCFullYear(since.getUTCFullYear() - 2)
    return { since: toIso(since), until }
  }
  return null
}

/** Concrete range for any preset — used by the daily snapshot and comparisons. */
export function resolvePresetRange(preset: string, now = new Date()): PresetRange {
  const until = toIso(now)
  const nonNative = resolveNonNativeGoogleRange(preset, now)
  if (nonNative) return nonNative

  const daysBack: Record<string, number> = {
    today: 0,
    yesterday: 1,
    last_7d: 7,
    last_14d: 14,
    last_30d: 30,
    last_90d: 90,
    last_year: 365,
  }

  if (preset === 'yesterday') {
    const day = new Date(now)
    day.setUTCDate(day.getUTCDate() - 1)
    return { since: toIso(day), until: toIso(day) }
  }
  if (preset === 'today') return { since: until, until }
  if (preset === 'this_month') {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { since: toIso(since), until }
  }
  if (preset === 'last_month') {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
    return { since: toIso(since), until: toIso(end) }
  }

  const back = daysBack[preset] ?? 30
  const since = new Date(now)
  since.setUTCDate(since.getUTCDate() - back)
  return { since: toIso(since), until }
}

/**
 * The immediately-preceding window of the same length — the baseline for
 * period-over-period comparisons.
 */
export function previousRange(range: PresetRange): PresetRange {
  const since = new Date(`${range.since}T00:00:00.000Z`)
  const until = new Date(`${range.until}T00:00:00.000Z`)
  const spanDays = Math.max(0, Math.round((until.getTime() - since.getTime()) / 86_400_000))

  const prevUntil = new Date(since)
  prevUntil.setUTCDate(prevUntil.getUTCDate() - 1)
  const prevSince = new Date(prevUntil)
  prevSince.setUTCDate(prevSince.getUTCDate() - spanDays)

  return { since: toIso(prevSince), until: toIso(prevUntil) }
}
