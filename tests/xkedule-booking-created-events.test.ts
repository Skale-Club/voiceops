// tests/xkedule-booking-created-events.test.ts
//
// Coverage for the "no confirmation" fix: when the Action Engine's
// xkedule_create_booking action successfully creates a booking directly
// against Xkedule, the platform now mirrors it and emits its own meeting.*
// calendar events immediately, instead of only via Xkedule's own (often
// unconfigured) webhook.
//
// Three layers, mirroring the module boundaries:
//   1. createXkeduleBooking's onCreated hook (src/lib/xkedule/actions/
//      create-booking.ts) -- fires only on a genuine successful create.
//   2. emitXkeduleBookingCreatedEvents (src/lib/action-engine/executors/
//      xkedule-booking-events.ts) -- the mirror + calendar-event emission.
//   3. execute-action.ts's 'xkedule_create_booking' case -- wires (1) into
//      (2) fire-and-forget, and never lets a failure in either change the
//      tool's own returned string.
//
// Xkedule's client and the calendar emitter are mocked per the task brief;
// the shared mirror helpers (src/lib/xkedule/mirror.ts) run for real against
// a fake Supabase client, the same style tests/xkedule-webhook.test.ts uses,
// so this suite also proves the two write paths share that logic instead of
// drifting copies.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/xkedule/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xkedule/client')>()
  return {
    ...actual,
    xkeduleFetchJson: vi.fn(),
  }
})

vi.mock('@/lib/calendar/transition', () => ({
  emitCalendarEvent: vi.fn(async () => ({ dispatched: 0, dispatch_id: null })),
}))

vi.mock('@/lib/xkedule/availability-cache', () => ({
  resolveOrgTimezone: vi.fn(async () => 'America/New_York'),
}))

// Same pass-through stand-ins tests/xkedule-webhook.test.ts uses --
// canonicalizeContactPhone internally imports normalisePhone from this
// module, so the mock must still behave like the real thing.
vi.mock('@/lib/contacts/zod-schemas', () => ({
  normaliseEmail: vi.fn((v: string | null | undefined) => v ?? null),
  normalisePhone: vi.fn((v: string | null | undefined) => {
    if (!v) return null
    const trimmed = v.trim()
    if (!trimmed) return null
    const plus = trimmed.startsWith('+') ? '+' : ''
    const digits = trimmed.replace(/[^0-9]/g, '')
    return digits ? plus + digits : null
  }),
}))

vi.mock('@/lib/logger', () => ({
  log: vi.fn(async () => {}),
}))

// Imports come AFTER mock declarations.
import { xkeduleFetchJson, type XkeduleCredentials } from '@/lib/xkedule/client'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'
import { emitXkeduleBookingCreatedEvents } from '@/lib/action-engine/executors/xkedule-booking-events'
import { executeAction } from '@/lib/action-engine/execute-action'
import { getXkeduleCredentialsForOrgCached } from '@/lib/xkedule/credentials'
import type { GhlCredentials } from '@/lib/ghl/client'
import { CALENDAR_EVENTS } from '@/lib/calendar/events'
import { TRIGGERS } from '@/lib/workflows/spec'

vi.mock('@/lib/xkedule/credentials', () => ({
  getXkeduleCredentialsForOrgCached: vi.fn(),
}))

const CREDS: XkeduleCredentials = { tenantBaseUrl: 'https://tenant.xkedule.com', apiKey: 'xph_test', organizationId: 'org-1' }
const ORG_ID = 'org-1'
const EVENT_TYPE_ID = 'evt-type-1'
const CONTACT_ID = 'contact-1'
const NEW_BOOKING_ID = 'booking-new-1'

// ─── Fake Supabase service-role client (same style as xkedule-webhook.test.ts) ───

interface FakeResp {
  data?: unknown
  error?: { message: string } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeProxy(resolved: FakeResp): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxy: any = {}
  const chain = ['select', 'eq', 'neq', 'is', 'limit', 'order', 'in', 'or', 'ilike', 'filter', 'contains', 'range']
  for (const m of chain) proxy[m] = vi.fn(() => proxy)
  proxy.single = vi.fn(() => Promise.resolve(resolved))
  proxy.maybeSingle = vi.fn(() => Promise.resolve(resolved))
  proxy.then = (resolve: (v: FakeResp) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject)
  return proxy
}

