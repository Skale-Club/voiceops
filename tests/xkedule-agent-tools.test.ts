// AGT-07: pure coverage for the 4 new Xkedule agent tool wrappers
// (cancel/reschedule/quote/customer-lookup), mirroring the existing
// coverage style for get-services/check-availability/create-booking (none of
// which have dedicated test files today — this is the first for the
// src/lib/xkedule/actions/ directory). xkeduleFetchJson is mocked so these
// tests exercise only each wrapper's param handling, request shape, and
// response formatting — never real network I/O.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/xkedule/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xkedule/client')>()
  return {
    ...actual,
    xkeduleFetchJson: vi.fn(),
  }
})

import { xkeduleFetchJson, WRITE_TIMEOUT_MS, type XkeduleCredentials } from '@/lib/xkedule/client'
import { cancelXkeduleBooking } from '@/lib/xkedule/actions/cancel-booking'
import { rescheduleXkeduleBooking } from '@/lib/xkedule/actions/reschedule-booking'
import { getXkeduleQuote } from '@/lib/xkedule/actions/quote'
import { lookupXkeduleCustomer } from '@/lib/xkedule/actions/lookup-customer'

const CREDS: XkeduleCredentials = { tenantBaseUrl: 'https://tenant.xkedule.com', apiKey: 'xph_test' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cancelXkeduleBooking', () => {
  it('returns a friendly prompt when bookingId is missing', async () => {
    const result = await cancelXkeduleBooking({}, CREDS)
    expect(result).toContain('Missing required field')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('calls POST /api/v1/bookings/:id/cancel with an empty body and reports the new status', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ id: 42, status: 'cancelled' })

    const result = await cancelXkeduleBooking({ bookingId: 42 }, CREDS)

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith('/api/v1/bookings/42/cancel', 'POST', {}, CREDS, WRITE_TIMEOUT_MS)
    expect(result).toBe('Booking 42 is now cancelled.')
  })

  it('accepts the snake_case booking_id alias', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ id: 7, status: 'cancelled' })
    await cancelXkeduleBooking({ booking_id: 7 }, CREDS)
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith('/api/v1/bookings/7/cancel', 'POST', {}, CREDS, WRITE_TIMEOUT_MS)
  })

  it('returns a friendly message on a 404 instead of throwing', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 404: Booking not found'))
    const result = await cancelXkeduleBooking({ bookingId: 999 }, CREDS)
    expect(result).toBe('No booking found with that id.')
  })

  it('re-throws on an unrecognized error', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 500: boom'))
    await expect(cancelXkeduleBooking({ bookingId: 1 }, CREDS)).rejects.toThrow('500')
  })
})

describe('rescheduleXkeduleBooking', () => {
  it('returns a friendly prompt when required fields are missing', async () => {
    const result = await rescheduleXkeduleBooking({ bookingId: 1 }, CREDS)
    expect(result).toContain('Missing required fields')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('calls POST /api/v1/bookings/:id/reschedule with bookingDate + startTime', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({
      id: 42, status: 'confirmed', bookingDate: '2026-08-01', startTime: '14:00', endTime: '14:30',
    })

    const result = await rescheduleXkeduleBooking(
      { bookingId: 42, bookingDate: '2026-08-01', startTime: '14:00' },
      CREDS,
    )

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/bookings/42/reschedule',
      'POST',
      { bookingDate: '2026-08-01', startTime: '14:00' },
      CREDS,
      WRITE_TIMEOUT_MS,
    )
    expect(result).toContain('rescheduled to 2026-08-01 at 14:00-14:30')
  })

  it('includes staffMemberId when provided', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({ id: 42, status: 'confirmed' })
    await rescheduleXkeduleBooking(
      { bookingId: 42, bookingDate: '2026-08-01', startTime: '14:00', staffMemberId: 3 },
      CREDS,
    )
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/bookings/42/reschedule',
      'POST',
      { bookingDate: '2026-08-01', startTime: '14:00', staffMemberId: 3 },
      CREDS,
      WRITE_TIMEOUT_MS,
    )
  })

  it('returns a friendly message on 409 (slot unavailable / terminal booking)', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 409: booking_terminal'))
    const result = await rescheduleXkeduleBooking(
      { bookingId: 42, bookingDate: '2026-08-01', startTime: '14:00' },
      CREDS,
    )
    expect(result).toContain('unavailable')
  })
})

describe('getXkeduleQuote', () => {
  it('returns a friendly prompt when no serviceIds are given', async () => {
    const result = await getXkeduleQuote({}, CREDS)
    expect(result).toContain('Please provide serviceId')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('accepts a single serviceId and posts items:[{serviceId, quantity:1}]', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({
      items: [{ serviceId: 5, serviceName: 'Deep Clean', price: '120.00' }],
      subtotal: '120.00',
      totalDurationMinutes: 90,
      requiresConfirmation: false,
      currency: 'usd',
    })

    const result = await getXkeduleQuote({ serviceId: 5 }, CREDS)

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/quote',
      'POST',
      { items: [{ serviceId: 5, quantity: 1 }] },
      CREDS,
    )
    expect(result).toContain('Deep Clean: $120.00')
    expect(result).toContain('Subtotal: $120.00 USD')
    expect(result).not.toContain('requires owner confirmation')
  })

  it('accepts a comma-separated serviceIds string and notes requiresConfirmation', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({
      items: [
        { serviceId: 5, serviceName: 'Deep Clean', price: '120.00' },
        { serviceId: 7, serviceName: 'Windows', price: '40.00' },
      ],
      subtotal: '160.00',
      totalDurationMinutes: 120,
      requiresConfirmation: true,
      currency: 'usd',
    })

    const result = await getXkeduleQuote({ serviceIds: '5,7' }, CREDS)

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/quote',
      'POST',
      { items: [{ serviceId: 5, quantity: 1 }, { serviceId: 7, quantity: 1 }] },
      CREDS,
    )
    expect(result).toContain('this booking will need owner confirmation')
  })

  it('returns a friendly message on unknown_service (422) instead of throwing', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 422: unknown_service'))
    const result = await getXkeduleQuote({ serviceId: 999 }, CREDS)
    expect(result).toContain('could not be found')
  })
})

describe('lookupXkeduleCustomer', () => {
  it('returns a friendly prompt when no phone is given', async () => {
    const result = await lookupXkeduleCustomer({}, CREDS)
    expect(result).toContain('Please provide a phone number')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('calls GET /api/v1/customers?phone= and formats upcoming bookings', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({
      customer: { id: 1, name: 'Jane Doe', email: 'jane@example.com', phone: '+15551234567' },
      upcomingBookings: [{ id: 10, status: 'confirmed', bookingDate: '2026-08-01', startTime: '10:00' }],
    })

    const result = await lookupXkeduleCustomer({ phone: '+15551234567' }, CREDS)

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/customers?phone=%2B15551234567',
      'GET',
      null,
      CREDS,
    )
    expect(result).toContain('Jane Doe')
    expect(result).toContain('#10 on 2026-08-01 at 10:00 (confirmed)')
  })

  it('reports no upcoming bookings when there are none', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValueOnce({
      customer: { id: 1, name: 'Jane Doe', email: null, phone: '+15551234567' },
      upcomingBookings: [],
    })
    const result = await lookupXkeduleCustomer({ phone: '+15551234567' }, CREDS)
    expect(result).toContain('No upcoming bookings.')
  })

  it('returns a friendly message on 404 (unrecognized number) instead of throwing', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 404: not_found'))
    const result = await lookupXkeduleCustomer({ phone: '+10000000000' }, CREDS)
    expect(result).toContain("don't have a record")
  })
})
