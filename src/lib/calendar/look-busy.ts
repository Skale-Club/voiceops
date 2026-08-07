// "Look busy" — artificial scarcity for calendar slots.
//
// An operator can configure an event type to withhold some genuinely free
// slots so the booking page reads as in-demand. This module is the single
// source of truth for WHICH slots get withheld, and it is deliberately pure:
// no IO, no Date.now(), no Math.random().
//
// Two callers must agree byte-for-byte or a booker gets shown a slot and then
// refused on submit:
//   - src/lib/calendar/slots.ts (display path)
//   - src/lib/calendar/booking-validation.ts (every booker-facing write path)
//
// Two invariants make that agreement possible:
//
//  1. The hide-set is computed over the day's full CANDIDATE GRID — every slot
//     position the availability windows produce — *before* confirmed bookings
//     and Google Calendar busy times are subtracted. So a slot's hidden state
//     never flips as the day fills up, and the validation path can reproduce
//     the set from (event type, date, windows, duration) without querying
//     bookings at all. Filtering the post-conflict free list instead would
//     re-reveal withheld slots as real bookings arrived, which both looks like
//     a bug and leaks the mechanism.
//
//  2. The pick is a deterministic hash of the slot's identity, never random.
//     Random would give a different agenda on every refresh and to every
//     booker, and would make the display/validation agreement impossible.

export type LookBusyMode = 'off' | 'hide_percent' | 'max_per_day'

export interface LookBusyConfig {
  mode: LookBusyMode
  percent: number | null // hide_percent: 1-90
  maxPerDay: number | null // max_per_day: 1-50
}

export const LOOK_BUSY_OFF: LookBusyConfig = {
  mode: 'off',
  percent: null,
  maxPerDay: null,
}

// Matches the DB CHECK on event_types.look_busy_percent (migration 1266).
const MAX_HIDE_PERCENT = 90

// FNV-1a (32-bit). Chosen for being tiny, dependency-free and stable across
// runtimes — the same string must hash identically in the Next.js server and
// in tests, forever, or previously-visible slots would silently move.
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function slotHash(eventTypeId: string, date: string, slotStartIso: string): number {
  return fnv1a(`${eventTypeId}|${date}|${slotStartIso}`)
}

// Narrow a calendar_profiles row to a config. Anything other than a recognised
// mode (including null, e.g. a host with no profile row yet) reads as off.
export function lookBusyConfigFor(row: {
  look_busy_mode?: string | null
  look_busy_percent?: number | null
  look_busy_max_per_day?: number | null
}): LookBusyConfig {
  const mode = row.look_busy_mode
  if (mode !== 'hide_percent' && mode !== 'max_per_day') return LOOK_BUSY_OFF
  return {
    mode,
    percent: row.look_busy_percent ?? null,
    maxPerDay: row.look_busy_max_per_day ?? null,
  }
}

export function isLookBusyActive(config: LookBusyConfig): boolean {
  if (config.mode === 'hide_percent') return (config.percent ?? 0) > 0
  if (config.mode === 'max_per_day') return (config.maxPerDay ?? 0) > 0
  return false
}

// The subset of `gridStarts` to withhold. Callers pass the day's full candidate
// grid (chronological, ISO 8601 UTC starts) and drop whatever comes back.
//
// Guarantees:
//   - 'off', an empty grid, or a mode whose parameter is null/<=0 hides nothing.
//   - hide_percent always leaves at least one grid position visible.
//   - max_per_day leaves exactly min(maxPerDay, grid.length) visible, spread
//     across the day rather than clustered.
export function computeHiddenSlotStarts(params: {
  eventTypeId: string
  date: string // 'YYYY-MM-DD' in the host's timezone
  gridStarts: string[]
  config: LookBusyConfig
}): Set<string> {
  const { eventTypeId, date, gridStarts, config } = params
  const hidden = new Set<string>()

  if (gridStarts.length === 0 || !isLookBusyActive(config)) return hidden

  if (config.mode === 'hide_percent') {
    const pct = Math.min(config.percent ?? 0, MAX_HIDE_PERCENT)
    // Never hide the entire day: cap at length - 1.
    const hideCount = Math.min(
      gridStarts.length - 1,
      Math.round((gridStarts.length * pct) / 100),
    )
    if (hideCount <= 0) return hidden

    const ranked = gridStarts
      .map((start) => ({ start, hash: slotHash(eventTypeId, date, start) }))
      // Tie-break on the start string so equal hashes still order stably.
      .sort((a, b) => a.hash - b.hash || (a.start < b.start ? -1 : 1))

    for (let i = 0; i < hideCount; i++) hidden.add(ranked[i].start)
    return hidden
  }

  // max_per_day: cut the grid into `keep` contiguous buckets and keep the
  // lowest-hash slot of each. A plain hash-rank cut could put every survivor
  // in the same morning block; bucketing spreads them across the day, which is
  // both what an operator means by "show 3 times" and less obviously synthetic.
  const keep = Math.min(config.maxPerDay ?? 0, gridStarts.length)
  if (keep >= gridStarts.length) return hidden

  const visible = new Set<string>()
  for (let bucket = 0; bucket < keep; bucket++) {
    const from = Math.floor((bucket * gridStarts.length) / keep)
    const to = Math.floor(((bucket + 1) * gridStarts.length) / keep) // exclusive
    let best: string | null = null
    let bestHash = Number.POSITIVE_INFINITY
    for (let i = from; i < to; i++) {
      const start = gridStarts[i]
      const hash = slotHash(eventTypeId, date, start)
      if (hash < bestHash || (hash === bestHash && best !== null && start < best)) {
        bestHash = hash
        best = start
      }
    }
    if (best !== null) visible.add(best)
  }

  for (const start of gridStarts) {
    if (!visible.has(start)) hidden.add(start)
  }
  return hidden
}

// Single-slot convenience for the write path, which validates one requested
// start against the same grid the display path built.
export function isSlotHidden(params: {
  eventTypeId: string
  date: string
  gridStarts: string[]
  config: LookBusyConfig
  slotStartIso: string
}): boolean {
  if (!isLookBusyActive(params.config)) return false
  return computeHiddenSlotStarts(params).has(params.slotStartIso)
}