function buildFakeClient(opts: {
  bookingsExisting?: FakeResp
  bookingsInsert?: FakeResp
  eventTypesExisting?: FakeResp
  contactsPhoneLookup?: FakeResp
} = {}) {
  const bookingsInsertMock = vi.fn(() =>
    makeProxy(opts.bookingsInsert ?? { data: { id: NEW_BOOKING_ID }, error: null }),
  )

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const proxy: any = {}
        proxy.select = vi.fn(() => makeProxy(opts.bookingsExisting ?? { data: null, error: null }))
        proxy.insert = bookingsInsertMock
        return proxy
      }
      if (table === 'event_types') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const proxy: any = {}
        proxy.select = vi.fn(() =>
          makeProxy(opts.eventTypesExisting ?? { data: { id: EVENT_TYPE_ID }, error: null }),
        )
        proxy.insert = vi.fn(() => makeProxy({ data: { id: EVENT_TYPE_ID }, error: null }))
        return proxy
      }
      if (table === 'org_members') {
        return makeProxy({ data: null, error: null })
      }
      if (table === 'contacts') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const proxy: any = {}
        proxy.select = vi.fn(() =>
          makeProxy(opts.contactsPhoneLookup ?? { data: [{ id: CONTACT_ID }], error: null }),
        )
        proxy.insert = vi.fn(() => makeProxy({ data: { id: CONTACT_ID }, error: null }))
        return proxy
      }
      return makeProxy({ data: null, error: null })
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, bookingsInsertMock }
}

function bookingInput(overrides: Record<string, unknown> = {}) {
  return {
    customerName: 'Jane Doe',
    customerPhone: '+15555551234',
    customerEmail: 'jane@example.com',
    bookingDate: '2026-08-01',
    startTime: '10:00',
    serviceId: 5,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Layer 1: createXkeduleBooking's onCreated hook ─────────────────────────

describe('createXkeduleBooking onCreated hook', () => {
  it('fires onCreated with {booking, input} on a successful create, before returning', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({
      id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00', endTime: '10:30', totalPrice: '50.00',
    })
    const onCreated = vi.fn()

    const result = await createXkeduleBooking(bookingInput(), CREDS, onCreated)

    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith({
      booking: expect.objectContaining({ id: 42, status: 'confirmed' }),
      input: expect.objectContaining({ customerName: 'Jane Doe' }),
    })
    expect(result).toContain('Booking confirmed. ID: 42')
  })

  it('does NOT fire onCreated when required fields are missing (never reaches Xkedule)', async () => {
    const onCreated = vi.fn()
    const result = await createXkeduleBooking({}, CREDS, onCreated)
    expect(onCreated).not.toHaveBeenCalled()
    expect(result).toContain('Missing required booking fields')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('does NOT fire onCreated on a 409 slot_taken', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 409: slot_taken'))
    const onCreated = vi.fn()
    const result = await createXkeduleBooking(bookingInput(), CREDS, onCreated)
    expect(onCreated).not.toHaveBeenCalled()
    expect(result).toContain('just taken')
  })

  it('does NOT fire onCreated when the provider call throws an unrecognized error, and still rethrows', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 500: boom'))
    const onCreated = vi.fn()
    await expect(createXkeduleBooking(bookingInput(), CREDS, onCreated)).rejects.toThrow('500')
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('a synchronously-throwing onCreated hook never breaks the tool result', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ id: 42, status: 'confirmed' })
    const onCreated = vi.fn(() => {
      throw new Error('boom in hook')
    })
    const result = await createXkeduleBooking(bookingInput(), CREDS, onCreated)
    expect(result).toContain('Booking confirmed. ID: 42')
  })

  it('works with no onCreated hook at all (optional parameter)', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ id: 42, status: 'confirmed' })
    const result = await createXkeduleBooking(bookingInput(), CREDS)
    expect(result).toContain('Booking confirmed. ID: 42')
  })
})

// ─── Layer 2: emitXkeduleBookingCreatedEvents ───────────────────────────────

