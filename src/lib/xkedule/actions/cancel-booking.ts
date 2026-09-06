// src/lib/xkedule/actions/cancel-booking.ts
// POST /api/v1/bookings/:id/cancel — cancel an existing Xkedule booking.
// Idempotent on Xkedule's side: cancelling an already-terminal booking
// returns its current state instead of erroring.
import { xkeduleFetchJson, WRITE_TIMEOUT_MS, type XkeduleCredentials } from '../client'
import type { VoiceBookingContext } from '@/lib/vapi/booking-confirmation'
import { verifyVoiceBooking } from '@/lib/xkedule/voice-booking-summary'
import { clearMemo } from '@/lib/cache/ttl-memo'

interface CancelBookingParams {
  bookingId?: number | string
  booking_id?: number | string
  [key: string]: unknown
}

interface BookingResponse {
  id: number
  status: string
}

export async function cancelXkeduleBooking(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
  voiceBooking?: VoiceBookingContext,
): Promise<string> {
  // Voice consent gate (see booking-confirmation.ts): a cancellation or a
  // move is a write the customer must have heard read back and agreed to in
  // a later turn. Without a conversation artifact this returns the read-back.
  if (voiceBooking) {
    const consent = await verifyVoiceBooking('cancel', params, credentials, voiceBooking)
    if (!consent.allowed) return consent.instruction
  }
  const p = params as CancelBookingParams
  const id = p.bookingId ?? p.booking_id
  if (id == null) {
    return 'Missing required field: bookingId (the Xkedule booking id to cancel).'
  }

  try {
    const booking = await xkeduleFetchJson<BookingResponse>(
      `/api/v1/bookings/${Number(id)}/cancel`,
      'POST',
      {},
      credentials,
      WRITE_TIMEOUT_MS,
    )
    clearMemo(`xk:consent:${credentials.organizationId}:${credentials.tenantBaseUrl}:booking:${Number(id)}`)
    return `Booking ${booking.id} is now ${booking.status}.`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('404')) return 'No booking found with that id.'
    throw err
  }
}
