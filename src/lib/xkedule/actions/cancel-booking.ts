// src/lib/xkedule/actions/cancel-booking.ts
// POST /api/v1/bookings/:id/cancel — cancel an existing Xkedule booking.
// Idempotent on Xkedule's side: cancelling an already-terminal booking
// returns its current state instead of erroring.
import { xkeduleFetchJson, WRITE_TIMEOUT_MS, type XkeduleCredentials } from '../client'

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
): Promise<string> {
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
    return `Booking ${booking.id} is now ${booking.status}.`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('404')) return 'No booking found with that id.'
    throw err
  }
}
