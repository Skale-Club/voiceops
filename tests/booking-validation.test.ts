// tests/booking-validation.test.ts
// Phase 126 Plan 01 — unit tests for src/lib/calendar/booking-validation.ts.
//
// Strategy: mock fetchBusyTimes (the only external dependency) and feed
// resolveAndValidateSlot a fake Supabase client via a chainable thenable
// proxy, modeled after buildFakeAdmin in tests/calendar-bookings.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/calendar/google-calendar', () => ({
  fetchBusyTimes: vi.fn(async () => []),
}))

import { fetchBusyTimes } from '@/lib/calendar/google-calendar'
import { resolveAndValidateSlot } from '@/lib/calendar/booking-validation'
import { computeHiddenSlotStarts, type LookBusyConfig } from '@/lib/calendar/look-busy'
import { generateSlots } from '@/lib/calendar/slots'

// ─── Test-data fixtures ─────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const EVENT_TYPE_ID = '00000000-0000-0000-0000-000000000222'
const OTHER_EVENT_TYPE_ID = '00000000-0000-0000-0000-000000000223'
const USER_ID = '00000000-0000-0000-0000-000000000333'

const eventTypeRow = {
  id: EVENT_TYPE_ID,
  org_id: ORG_ID,
  user_id: USER_ID,
  title: 'Discovery Call',
  duration_minutes: 30,
  location_type: 'video',
  location_value: 'https://meet.example.com/abc',
  allowed_location_kinds: ['video'],
}

// 2099-06-15 is a Monday (dow = 1) — well past the 60-min advance cutoff and
// far enough in the future to stay deterministic. Confirmed by the same
// fixture used in tests/calendar-slots.test.ts.
const FUTURE_DATE = '2099-06-15'

interface FakeResp {
  data?: unknown
  error?: { message: string; code?: string } | null
}

