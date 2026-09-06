// Ownership of an Xkedule booking, decided by the phone line.
//
// On a phone call the only identity we trust is the number Vapi verified on
// the call (ctx.callerNumber). A booking id is something the model can guess,
// mishear, or be told by a caller ("cancel appointment 470"), so before a
// cancellation or a move the booking's contact phone must match the caller's.
// No caller number (web test call, withheld number) means no write to an
// existing booking from that call at all.
//
// The widget has no verified number; its identity model is its own session
// and this check is not applied there (the executor only passes a caller
// identity when the request came from the voice ingress).
import { memoTtl } from '@/lib/cache/ttl-memo'
import { xkeduleFetchJson, type XkeduleCredentials } from './client'

export interface CallerIdentity {
  /** E.164 number Vapi reports for the call, or undefined when unknown. */
  callerNumber?: string
}

interface BookingContact {
  contact?: { phone?: string | null } | null
  customer?: { phone?: string | null } | null
}

const DETAIL_TTL_MS = 60_000

/** Digits only, compared on the last ten so "+1 508…" and "508…" agree. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = String(a ?? '').replace(/\D/g, '')
  const db = String(b ?? '').replace(/\D/g, '')
  if (da.length < 7 || db.length < 7) return false
  return da.slice(-10) === db.slice(-10)
}

export type OwnershipResult = { ok: true } | { ok: false; instruction: string }

const NOT_YOURS =
  "That appointment isn't under the number you're calling from, so I can't change it from this call. Tell the caller that, and offer to take a message for the shop."
const NO_NUMBER =
  "I can only change an appointment from the phone number it was booked with, and this call's number isn't available. Tell the caller that, and offer to take a message for the shop."

/**
 * Refuses unless the booking's contact phone is the caller's number. Reads the
 * booking detail through the same short memo the read-back builder uses, so a
 * prepare + confirm pair costs one provider round trip.
 */
export async function assertBookingOwnedByCaller(
  bookingId: number,
  caller: CallerIdentity,
  credentials: XkeduleCredentials,
): Promise<OwnershipResult> {
  if (!caller.callerNumber) return { ok: false, instruction: NO_NUMBER }
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) return { ok: false, instruction: NOT_YOURS }
  let detail: BookingContact
  try {
    detail = await memoTtl(
      `xk:consent:${credentials.organizationId}:${credentials.tenantBaseUrl}:booking:${bookingId}`,
      DETAIL_TTL_MS,
      () => xkeduleFetchJson<BookingContact>(`/api/v1/bookings/${bookingId}`, 'GET', null, credentials),
    )
  } catch {
    // An unreadable booking is treated as not the caller's: a write must never
    // proceed on a guess.
    return { ok: false, instruction: NOT_YOURS }
  }
  const phone = detail.contact?.phone ?? detail.customer?.phone
  return samePhone(phone, caller.callerNumber) ? { ok: true } : { ok: false, instruction: NOT_YOURS }
}
