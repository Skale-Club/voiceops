// src/lib/xkedule/actions/create-booking.ts
// POST /api/v1/bookings — create a booking from the minimum the AI gathers.
// Xkedule computes duration/endTime/price and re-validates the slot (409).
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface CreateBookingParams {
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerAddress?: string
  bookingDate?: string
  startTime?: string
  serviceId?: number | string
  serviceIds?: Array<number | string> | string
  staffMemberId?: number | string
  staffId?: number | string
  /** What the customer actually asked for, in their words (AGT-08). */
  notes?: string
  [key: string]: unknown
}

interface BookingResponse {
  id: number
  status: string
  bookingDate?: string
  startTime?: string
  endTime?: string
  totalPrice?: string
  idempotent?: boolean
}

export async function createXkeduleBooking(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const p = params as CreateBookingParams

  const ids = p.serviceIds
    ? Array.isArray(p.serviceIds)
      ? p.serviceIds
      : String(p.serviceIds).split(',')
    : p.serviceId != null
      ? [p.serviceId]
      : []

  if (!p.customerName || !p.customerPhone || !p.bookingDate || !p.startTime || ids.length === 0) {
    return 'Missing required booking fields: customerName, customerPhone, bookingDate, startTime, serviceId(s).'
  }

  const staff = p.staffMemberId ?? p.staffId
  const body: Record<string, unknown> = {
    serviceIds: ids.map((x) => Number(x)).filter(Boolean),
    bookingDate: p.bookingDate,
    startTime: p.startTime,
    customer: {
      name: p.customerName,
      phone: p.customerPhone,
      ...(p.customerEmail ? { email: p.customerEmail } : {}),
      ...(p.customerAddress ? { address: p.customerAddress } : {}),
    },
  }
  if (staff != null) body.staffMemberId = Number(staff)
  // Carries the request through to the person holding the clippers ("short on
  // the sides", "it's for my son") instead of dying in the transcript.
  if (typeof p.notes === 'string' && p.notes.trim()) body.notes = p.notes.trim()

  try {
    const booking = await xkeduleFetchJson<BookingResponse>(
      '/api/v1/bookings',
      'POST',
      body,
      credentials,
    )
    const end = booking.endTime ? `-${booking.endTime}` : ''
    const total = booking.totalPrice ? ` | Total: $${booking.totalPrice}` : ''
    return `Booking confirmed. ID: ${booking.id} | ${booking.bookingDate ?? p.bookingDate} at ${booking.startTime ?? p.startTime}${end} | Status: ${booking.status}${total}`
  } catch (err) {
    // /api/v1/bookings returns 409 slot_taken when the slot was filled meanwhile.
    const msg = (err as Error).message
    if (msg.includes('409') || msg.includes('slot_taken')) {
      return 'That time slot was just taken. Please offer the customer another time.'
    }
    throw err
  }
}
