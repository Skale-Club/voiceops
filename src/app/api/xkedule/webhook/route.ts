// POST /api/xkedule/webhook
//
// Receives booking.* events from Xkedule and mirrors them into the native
// bookings table (a read-only mirror), then emits the matching meeting.*
// event so the existing calendar workflows fire (reminders, follow-ups,
// opportunities).
//
// Auth: Authorization: Bearer <token> -- same api_keys lookup as /api/v1.
// Idempotency + ordering: dedup by (org, external_source, external_id) with
// last-write-wins on external_updated_at vs the event's occurred_at, PLUS a
// status-aware terminal guard (MIR-10) so a redelivered update can't revive
// an already-cancelled mirror row just because its retry-stamped occurred_at
// is newer than the original cancel's.
// Webhook convention: returns HTTP 200 for everything EXCEPT a missing/bad
// bearer token (MIR-08) -- this route authenticates with a real credential
// (like /api/v1), unlike the vendor-signature webhooks elsewhere in this
// repo that must always 200.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  confirmBooking,
  cancelBooking,
  markNoShow,
  markShowed,
  rescheduleBooking,
  emitCalendarEvent,
} from '@/lib/calendar/transition'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { canonicalizeContactPhone, countryForTimeZone } from '@/lib/phone-numbers/normalize'
import type { BookingStatus } from '@/lib/calendar/booking-status'
// Shared with the Action Engine's xkedule_create_booking emitter (Xkedule
// booking-created platform gap fix) -- see src/lib/xkedule/mirror.ts's file
// header for why these live there instead of here.
import {
  KNOWN_XKEDULE_STATUSES,
  UNCONFIRMED_XKEDULE_STATUSES,
  mapStatus,
  calendarEventForNewRow,
  getOrCreateEventType,
  matchOrCreateContact,
} from '@/lib/xkedule/mirror'

export const runtime = 'nodejs'

type ServiceClient = SupabaseClient<Database>

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const payloadSchema = z.object({
  event: z.string(),
  delivery_id: z.string().optional(),
  occurred_at: z.string(),
  booking: z.object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
    bookingDate: z.string(), // YYYY-MM-DD, tenant-local
    startTime: z.string(),   // HH:MM
    endTime: z.string(),     // HH:MM
    timeZone: z.string().optional(),
    staffMemberId: z.number().nullable().optional(),
    // MIR-06: price/currency/staff identity, previously dropped silently by
    // this schema even though Xkedule already sends them.
    totalPrice: z.union([z.string(), z.number()]).nullable().optional(),
    currency: z.string().nullable().optional(),
    staff: z.object({ id: z.number(), name: z.string() }).optional(),
    services: z.array(z.object({ id: z.number(), name: z.string().nullable() })).optional(),
    customer: z.object({
      name: z.string(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
    }),
  }),
})

// MIR-10: terminal native statuses (mirrors transition.ts's LIFE-02 note:
// "cancelled/no_show/showed are terminal"). Once a mirror row reaches one of
// these, an out-of-order retry must not silently revive it.
const TERMINAL_STATUSES = new Set<BookingStatus>(['cancelled', 'no_show', 'showed'])

// KNOWN_XKEDULE_STATUSES, UNCONFIRMED_XKEDULE_STATUSES, mapStatus, and
// calendarEventForNewRow now live in @/lib/xkedule/mirror (imported above)
// so the Action Engine's xkedule_create_booking emitter shares the exact
// same status vocabulary and "first-seen INSERT" event logic instead of a
// second, possibly-drifting copy.

// Dispatches an EXISTING mirrored booking's status transition through
// Phase 127's canonical lifecycle service (SYNC-02, D-02) instead of a
// raw bookings.status write. Idempotent no-op (no re-emitted event) if
// the booking is already at the mapped status.
async function runXkeduleTransition(
  ctx: { supabase: ServiceClient },
  nativeStatus: BookingStatus,
  bookingId: string,
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  switch (nativeStatus) {
    case 'confirmed': return confirmBooking(ctx, bookingId, orgId)
    case 'cancelled': return cancelBooking(ctx, bookingId, orgId)
    case 'no_show': return markNoShow(ctx, bookingId, orgId)
    case 'showed': return markShowed(ctx, bookingId, orgId)
  }
}

// getOrCreateEventType and matchOrCreateContact now live in
// @/lib/xkedule/mirror (imported above) -- see that file's header.

