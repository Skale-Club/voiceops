// tests/scheduling-slots.test.ts
// Phase 96 Plan 01 — unit tests for src/lib/scheduling/slots.ts.
//
// generateSlots is a pure function (no IO), so these tests are pure
// in-memory. We use date strings in the future to avoid the
// minAdvanceMinutes filter killing slots.

import { describe, it, expect } from 'vitest'
import { addMinutes, format } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import {
  generateSlots,
  generateSlotsWithReasons,
  type AvailabilityWindow,
  type BusyInterval,
} from '@/lib/calendar/slots'
import type { LookBusyConfig } from '@/lib/calendar/look-busy'

// Pick a date well in the future so minAdvanceMinutes (default 60) never matters.
const FUTURE_DATE = '2099-06-15' // Monday
const TZ_UTC = 'UTC'

describe('generateSlots', () => {
  it('Test 1: returns empty array when availability is null', () => {
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: null,
      existingBookings: [],
      busyTimes: [],
    })
    expect(slots).toEqual([])
  })

  it('Test 2: returns slots for a full 9-17 window in UTC with no conflicts (30-min slots)', () => {
    const availability: AvailabilityWindow[] = [{ start_time: '09:00', end_time: '17:00' }]
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability,
      existingBookings: [],
      busyTimes: [],
    })
    // 9:00 to 17:00 = 8 hours = 16 slots of 30 min
    expect(slots.length).toBe(16)
    expect(slots[0].startLocal).toBe('09:00')
    expect(slots[slots.length - 1].endLocal).toBe('17:00')
  })

  it('Test 3: excludes slots overlapping existing bookings', () => {
    const availability: AvailabilityWindow[] = [{ start_time: '09:00', end_time: '11:00' }]
    // Block 09:30-10:00 with an existing booking
    const blockedStart = fromZonedTime(`${FUTURE_DATE}T09:30:00`, TZ_UTC)
    const blockedEnd = fromZonedTime(`${FUTURE_DATE}T10:00:00`, TZ_UTC)
    const existing: BusyInterval[] = [
      { start: blockedStart.toISOString(), end: blockedEnd.toISOString() },
    ]
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability,
      existingBookings: existing,
      busyTimes: [],
    })
    // Available windows: 09:00-09:30, 10:00-10:30, 10:30-11:00 = 3 slots
    expect(slots.length).toBe(3)
    expect(slots.map((s) => s.startLocal)).toEqual(['09:00', '10:00', '10:30'])
  })

  it('Test 4: excludes slots overlapping Google Calendar busy times', () => {
    const availability: AvailabilityWindow[] = [{ start_time: '09:00', end_time: '11:00' }]
    const busyStart = fromZonedTime(`${FUTURE_DATE}T10:00:00`, TZ_UTC)
    const busyEnd = fromZonedTime(`${FUTURE_DATE}T11:00:00`, TZ_UTC)
    const busy: BusyInterval[] = [
      { start: busyStart.toISOString(), end: busyEnd.toISOString() },
    ]
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability,
      existingBookings: [],
      busyTimes: busy,
    })
    // Available: 09:00-09:30, 09:30-10:00 = 2 slots
    expect(slots.length).toBe(2)
    expect(slots.every((s) => s.startLocal < '10:00')).toBe(true)
  })

  it('Test 5: respects minAdvanceMinutes — past slots and slots within the cutoff are filtered', () => {
    // Use TODAY's date plus a couple hours so part of the window has already passed.
    // Build availability that ends 30 minutes after "now" — all slots should be filtered out
    // by a minAdvanceMinutes=60 cutoff.
    const now = new Date()
    const todayStr = format(now, 'yyyy-MM-dd')
    const slotsTight = generateSlots({
      date: todayStr,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: [{ start_time: '00:00', end_time: '00:30' }], // very short window at start of UTC day
      existingBookings: [],
      busyTimes: [],
      minAdvanceMinutes: 60 * 24 * 365, // a year — guarantees filter
    })
    expect(slotsTight).toEqual([])
  })

  it('Test 6: respects durationMinutes — 60-min slots yield half as many as 30-min', () => {
    const availability: AvailabilityWindow[] = [{ start_time: '09:00', end_time: '17:00' }]
    const slots60 = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 60,
      availability,
      existingBookings: [],
      busyTimes: [],
    })
    // 8 hours / 60 min = 8 slots
    expect(slots60.length).toBe(8)
    expect(slots60[0].startLocal).toBe('09:00')
    expect(slots60[0].endLocal).toBe('10:00')
  })

  it('Test 7: timezone handling — slot UTC ISO reflects host timezone offset', () => {
    // America/Sao_Paulo = UTC-3 (no DST since 2019). 09:00 local = 12:00 UTC.
    const availability: AvailabilityWindow[] = [{ start_time: '09:00', end_time: '10:00' }]
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: 'America/Sao_Paulo',
      durationMinutes: 60,
      availability,
      existingBookings: [],
      busyTimes: [],
    })
    expect(slots.length).toBe(1)
    // Local 09:00 in Sao_Paulo (UTC-3) is 12:00 UTC
    expect(slots[0].start).toBe(`${FUTURE_DATE}T12:00:00.000Z`)
    expect(slots[0].startLocal).toBe('09:00')
  })

  it('Test 8: end-of-day boundary — slot whose end exceeds window is dropped', () => {
    // Availability 23:00-23:30 with a 60-min duration — no slot fits.
    const availability: AvailabilityWindow[] = [{ start_time: '23:00', end_time: '23:30' }]
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 60,
      availability,
      existingBookings: [],
      busyTimes: [],
    })
    expect(slots).toEqual([])
  })

  // Migration 1140 allows 2+ windows per weekday. Before this, both slot
  // actions passed a single window, so a split-shift day threw.
  it('Test 9: multi-window day — both windows produce slots and the gap has none', () => {
    const availability: AvailabilityWindow[] = [
      { start_time: '08:00', end_time: '12:00' },
      { start_time: '14:00', end_time: '18:00' },
    ]
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 60,
      availability,
      existingBookings: [],
      busyTimes: [],
    })
    // 4 hours + 4 hours at 60 min each
    expect(slots.length).toBe(8)
    expect(slots.map((s) => s.startLocal)).toEqual([
      '08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00',
    ])
    // Nothing inside the 12:00-14:00 gap
    expect(slots.some((s) => s.startLocal >= '12:00' && s.startLocal < '14:00')).toBe(false)
  })

  it('Test 10: windows given out of order still yield chronological slots', () => {
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 60,
      availability: [
        { start_time: '15:00', end_time: '17:00' },
        { start_time: '09:00', end_time: '11:00' },
      ],
      existingBookings: [],
      busyTimes: [],
    })
    expect(slots.map((s) => s.startLocal)).toEqual(['09:00', '10:00', '15:00', '16:00'])
  })

  it('Test 11: overlapping windows do not emit duplicate slot positions', () => {
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 60,
      availability: [
        { start_time: '09:00', end_time: '12:00' },
        { start_time: '10:00', end_time: '13:00' },
      ],
      existingBookings: [],
      busyTimes: [],
    })
    expect(slots.map((s) => s.startLocal)).toEqual(['09:00', '10:00', '11:00', '12:00'])
  })
})