function makeProxy(result: FakeResp) {
  const proxy: any = {}
  const chain = ['select', 'eq', 'in', 'is', 'lt', 'gt', 'gte', 'lte', 'order']
  for (const m of chain) proxy[m] = vi.fn(() => proxy)
  proxy.maybeSingle = vi.fn(() => Promise.resolve(result))
  proxy.single = vi.fn(() => Promise.resolve(result))
  proxy.then = (resolve: (v: FakeResp) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return proxy
}

// Builds a fake Supabase client covering every query resolveAndValidateSlot
// issues: event_types (twice — active-check .maybeSingle(), then the
// organizer-wide id list as a plain array), calendar_profiles, user_availability
// (array — never .maybeSingle(), see Pitfall 5), and bookings (array conflict
// check). Also exposes the created proxies per table so tests can assert which
// filters were actually applied (e.g. .eq('status', 'confirmed'), .is('external_source', null)).
function buildFakeSupabase(opts: {
  eventType?: FakeResp
  organizerEventTypes?: FakeResp
  profile?: FakeResp
  windows?: FakeResp
  conflicts?: FakeResp
}) {
  const eventTypeResp = opts.eventType ?? { data: eventTypeRow, error: null }
  const organizerEventTypesResp =
    opts.organizerEventTypes ?? { data: [{ id: EVENT_TYPE_ID }], error: null }
  const profileResp = opts.profile ?? { data: { timezone: 'UTC' }, error: null }
  const windowsResp = opts.windows ?? { data: [], error: null }
  const conflictsResp = opts.conflicts ?? { data: [], error: null }

  const proxies: Record<string, any[]> = {}
  let eventTypesCallIdx = 0

  const client = {
    from: vi.fn((table: string) => {
      let proxy: any
      if (table === 'event_types') {
        const which = eventTypesCallIdx++
        proxy = makeProxy(which === 0 ? eventTypeResp : organizerEventTypesResp)
      } else if (table === 'calendar_profiles') {
        proxy = makeProxy(profileResp)
      } else if (table === 'user_availability') {
        proxy = makeProxy(windowsResp)
      } else if (table === 'bookings') {
        proxy = makeProxy(conflictsResp)
      } else {
        proxy = makeProxy({ data: null, error: null })
      }
      proxies[table] = proxies[table] ?? []
      proxies[table].push(proxy)
      return proxy
    }),
  }

  return { client, proxies }
}

// ─── resolveAndValidateSlot ─────────────────────────────────────────────────

describe('resolveAndValidateSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 1: an unparseable start_at returns invalid_start_at', async () => {
    const { client } = buildFakeSupabase({})
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: 'not-a-date',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_start_at')
  })

  it('Test 2: a missing or inactive event type returns event_type_not_found', async () => {
    const { client } = buildFakeSupabase({ eventType: { data: null, error: null } })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('event_type_not_found')
  })

  it('Test 3: a start time less than MIN_ADVANCE_MINUTES (60) away returns outside_availability', async () => {
    const { client } = buildFakeSupabase({})
    const tooSoon = new Date(Date.now() + 30 * 60_000).toISOString()
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: tooSoon,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('outside_availability')
  })

  it('Test 4: a sufficiently future start with no configured availability window for that weekday returns outside_availability', async () => {
    const { client } = buildFakeSupabase({ windows: { data: [], error: null } })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('outside_availability')
  })

  it('Test 5: a weekday with two configured windows accepts a grid-aligned start inside the second window', async () => {
    const { client } = buildFakeSupabase({
      windows: {
        data: [
          { start_time: '08:00:00', end_time: '12:00:00' },
          { start_time: '14:00:00', end_time: '18:00:00' },
        ],
        error: null,
      },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T14:30:00.000Z`,
    })
    expect(result.ok).toBe(true)
  })

  it('Test 6: a start inside a window but off the duration-minute grid returns outside_availability', async () => {
    const { client } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
    })
    // 08:07 is 7 minutes off the 08:00/08:30/09:00... 30-min cadence.
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:07:00.000Z`,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('outside_availability')
  })

  it('Test 7: a grid-aligned in-window start overlapping a confirmed native booking under a DIFFERENT event type for the same organizer returns slot_taken', async () => {
    const { client, proxies } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
      organizerEventTypes: {
        data: [{ id: EVENT_TYPE_ID }, { id: OTHER_EVENT_TYPE_ID }],
        error: null,
      },
      conflicts: { data: [{ id: 'other-booking' }], error: null },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('slot_taken')
    // Proves the conflict check is organizer-wide (both event type ids), not
    // scoped to the single event_type_id being booked — the actual CAL-01 gap.
    const bookingsProxy = proxies.bookings[0]
    expect(bookingsProxy.in).toHaveBeenCalledWith('event_type_id', [
      EVENT_TYPE_ID,
      OTHER_EVENT_TYPE_ID,
    ])
  })

  it('Test 8: an overlapping booking that is not confirmed does not block (the confirmed-status filter excludes it)', async () => {
    const { client, proxies } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
      // Empty result simulates .eq('status', 'confirmed') excluding the cancelled row at the DB level.
      conflicts: { data: [], error: null },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(true)
    const bookingsProxy = proxies.bookings[0]
    expect(bookingsProxy.eq).toHaveBeenCalledWith('status', 'confirmed')
  })

  it('Test 9: an overlapping Xkedule mirror row does not block (the external_source IS NULL filter excludes it)', async () => {
    const { client, proxies } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
      // Empty result simulates .is('external_source', null) excluding the mirror row at the DB level.
      conflicts: { data: [], error: null },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(true)
    const bookingsProxy = proxies.bookings[0]
    expect(bookingsProxy.is).toHaveBeenCalledWith('external_source', null)
  })

  it('Test 10: no DB conflict but an overlapping Google Calendar busy interval returns slot_taken', async () => {
    vi.mocked(fetchBusyTimes).mockResolvedValueOnce([
      { start: `${FUTURE_DATE}T08:00:00.000Z`, end: `${FUTURE_DATE}T08:30:00.000Z` },
    ])
    const { client } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('slot_taken')
  })

  it('Test 11: a fully valid, grid-aligned, non-conflicting request derives endAt from duration_minutes exactly', async () => {
    const { client } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.endAt.getTime() - result.data.startAt.getTime()).toBe(30 * 60_000)
      expect(result.data.hostTimezone).toBe('UTC')
      expect(result.data.eventType.id).toBe(EVENT_TYPE_ID)
    }
  })

  it('Test 12: a configured conflict_calendar_ids on the profile is forwarded to fetchBusyTimes', async () => {
    const { client } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
      profile: { data: { timezone: 'UTC', conflict_calendar_ids: ['primary', 'team@group.calendar.google.com'] }, error: null },
    })
    await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(fetchBusyTimes).toHaveBeenCalledWith(
      USER_ID, ORG_ID, expect.any(String), expect.any(String),
      ['primary', 'team@group.calendar.google.com'],
    )
  })

  it("Test 13: an empty/missing conflict_calendar_ids falls back to ['primary']", async () => {
    const { client } = buildFakeSupabase({
      windows: { data: [{ start_time: '08:00:00', end_time: '12:00:00' }], error: null },
    })
    await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: `${FUTURE_DATE}T08:00:00.000Z`,
    })
    expect(fetchBusyTimes).toHaveBeenCalledWith(
      USER_ID, ORG_ID, expect.any(String), expect.any(String),
      ['primary'],
    )
  })
})

// ─── Look busy enforcement ──────────────────────────────────────────────────
//
// The display path hides slots; this is the gate that stops the hidden ones
// being booked anyway via MCP bookings_create or a hand-rolled POST. If these
// tests fail the feature is cosmetic.

