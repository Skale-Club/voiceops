// tests/calendar-look-busy.test.ts
// Unit tests for src/lib/calendar/look-busy.ts — the pure hide-set engine
// shared by the slot display path and the booking write path. Everything here
// is in-memory: the module has no IO, no Date.now() and no Math.random().

import { describe, it, expect } from 'vitest'
import {
  computeHiddenSlotStarts,
  isLookBusyActive,
  isSlotHidden,
  LOOK_BUSY_OFF,
  type LookBusyConfig,
} from '@/lib/calendar/look-busy'

const EVENT_TYPE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const DATE = '2099-06-15'

// 16 half-hour positions, 09:00 → 17:00.
function grid(count = 16, startHour = 9): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const total = startHour * 60 + i * 30
    const h = String(Math.floor(total / 60)).padStart(2, '0')
    const m = String(total % 60).padStart(2, '0')
    out.push(`${DATE}T${h}:${m}:00.000Z`)
  }
  return out
}

function hidden(config: LookBusyConfig, gridStarts = grid()) {
  return computeHiddenSlotStarts({ eventTypeId: EVENT_TYPE_ID, date: DATE, gridStarts, config })
}

describe('isLookBusyActive', () => {
  it('off is never active', () => {
    expect(isLookBusyActive(LOOK_BUSY_OFF)).toBe(false)
  })

  it('a mode whose parameter is null is not active', () => {
    expect(isLookBusyActive({ mode: 'hide_percent', percent: null, maxPerDay: null })).toBe(false)
    expect(isLookBusyActive({ mode: 'max_per_day', percent: null, maxPerDay: null })).toBe(false)
  })

  it('a mode with a positive parameter is active', () => {
    expect(isLookBusyActive({ mode: 'hide_percent', percent: 25, maxPerDay: null })).toBe(true)
    expect(isLookBusyActive({ mode: 'max_per_day', percent: null, maxPerDay: 4 })).toBe(true)
  })
})

describe('computeHiddenSlotStarts — no-ops', () => {
  it('off hides nothing', () => {
    expect(hidden(LOOK_BUSY_OFF).size).toBe(0)
  })

  it('an empty grid hides nothing', () => {
    expect(hidden({ mode: 'hide_percent', percent: 50, maxPerDay: null }, []).size).toBe(0)
  })

  it('a null parameter hides nothing', () => {
    expect(hidden({ mode: 'hide_percent', percent: null, maxPerDay: null }).size).toBe(0)
    expect(hidden({ mode: 'max_per_day', percent: null, maxPerDay: null }).size).toBe(0)
  })
})

describe('computeHiddenSlotStarts — hide_percent', () => {
  it('hides the configured share of the grid', () => {
    expect(hidden({ mode: 'hide_percent', percent: 25, maxPerDay: null }).size).toBe(4)
    expect(hidden({ mode: 'hide_percent', percent: 50, maxPerDay: null }).size).toBe(8)
    expect(hidden({ mode: 'hide_percent', percent: 75, maxPerDay: null }).size).toBe(12)
  })

  it('never hides the entire day, even at the 90 cap', () => {
    const g = grid()
    const set = hidden({ mode: 'hide_percent', percent: 90, maxPerDay: null }, g)
    expect(set.size).toBeLessThan(g.length)
    expect(set.size).toBe(14) // round(16 * 0.9)
  })

  it('clamps a percent above the DB cap instead of hiding everything', () => {
    const g = grid()
    // 100 should never reach the caller (DB CHECK is 1-90), but if it did the
    // engine must still leave a visible slot rather than empty the day.
    const set = hidden({ mode: 'hide_percent', percent: 100, maxPerDay: null }, g)
    expect(set.size).toBe(14)
  })

  it('leaves at least one slot visible on a single-slot day', () => {
    const g = grid(1)
    expect(hidden({ mode: 'hide_percent', percent: 90, maxPerDay: null }, g).size).toBe(0)
  })

  it('only ever hides slots that are in the grid', () => {
    const g = grid()
    for (const start of hidden({ mode: 'hide_percent', percent: 50, maxPerDay: null }, g)) {
      expect(g).toContain(start)
    }
  })
})

describe('computeHiddenSlotStarts — max_per_day', () => {
  it('leaves exactly the configured number visible', () => {
    const g = grid()
    for (const keep of [1, 3, 5, 8]) {
      const set = hidden({ mode: 'max_per_day', percent: null, maxPerDay: keep }, g)
      expect(g.length - set.size).toBe(keep)
    }
  })

  it('hides nothing when the grid is shorter than the cap', () => {
    const g = grid(3)
    expect(hidden({ mode: 'max_per_day', percent: null, maxPerDay: 5 }, g).size).toBe(0)
  })

  it('spreads survivors across the day instead of clustering them', () => {
    const g = grid() // 09:00 → 16:30
    const set = hidden({ mode: 'max_per_day', percent: null, maxPerDay: 4 }, g)
    const visible = g.filter((s) => !set.has(s))
    expect(visible.length).toBe(4)
    // One survivor per quarter of the grid (buckets of 4 positions).
    const buckets = visible.map((s) => Math.floor(g.indexOf(s) / 4))
    expect(new Set(buckets).size).toBe(4)
  })
})

describe('determinism', () => {
  it('repeated calls with identical input return an identical set', () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 40, maxPerDay: null }
    const a = [...hidden(config)].sort()
    const b = [...hidden(config)].sort()
    expect(a).toEqual(b)
  })

  it('a different event type gets a different withheld set', () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 50, maxPerDay: null }
    const g = grid()
    const mine = [...computeHiddenSlotStarts({ eventTypeId: EVENT_TYPE_ID, date: DATE, gridStarts: g, config })].sort()
    const other = [...computeHiddenSlotStarts({ eventTypeId: 'ffffffff-0000-0000-0000-000000000000', date: DATE, gridStarts: g, config })].sort()
    expect(mine).not.toEqual(other)
  })

  it('a different date gets a different withheld set', () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 50, maxPerDay: null }
    const g = grid()
    const day1 = [...computeHiddenSlotStarts({ eventTypeId: EVENT_TYPE_ID, date: '2099-06-15', gridStarts: g, config })].sort()
    const day2 = [...computeHiddenSlotStarts({ eventTypeId: EVENT_TYPE_ID, date: '2099-06-16', gridStarts: g, config })].sort()
    expect(day1).not.toEqual(day2)
  })
})

describe('isSlotHidden', () => {
  it('agrees with computeHiddenSlotStarts for every grid position', () => {
    const config: LookBusyConfig = { mode: 'max_per_day', percent: null, maxPerDay: 5 }
    const g = grid()
    const set = hidden(config, g)
    for (const start of g) {
      expect(isSlotHidden({ eventTypeId: EVENT_TYPE_ID, date: DATE, gridStarts: g, config, slotStartIso: start }))
        .toBe(set.has(start))
    }
  })

  it('is false for every slot when look busy is off', () => {
    const g = grid()
    for (const start of g) {
      expect(isSlotHidden({ eventTypeId: EVENT_TYPE_ID, date: DATE, gridStarts: g, config: LOOK_BUSY_OFF, slotStartIso: start }))
        .toBe(false)
    }
  })

  it('is false for a start that is not on the grid at all', () => {
    const g = grid()
    expect(isSlotHidden({
      eventTypeId: EVENT_TYPE_ID,
      date: DATE,
      gridStarts: g,
      config: { mode: 'hide_percent', percent: 50, maxPerDay: null },
      slotStartIso: `${DATE}T03:17:00.000Z`,
    })).toBe(false)
  })
})
