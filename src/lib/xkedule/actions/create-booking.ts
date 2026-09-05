// src/lib/xkedule/actions/create-booking.ts
// POST /api/v1/bookings — create a booking from the minimum the AI gathers.
// Xkedule computes duration/endTime/price and re-validates the slot (409).
import { xkeduleFetchJson, WRITE_TIMEOUT_MS, type XkeduleCredentials } from '../client'
import { checkVoiceBookingConfirmation, type VoiceBookingContext } from '@/lib/vapi/booking-confirmation'

export interface CreateBookingParams {
  /** Two-phase gate: only a call with confirmed=true writes; see createXkeduleBooking. */
  confirmed?: boolean | string
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

export interface BookingResponse {
  id: number
  status: string
  bookingDate?: string
  startTime?: string
  endTime?: string
  totalPrice?: string
  idempotent?: boolean
}

/**
 * Fired synchronously, right after Xkedule confirms the write, with the raw
 * response AND the input that produced it -- BEFORE this function formats
 * its human-readable return string. Lets a caller (the Action Engine's
 * xkedule_create_booking case) mirror the booking into the native
 * `bookings` table and emit the platform's own meeting.* calendar events,
 * without this file -- a pure Xkedule provider call -- knowing anything
 * about Supabase, orgs, or the calendar event system. Never called for a
 * validation failure, a 409 slot-taken, or a thrown error.
 */
// `confirmed` is the two-phase gate flag (see createXkeduleBooking).
export interface XkeduleBookingCreated {
  booking: BookingResponse
  input: CreateBookingParams
}

export async function createXkeduleBooking(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
  onCreated?: (created: XkeduleBookingCreated) => void,
  voiceBooking?: VoiceBookingContext,
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

  const rawStaff = Number(p.staffMemberId ?? p.staffId)
  const staff = Number.isInteger(rawStaff) && rawStaff > 0 ? rawStaff : undefined

  if (voiceBooking) {
    const confirmation = checkVoiceBookingConfirmation(params, credentials.organizationId ?? '', voiceBooking)
    if (!confirmation.allowed) return confirmation.instruction
  }

  // Two-phase booking, enforced here so it holds on every channel and with
  // every model: the first call never writes. It hands the agent the
  // read-back to say and the question to ask; only a second call carrying
  // confirmed=true books. Rehearsals on 2026-09-05 showed gpt-5.1 booking on
  // the customer's answer to the NAME question, twice, despite a prompt that
  // spelled out the order - a rule the customer can hear broken is not left
  // to the prompt.
  if (!isConfirmed(p.confirmed)) {
    const who = String(p.customerName)
    const staffNote = staff ? ` with staff member ${staff}` : ''
    return (
      `NOT BOOKED YET. Read this back to the customer in one sentence and ask whether there is anything else they would like to add: ` +
      `${describeServices(ids)} on ${p.bookingDate} at ${p.startTime}${staffNote}, under the name ${who}, to the number ${p.customerPhone}. ` +
      `Only when they answer no, call book_appointment again with exactly these details and confirmed: true.`
    )
  }

  const body: Record<string, unknown> = {
    serviceIds: ids.map((x) => Number(x)).filter(Boolean),
    bookingDate: p.bookingDate,
    startTime: p.startTime,
    customer: {
      name: p.customerName,
      phone: p.customerPhone,
      ...(p.customerEmail && (!voiceBooking || voiceBooking.messages.some((m) => m.role === 'user'
        && m.content.toLowerCase().includes(String(p.customerEmail).toLowerCase()))) ? { email: p.customerEmail } : {}),
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
      WRITE_TIMEOUT_MS,
    )
    // Never let a caller's hook (Supabase writes, calendar event dispatch)
    // affect this tool's own result -- swallow synchronously, same contract
    // as every other best-effort side channel in this codebase.
    try {
      onCreated?.({ booking, input: p })
    } catch (hookErr) {
      console.error('[xkedule/create-booking] onCreated hook error:', hookErr)
    }
    const end = booking.endTime ? `-${booking.endTime}` : ''
    const total = booking.totalPrice ? ` | Total: $${booking.totalPrice}` : ''
    const outcome = booking.status === 'confirmed' ? 'Booking confirmed.'
      : ['pending', 'awaiting_approval'].includes(booking.status)
        ? 'Appointment request received, awaiting the business approval. Tell the customer it is requested, not confirmed yet.'
        : 'Booking response received. Do not claim confirmation; report the returned status.'
    return `${outcome} ID: ${booking.id} | ${booking.bookingDate ?? p.bookingDate} at ${booking.startTime ?? p.startTime}${end} | Status: ${booking.status}${total}`
  } catch (err) {
    // /api/v1/bookings returns 409 slot_taken when the slot was filled meanwhile.
    const msg = (err as Error).message
    if (msg.includes('409') || msg.includes('slot_taken')) {
      return 'That time slot was just taken. Please offer the customer another time.'
    }
    throw err
  }
}

function isConfirmed(value: unknown): boolean {
  return value === true || (typeof value === 'string' && ['true', 'yes', '1'].includes(value.trim().toLowerCase()))
}

function describeServices(ids: Array<number | string>): string {
  const list = ids.map((x) => String(x).trim()).filter(Boolean)
  return list.length === 1 ? `service ${list[0]}` : `services ${list.join(', ')}`
}