describe('resolveAndValidateSlot — look busy', () => {
  // 08:00-12:00 at 30 min = 8 grid positions.
  const WINDOWS = [{ start_time: '08:00:00', end_time: '12:00:00' }]
  const GRID = Array.from({ length: 8 }, (_, i) => {
    const total = 8 * 60 + i * 30
    const h = String(Math.floor(total / 60)).padStart(2, '0')
    const m = String(total % 60).padStart(2, '0')
    return `${FUTURE_DATE}T${h}:${m}:00.000Z`
  })

  function withLookBusy(config: { mode: string; percent?: number | null; maxPerDay?: number | null }) {
    return buildFakeSupabase({
      eventType: {
        data: {
          ...eventTypeRow,
          look_busy_mode: config.mode,
          look_busy_percent: config.percent ?? null,
          look_busy_max_per_day: config.maxPerDay ?? null,
        },
        error: null,
      },
      windows: { data: WINDOWS, error: null },
    })
  }

  // Derive the real hide-set from the engine rather than hardcoding a slot —
  // hardcoding would silently stop testing anything if the hash ever changed.
  function partitionGrid(config: LookBusyConfig) {
    const hidden = computeHiddenSlotStarts({
      eventTypeId: EVENT_TYPE_ID,
      date: FUTURE_DATE,
      gridStarts: GRID,
      config,
    })
    return {
      hidden: GRID.filter((s) => hidden.has(s)),
      visible: GRID.filter((s) => !hidden.has(s)),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a slot withheld by hide_percent, as outside_availability', async () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 50, maxPerDay: null }
    const { hidden } = partitionGrid(config)
    expect(hidden.length).toBeGreaterThan(0)

    const { client } = withLookBusy({ mode: 'hide_percent', percent: 50 })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: hidden[0],
    })
    expect(result.ok).toBe(false)
    // Deliberately the same error a real conflict produces — a distinct code
    // would disclose that the slot is free but withheld.
    if (!result.ok) expect(result.error).toBe('outside_availability')
  })

  it('still accepts a visible slot while hide_percent is active', async () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 50, maxPerDay: null }
    const { visible } = partitionGrid(config)
    expect(visible.length).toBeGreaterThan(0)

    const { client } = withLookBusy({ mode: 'hide_percent', percent: 50 })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: visible[0],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects every withheld slot under max_per_day and accepts the survivors', async () => {
    const config: LookBusyConfig = { mode: 'max_per_day', percent: null, maxPerDay: 2 }
    const { hidden, visible } = partitionGrid(config)
    expect(visible.length).toBe(2)
    expect(hidden.length).toBe(6)

    for (const start of hidden) {
      const { client } = withLookBusy({ mode: 'max_per_day', maxPerDay: 2 })
      const result = await resolveAndValidateSlot(client as any, {
        eventTypeId: EVENT_TYPE_ID,
        startAtIso: start,
      })
      expect(result.ok).toBe(false)
    }
    for (const start of visible) {
      const { client } = withLookBusy({ mode: 'max_per_day', maxPerDay: 2 })
      const result = await resolveAndValidateSlot(client as any, {
        eventTypeId: EVENT_TYPE_ID,
        startAtIso: start,
      })
      expect(result.ok).toBe(true)
    }
  })

  it('accepts every grid slot when the mode is off (no behaviour change)', async () => {
    for (const start of GRID) {
      const { client } = withLookBusy({ mode: 'off' })
      const result = await resolveAndValidateSlot(client as any, {
        eventTypeId: EVENT_TYPE_ID,
        startAtIso: start,
      })
      expect(result.ok).toBe(true)
    }
  })

  it('treats a null mode (row selected before migration 1266) as off', async () => {
    const { client } = buildFakeSupabase({
      eventType: { data: { ...eventTypeRow, look_busy_mode: null }, error: null },
      windows: { data: WINDOWS, error: null },
    })
    const result = await resolveAndValidateSlot(client as any, {
      eventTypeId: EVENT_TYPE_ID,
      startAtIso: GRID[0],
    })
    expect(result.ok).toBe(true)
  })

  it('agrees with the display path: exactly the slots generateSlots offers are accepted', async () => {
    const config: LookBusyConfig = { mode: 'hide_percent', percent: 40, maxPerDay: null }
    const displayed = generateSlots({
      date: FUTURE_DATE,
      timezone: 'UTC',
      durationMinutes: 30,
      availability: WINDOWS,
      existingBookings: [],
      busyTimes: [],
      eventTypeId: EVENT_TYPE_ID,
      lookBusy: config,
    }).map((s) => s.start)

    for (const start of GRID) {
      const { client } = withLookBusy({ mode: 'hide_percent', percent: 40 })
      const result = await resolveAndValidateSlot(client as any, {
        eventTypeId: EVENT_TYPE_ID,
        startAtIso: start,
      })
      expect(result.ok).toBe(displayed.includes(start))
    }
  })
})