describe('emitXkeduleBookingCreatedEvents', () => {
  it('a confirmed booking mirrors into `bookings` and emits exactly meeting.scheduled then meeting.confirmed, same booking_id/org_id', async () => {
    const { client, bookingsInsertMock } = buildFakeClient()

    await emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
      booking: { id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00', endTime: '10:30', totalPrice: '50.00' },
      input: bookingInput(),
    })

    expect(bookingsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        external_source: 'xkedule',
        external_id: '42',
        status: 'confirmed',
        booker_name: 'Jane Doe',
        booker_phone: '+15555551234',
        linked_contact_id: CONTACT_ID,
        price: 50,
      }),
    )

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { event: 'meeting.scheduled', booking_id: NEW_BOOKING_ID, org_id: ORG_ID },
    )
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { event: 'meeting.confirmed', booking_id: NEW_BOOKING_ID, org_id: ORG_ID },
    )
  })

  it.each(['pending', 'awaiting_approval'])(
    "a '%s' booking mirrors nothing (MIR-07: no DB representation for a not-yet-decided status) but emits exactly one meeting.requested carrying the raw fields, no booking_id",
    async (status) => {
      const { client, bookingsInsertMock } = buildFakeClient()

      await emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
        booking: { id: 42, status, bookingDate: '2026-08-01', startTime: '10:00', endTime: '10:30', totalPrice: '50.00' },
        input: bookingInput(),
      })

      // Still no mirror row -- MIR-07 unchanged.
      expect(bookingsInsertMock).not.toHaveBeenCalled()

      expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
        expect.anything(),
        {
          event: 'meeting.requested',
          booking_id: null,
          org_id: ORG_ID,
          requested: {
            booker_name: 'Jane Doe',
            booker_email: 'jane@example.com',
            booker_phone: '+15555551234',
            start_at: expect.any(String),
            end_at: expect.any(String),
            event_type_id: EVENT_TYPE_ID,
            linked_contact_id: CONTACT_ID,
            price: 50,
            external_source: 'xkedule',
            external_id: '42',
            status: 'pending',
          },
        },
      )
    },
  )

  it('a cancelled-on-arrival booking emits meeting.cancelled only, never meeting.confirmed', async () => {
    const { client, bookingsInsertMock } = buildFakeClient()

    await emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
      booking: { id: 42, status: 'cancelled', bookingDate: '2026-08-01', startTime: '10:00' },
      input: bookingInput(),
    })

    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      { event: 'meeting.cancelled', booking_id: NEW_BOOKING_ID, org_id: ORG_ID },
    )
  })

  it('an unrecognized status mirrors nothing and emits nothing (never coerced to confirmed)', async () => {
    const { client, bookingsInsertMock } = buildFakeClient()

    await emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
      booking: { id: 42, status: 'some_future_status', bookingDate: '2026-08-01', startTime: '10:00' },
      input: bookingInput(),
    })

    expect(bookingsInsertMock).not.toHaveBeenCalled()
    expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
  })

  it('idempotency: a mirror row that already exists for this external id is left alone -- no re-insert, no re-emit', async () => {
    const { client, bookingsInsertMock } = buildFakeClient({
      bookingsExisting: { data: { id: 'already-mirrored' }, error: null },
    })

    await emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
      booking: { id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00' },
      input: bookingInput(),
    })

    expect(bookingsInsertMock).not.toHaveBeenCalled()
    expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
  })

  it('a failed mirror insert never calls the emitter, and never throws', async () => {
    const { client } = buildFakeClient({ bookingsInsert: { data: null, error: { message: 'db down' } } })

    await expect(
      emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
        booking: { id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00' },
        input: bookingInput(),
      }),
    ).resolves.toBeUndefined()

    expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
  })

  it('the emitter rejecting never throws out of emitXkeduleBookingCreatedEvents', async () => {
    const { client } = buildFakeClient()
    vi.mocked(emitCalendarEvent).mockRejectedValueOnce(new Error('workflow engine down'))

    await expect(
      emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
        booking: { id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00' },
        input: bookingInput(),
      }),
    ).resolves.toBeUndefined()
  })

  it('a booking with no bookingDate/startTime anywhere mirrors nothing rather than crash on an invalid date', async () => {
    const { client, bookingsInsertMock } = buildFakeClient()

    await emitXkeduleBookingCreatedEvents(client, ORG_ID, CREDS, {
      booking: { id: 42, status: 'confirmed' },
      input: { customerName: 'Jane', customerPhone: '+15555551234' },
    })

    expect(bookingsInsertMock).not.toHaveBeenCalled()
    expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
  })
})

// ─── Layer 3: execute-action.ts wiring ──────────────────────────────────────

describe("executeAction('xkedule_create_booking', ...) wiring", () => {
  const ghlCreds: GhlCredentials = { apiKey: 'k', locationId: 'l' }

  it('a successful booking returns the normal confirmation string even when the downstream emitter rejects (fire-and-forget, never awaited into the result)', async () => {
    const { client } = buildFakeClient()
    vi.mocked(getXkeduleCredentialsForOrgCached).mockResolvedValueOnce(CREDS)
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00' })
    vi.mocked(emitCalendarEvent).mockRejectedValue(new Error('emitter exploded'))

    const result = await executeAction(
      'xkedule_create_booking',
      bookingInput(),
      ghlCreds,
      { organizationId: ORG_ID, supabase: client },
    )

    expect(result).toContain('Booking confirmed. ID: 42')
  })

  it('throws when ctx.organizationId/ctx.supabase are missing, without ever calling Xkedule', async () => {
    await expect(
      executeAction('xkedule_create_booking', bookingInput(), ghlCreds),
    ).rejects.toThrow('xkedule_create_booking requires ctx.organizationId and ctx.supabase')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('throws when Xkedule is not configured for the org, without ever calling Xkedule', async () => {
    const { client } = buildFakeClient()
    vi.mocked(getXkeduleCredentialsForOrgCached).mockResolvedValueOnce(null)
    await expect(
      executeAction('xkedule_create_booking', bookingInput(), ghlCreds, { organizationId: ORG_ID, supabase: client }),
    ).rejects.toThrow('Xkedule integration not configured for this organization')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })
})

// ─── Layer 4: meeting.requested registration ────────────────────────────────

describe('meeting.requested is registered wherever the other calendar events are', () => {
  it('is present in CALENDAR_EVENTS (src/lib/calendar/events.ts)', () => {
    expect(CALENDAR_EVENTS).toContain('meeting.requested')
  })

  it('is present in the workflow spec trigger catalogue (src/lib/workflows/spec.ts) with a meeting.* scope', () => {
    const trigger = TRIGGERS.find((t) => t.type === 'event:meeting.requested')
    expect(trigger).toBeDefined()
    expect(trigger?.variables).toContain('meeting.*')
  })
})