export async function POST(request: Request): Promise<Response> {
  const ok = (extra?: Record<string, unknown>) => Response.json({ ok: true, ...extra })
  // MIR-08: a missing/malformed/invalid/revoked bearer token is rejected
  // with a real 401 before any DB write, instead of the old unconditional
  // 200 that made a wrong credential silently "work" from Xkedule's point of
  // view (it never retried, never alerted, per the 2026-07 audit: "Webhook
  // do Xphere sempre retorna 200 -- token errado ... vira sucesso"). This is
  // a deliberate exception to the "webhooks always 200" convention used for
  // the vendor-signature webhooks elsewhere in this repo (Vapi/Meta/
  // ManyChat) -- unlike those, this route authenticates with a real Bearer
  // credential against api_keys, the same pattern /api/v1/contacts uses.
  const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    // 1. Auth
    const auth = request.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return unauthorized()
    const token = auth.slice(7).trim()
    if (!token) return unauthorized()

    const supabase = createServiceRoleClient()
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('id, org_id')
      .eq('key_hash', hashToken(token))
      .is('revoked_at', null)
      .maybeSingle()
    if (!apiKey) return unauthorized()
    const orgId = apiKey.org_id

    // 2. Parse
    let payload: z.infer<typeof payloadSchema>
    try {
      payload = payloadSchema.parse(await request.json())
    } catch {
      return ok({ skipped: 'bad_payload' })
    }

    const b = payload.booking

    // Reject genuinely unrecognized statuses BEFORE any DB access beyond
    // auth/parse -- never silently coerce to 'confirmed' (SYNC-02/D-02).
    if (!KNOWN_XKEDULE_STATUSES.has(b.status)) {
      console.warn('[xkedule/webhook] unrecognized status, skipping:', b.status)
      return ok({ skipped: 'unknown_status' })
    }

    // MIR-07: pending/awaiting_approval is never mirrored -- see the
    // UNCONFIRMED_XKEDULE_STATUSES doc comment above.
    if (UNCONFIRMED_XKEDULE_STATUSES.has(b.status)) {
      return ok({ skipped: 'not_yet_confirmed' })
    }

    const externalId = String(b.id)
    const occurredAt = payload.occurred_at
    const timeZone = b.timeZone || 'America/New_York'
    const status = mapStatus(b.status)

    // 3. Tenant-local date+time -> UTC
    const startAt = fromZonedTime(`${b.bookingDate} ${b.startTime}`, timeZone).toISOString()
    const endAt = fromZonedTime(`${b.bookingDate} ${b.endTime}`, timeZone).toISOString()

    // 4. Idempotency + last-write-wins ordering
    const { data: existing } = await supabase
      .from('bookings')
      .select('id, external_updated_at, status, start_at, end_at')
      .eq('org_id', orgId)
      .eq('external_source', 'xkedule')
      .eq('external_id', externalId)
      .maybeSingle()

    if (existing?.external_updated_at && new Date(existing.external_updated_at) >= new Date(occurredAt)) {
      return ok({ skipped: 'stale' })
    }

    // 5. Synthetic event type (required FK)
    const eventTypeId = await getOrCreateEventType(supabase, orgId)
    if (!eventTypeId) return ok({ skipped: 'no_org_member' })

    // 6. Contact match/create (MIR-02: E.164 canonicalization, default
    // region derived from the tenant's own timeZone the same way Xkedule's
    // resolveDefaultCountry does, with legacy-format reconciliation via
    // matchCandidates).
    const { value: phoneNorm, matchCandidates } = canonicalizeContactPhone(
      b.customer.phone ?? null,
      countryForTimeZone(timeZone),
    )
    const emailNorm = normaliseEmail(b.customer.email ?? null)
    const contactId = await matchOrCreateContact(supabase, orgId, {
      name: b.customer.name,
      phoneCandidates: matchCandidates,
      emailNorm,
    })

    // 7. MIR-06: price/currency/assigned-staff identity, carried on every
    // insert/update below. `staff` is the newer, richer field Xkedule now
    // sends; staffMemberId is the older id-only fallback still resolved for
    // safety if a caller only sends that.
    const serviceNames = (b.services ?? []).map((s) => s.name).filter(Boolean).join(', ')
    const bookerEmail =
      emailNorm ?? (phoneNorm ? `${phoneNorm.replace(/\D/g, '')}@xkedule.local` : `xk-${externalId}@xkedule.local`)
    const price = b.totalPrice != null && !Number.isNaN(Number(b.totalPrice)) ? Number(b.totalPrice) : null
    const currency = b.currency ?? null
    const staffId = b.staff?.id ?? b.staffMemberId ?? null
    const staffName = b.staff?.name ?? null

    // Fields valid for both insert and update (Update type excludes org_id / event_type_id).
    // start_at/end_at intentionally excluded here -- the existing-row branch
    // below decides whether to write them directly or via rescheduleBooking
    // (MIR-04); the insert branch always includes them (see `mutable` there).
    const sharedMutable = {
      booker_name: b.customer.name,
      booker_email: bookerEmail,
      booker_phone: phoneNorm,
      booker_timezone: timeZone,
      notes: serviceNames ? `Xkedule: ${serviceNames}` : null,
      linked_contact_id: contactId,
      price,
      currency,
      external_staff_id: staffId,
      external_staff_name: staffName,
      external_source: 'xkedule',
      external_id: externalId,
      external_updated_at: occurredAt,
      // status intentionally excluded here -- see the existing/insert branches below.
    }

    let bookingId: string
    if (existing) {
      // MIR-10: a terminal mirror row (cancelled/no_show/showed) must not be
      // silently revived by an out-of-order retry -- e.g. a booking.updated
      // job that was in backoff when the booking got cancelled, redelivered
      // AFTER the cancel with a newer occurred_at (stamped at delivery time,
      // not the original event time), would otherwise pass the staleness
      // check above and overwrite the cancelled row's data even though its
      // `status` column itself stays correctly guarded by
      // transition_booking_status's allowedFrom. Once a mirror row reaches a
      // terminal status, only a matching event (e.g. another 'cancelled') is
      // accepted; anything else is dropped before any write.
      if (TERMINAL_STATUSES.has(existing.status) && status !== existing.status) {
        return ok({ skipped: 'terminal_state' })
      }

      // MIR-04: a booking.updated that moves the date/time of an
      // already-confirmed booking is a genuine reschedule -- route it
      // through the canonical rescheduleBooking transition (the same one
      // the dashboard's manual reschedule uses) so meeting.rescheduled
      // actually fires. Only applies when the booking stays confirmed; any
      // other status change goes through the lifecycle dispatch below
      // instead, which owns start_at/end_at in that case.
      const timeChanged =
        new Date(existing.start_at).getTime() !== new Date(startAt).getTime() ||
        new Date(existing.end_at).getTime() !== new Date(endAt).getTime()
      const willReschedule = existing.status === 'confirmed' && status === 'confirmed' && timeChanged

      const updatePayload = willReschedule
        ? sharedMutable
        : { ...sharedMutable, start_at: startAt, end_at: endAt }

      const { error: updateErr } = await supabase.from('bookings').update(updatePayload).eq('id', existing.id)
      if (updateErr) {
        console.error('[xkedule/webhook] booking update error:', updateErr)
        return ok({ skipped: 'update_failed' })
      }
      bookingId = existing.id

      // 8. Route the STATUS transition (or the reschedule) through the
      // canonical lifecycle service (SYNC-02, D-02) -- never a raw
      // bookings.status write for an existing row. Idempotent no-op (no
      // event) if already at the mapped status.
      if (willReschedule) {
        const resched = await rescheduleBooking({ supabase }, bookingId, orgId, startAt, endAt)
        if (!resched.ok) {
          console.error('[xkedule/webhook] reschedule transition failed:', resched.error)
        }
      } else {
        const tx = await runXkeduleTransition({ supabase }, status, bookingId, orgId)
        if (!tx.ok) {
          console.error('[xkedule/webhook] lifecycle transition failed:', tx.error)
        }
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('bookings')
        .insert({
          ...sharedMutable,
          start_at: startAt,
          end_at: endAt,
          status,
          org_id: orgId,
          event_type_id: eventTypeId,
        })
        .select('id')
        .single()
      if (error || !inserted) {
        console.error('[xkedule/webhook] booking insert error:', error)
        return ok({ skipped: 'insert_failed' })
      }
      bookingId = inserted.id

      // 8. Emit the calendar event -> drives meeting.* workflows (fire-and-forget so we return 200 fast)
      void emitCalendarEvent(
        { supabase },
        { event: calendarEventForNewRow(payload.event, status), booking_id: bookingId, org_id: orgId },
      ).catch((err) => console.error('[xkedule/webhook] emitCalendarEvent error:', err))
    }

    return ok()
  } catch (err) {
    console.error('[xkedule/webhook] error:', err)
    return Response.json({ ok: true })
  }
}