describe('generateSlots + look busy', () => {
  const EVENT_TYPE_ID = '11111111-2222-3333-4444-555555555555'
  const NINE_TO_FIVE: AvailabilityWindow[] = [{ start_time: '09:00', end_time: '17:00' }]

  function run(lookBusy: LookBusyConfig, eventTypeId: string = EVENT_TYPE_ID) {
    return generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: NINE_TO_FIVE,
      existingBookings: [],
      busyTimes: [],
      eventTypeId,
      lookBusy,
    })
  }

  it('hides nothing when the config is off', () => {
    expect(run({ mode: 'off', percent: null, maxPerDay: null }).length).toBe(16)
  })

  it('hide_percent withholds roughly the configured share of the grid', () => {
    const slots = run({ mode: 'hide_percent', percent: 50, maxPerDay: null })
    expect(slots.length).toBe(8) // 16 grid positions, half withheld
  })

  it('max_per_day caps the visible count', () => {
    const slots = run({ mode: 'max_per_day', percent: null, maxPerDay: 3 })
    expect(slots.length).toBe(3)
  })

  it('is deterministic across repeated calls', () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 60, maxPerDay: null }
    const a = run(config).map((s) => s.start)
    const b = run(config).map((s) => s.start)
    expect(a).toEqual(b)
  })

  it('ignores look busy when no eventTypeId is supplied (no hash key)', () => {
    const slots = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: NINE_TO_FIVE,
      existingBookings: [],
      busyTimes: [],
      lookBusy: { mode: 'max_per_day', percent: null, maxPerDay: 2 },
    })
    expect(slots.length).toBe(16)
  })

  it('a slot hidden by look busy stays hidden after a neighbouring slot is booked', () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 50, maxPerDay: null }
    const before = run(config)
    // Book the first visible slot, then regenerate.
    const booked: BusyInterval[] = [{ start: before[0].start, end: before[0].end }]
    const after = generateSlots({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: NINE_TO_FIVE,
      existingBookings: booked,
      busyTimes: [],
      eventTypeId: EVENT_TYPE_ID,
      lookBusy: config,
    })
    // Exactly the booked slot disappears — no withheld slot gets re-revealed.
    expect(after.map((s) => s.start)).toEqual(before.slice(1).map((s) => s.start))
  })

  // The troubleshooting view is reachable by anyone via ?debug=1, so without
  // the reveal flag its output must not betray that slots are being withheld.
  it('generateSlotsWithReasons without revealLookBusy matches generateSlots exactly', () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 50, maxPerDay: null }
    const shared = {
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: NINE_TO_FIVE,
      existingBookings: [],
      busyTimes: [],
      eventTypeId: EVENT_TYPE_ID,
      lookBusy: config,
    }
    const debug = generateSlotsWithReasons({ ...shared, revealLookBusy: false })
    expect(debug.map((s) => s.start)).toEqual(generateSlots(shared).map((s) => s.start))
    expect(debug.some((s) => s.reason === 'look_busy')).toBe(false)
  })

  it('generateSlotsWithReasons with revealLookBusy tags withheld slots', () => {
    const debug = generateSlotsWithReasons({
      date: FUTURE_DATE,
      timezone: TZ_UTC,
      durationMinutes: 30,
      availability: NINE_TO_FIVE,
      existingBookings: [],
      busyTimes: [],
      eventTypeId: EVENT_TYPE_ID,
      lookBusy: { mode: 'hide_percent', percent: 50, maxPerDay: null },
      revealLookBusy: true,
    })
    expect(debug.length).toBe(16) // whole grid visible to the operator
    expect(debug.filter((s) => s.reason === 'look_busy').length).toBe(8)
  })
})
