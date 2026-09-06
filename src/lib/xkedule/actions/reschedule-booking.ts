// src/lib/xkedule/actions/reschedule-booking.ts
// POST /api/v1/bookings/:id/reschedule — move an existing Xkedule booking to
// a new date/time (and optionally a different staff member). Xkedule
// re-validates the slot and rejects a cancelled/completed booking outright
// (409 booking_terminal).
import { xkeduleFetchJson, WRITE_TIMEOUT_MS, type XkeduleCredentials } from '../client'
import type { VoiceBookingContext } from '@/lib/vapi/booking-confirmation'
import { verifyVoiceBooking } from '@/lib/xkedule/voice-booking-summary'
import { clearMemo } from '@/lib/cache/ttl-memo'
import { assertBookingOwnedByCaller, type CallerIdentity } from '@/lib/xkedule/booking-ownership'

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
  caller?: CallerIdentity,
): Promise<string> {
  const p = params as RescheduleBookingParams
  const id = p.bookingId ?? p.booking_id
  if (id == null || !p.bookingDate || !p.startTime) {
    return 'Missing required fields: bookingId, bookingDate (YYYY-MM-DD), startTime (HH:MM).'
  }
  // Ownership first (booking-ownership.ts): on a phone call the booking must
  // belong to the number on the line. Decided before consent so the caller
  // is never asked to confirm a change to someone else's appointment.
  if (caller) {
    const owned = await assertBookingOwnedByCaller(Number(id), caller, credentials)
    if (!owned.ok) return owned.instruction
  }
  // Voice consent gate (see booking-confirmation.ts): a cancellation or a
  // move is a write the customer must have heard read back and agreed to in
  // a later turn. Without a conversation artifact this returns the read-back.
  if (voiceBooking) {
    const consent = await verifyVoiceBooking('reschedule', params, credentials, voiceBooking)
    if (!consent.allowed) return consent.instruction
  }

  const staff = Number(p.staffMemberId ?? p.staffId)
  const body: Record<string, unknown> = { bookingDate: p.bookingDate, startTime: p.startTime }
  if (Number.isInteger(staff) && staff > 0) body.staffMemberId = staff

  try {
    const booking = await xkeduleFetchJson<BookingResponse>(
      `/api/v1/bookings/${Number(id)}/reschedule`,
      'POST',
      body,
      credentials,
      WRITE_TIMEOUT_MS,
    )
    const end = booking.endTime ? `-${booking.endTime}` : ''
    clearMemo(`xk:consent:${credentials.organizationId}:${credentials.tenantBaseUrl}:booking:${Number(id)}`)
    const pending = ['pending', 'awaiting_approval'].includes(booking.status)
      ? ' The change was requested and still needs business approval. Do not say confirmed or all set.' : ''
    return `Booking ${booking.id} rescheduled to ${booking.bookingDate ?? p.bookingDate} at ${booking.startTime ?? p.startTime}${end}. Status: ${booking.status}.${pending}`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('409')) return 'That time slot is unavailable, or the booking can no longer be rescheduled. Please offer another time.'
    if (msg.includes('404')) return 'No booking found with that id.'
    throw err
  }
}
