// src/lib/xkedule/actions/reschedule-booking.ts
// POST /api/v1/bookings/:id/reschedule — move an existing Xkedule booking to
// a new date/time (and optionally a different staff member). Xkedule
// re-validates the slot and rejects a cancelled/completed booking outright
// (409 booking_terminal).
import { xkeduleFetchJson, WRITE_TIMEOUT_MS, type XkeduleCredentials } from '../client'
import { checkVoiceBookingConfirmation, type VoiceBookingContext } from '@/lib/vapi/booking-confirmation'

interface RescheduleBookingParams {
  bookingId?: number | string
  booking_id?: number | string
  bookingDate?: string
  startTime?: string
  staffMemberId?: number | string
  staffId?: number | string
  [key: string]: unknown
}

interface BookingResponse {
  id: number
  status: string
  bookingDate?: string
  startTime?: string
  endTime?: string
}

export async function rescheduleXkeduleBooking(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
  voiceBooking?: VoiceBookingContext,
): Promise<string> {
  // Voice consent gate (see booking-confirmation.ts): a cancellation or a
  // move is a write the customer must have heard read back and agreed to in
  // a later turn. Without a conversation artifact this returns the read-back.
  if (voiceBooking) {
    const consent = checkVoiceBookingConfirmation(params, credentials.organizationId ?? '', voiceBooking)
    if (!consent.allowed) return consent.instruction
  }
  const p = params as RescheduleBookingParams
  const id = p.bookingId ?? p.booking_id
  if (id == null || !p.bookingDate || !p.startTime) {
    return 'Missing required fields: bookingId, bookingDate (YYYY-MM-DD), startTime (HH:MM).'
  }

  const staff = p.staffMemberId ?? p.staffId
  const body: Record<string, unknown> = { bookingDate: p.bookingDate, startTime: p.startTime }
  if (staff != null) body.staffMemberId = Number(staff)

  try {
    const booking = await xkeduleFetchJson<BookingResponse>(
      `/api/v1/bookings/${Number(id)}/reschedule`,
      'POST',
      body,
      credentials,
      WRITE_TIMEOUT_MS,
    )
    const end = booking.endTime ? `-${booking.endTime}` : ''
    return `Booking ${booking.id} rescheduled to ${booking.bookingDate ?? p.bookingDate} at ${booking.startTime ?? p.startTime}${end}. Status: ${booking.status}`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('409')) return 'That time slot is unavailable, or the booking can no longer be rescheduled. Please offer another time.'
    if (msg.includes('404')) return 'No booking found with that id.'
    throw err
  }
}
