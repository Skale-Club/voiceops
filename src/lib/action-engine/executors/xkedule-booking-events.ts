// src/lib/action-engine/executors/xkedule-booking-events.ts
//
// Closes the "no confirmation" gap: a customer who books through the
// Xkedule `book_appointment` tool (createXkeduleBooking,
// src/lib/xkedule/actions/create-booking.ts) got no meeting.* calendar
// event at all unless Xkedule's OWN webhook was configured for that tenant
// (it isn't, for the demo org) and eventually delivered one. Even when it
// is configured, a booking the platform itself just created shouldn't have
// to wait for a round trip through the provider to be acknowledged.
//
// This module is invoked from execute-action.ts's 'xkedule_create_booking'
// case, via createXkeduleBooking's onCreated hook, immediately after a
// successful create -- and mirrors the booking into the native `bookings`
// table + emits meeting.* using the SAME builder/emitter functions the
// webhook uses (src/lib/xkedule/mirror.ts, src/lib/calendar/transition.ts),
// so both write paths stay byte-identical in contact matching, event-type
// bootstrap, and status vocabulary.
//
// Idempotency with the later webhook delivery (if the tenant has one
// configured): this inserts the mirror row itself, keyed by
// (org_id, external_source='xkedule', external_id) -- exactly what the
// webhook's own existing-row lookup (route.ts step 4) keys on. When that
// webhook later delivers an event for the same booking, it will find this
// row and take its UPDATE branch (a last-write-wins update, possibly an
// idempotent no-op transition), never its INSERT branch -- so the webhook
// can never re-fire the "first-seen" meeting.scheduled/meeting.confirmed
// event this module already fired. A duplicate/retried call INTO this
// module (e.g. two overlapping tool calls) is guarded the same way: it
// re-checks for an existing mirror row by external_id before inserting.
//
// MIR-07 respected, not relaxed: a pending/awaiting_approval Xkedule status
// has no representation in bookings.status (CHECK constraint only allows
// confirmed/cancelled/no_show/showed -- supabase/migrations/
// 1224_booking_status_showed.sql) and Xkedule itself can still reject the
// booking while it's in this state. So this module mirrors nothing and
// emits nothing for a pending/awaiting_approval booking -- same as the
// webhook. It mirrors/emits later, once Xkedule's webhook (if configured)
// delivers a decided status.
//
// Fire-and-forget: called from execute-action.ts as
// `void emitXkeduleBookingCreatedEvents(...).catch(...)` AFTER
// createXkeduleBooking's return string is already computed. Every internal
// failure is caught here too (belt-and-suspenders) and logged -- this must
// never throw into, or change, the tool's own result.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import type { Database } from '@/types/database'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import type { XkeduleCredentials } from '@/lib/xkedule/client'
import { resolveOrgTimezone } from '@/lib/xkedule/availability-cache'
import type { XkeduleBookingCreated } from '@/lib/xkedule/actions/create-booking'
import {
  KNOWN_XKEDULE_STATUSES,
  UNCONFIRMED_XKEDULE_STATUSES,
  mapStatus,
  calendarEventForNewRow,
  getOrCreateEventType,
  matchOrCreateContact,
} from '@/lib/xkedule/mirror'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { canonicalizeContactPhone, countryForTimeZone } from '@/lib/phone-numbers/normalize'
import { log } from '@/lib/logger'

type ServiceClient = SupabaseClient<Database>

async function warn(orgId: string, message: string, extra?: Record<string, unknown>): Promise<void> {
  console.warn('[xkedule-booking-events]', message, extra ?? '')
  void log({
    event_type: 'xkedule.booking_created_event_skipped',
    source: 'action-engine',
    severity: 'warn',
    status: 'skipped',
    org_id: orgId,
    actor_type: 'system',
    payload: { message, ...extra },
  })
}

/**
 * Mirrors a freshly Xkedule-created booking into `bookings` and emits the
 * platform's own meeting.scheduled (always, for a decided status) and
 * meeting.confirmed (only when that status is 'confirmed') calendar events.
 *
 * Never throws -- every failure path returns quietly after logging. The
 * caller (execute-action.ts) additionally wraps this in its own
 * `.catch(...)`, so a bug here is doubly incapable of reaching the agent's
 * tool-call result.
 */
export async function emitXkeduleBookingCreatedEvents(
  supabase: ServiceClient,
  orgId: string,
  credentials: XkeduleCredentials,
  created: XkeduleBookingCreated,
): Promise<void> {
  try {
    const { booking, input } = created
    const rawStatus = booking.status

    if (!KNOWN_XKEDULE_STATUSES.has(rawStatus)) {
      // Never silently coerce an unrecognized status to 'confirmed'
      // (SYNC-02/D-02) -- same guard the webhook applies first.
      await warn(orgId, 'unrecognized Xkedule status, skipping', { status: rawStatus })
      return
    }

    if (UNCONFIRMED_XKEDULE_STATUSES.has(rawStatus)) {
      // MIR-07: nothing to mirror or emit until Xkedule reports a decided
      // status -- see this file's header.
      return
    }

    const nativeStatus = mapStatus(rawStatus)
    const externalId = String(booking.id)

    // Idempotency guard: someone (a racing webhook delivery, or a duplicate
    // invocation of this hook) may have already mirrored this exact
    // external booking. Never double-insert, never double-emit.
    const { data: existing } = await supabase
      .from('bookings')
      .select('id')
      .eq('org_id', orgId)
      .eq('external_source', 'xkedule')
      .eq('external_id', externalId)
      .maybeSingle()
    if (existing) return

    const bookingDate = booking.bookingDate ?? (typeof input.bookingDate === 'string' ? input.bookingDate : null)
    const startTime = booking.startTime ?? (typeof input.startTime === 'string' ? input.startTime : null)
    if (!bookingDate || !startTime) {
      await warn(orgId, 'missing bookingDate/startTime, cannot build start_at', { externalId })
      return
    }

    const timeZone = await resolveOrgTimezone(credentials)

    let startAt: string
    let endAt: string
    try {
      startAt = fromZonedTime(`${bookingDate} ${startTime}`, timeZone).toISOString()
      endAt = booking.endTime
        ? fromZonedTime(`${bookingDate} ${booking.endTime}`, timeZone).toISOString()
        : startAt
    } catch (err) {
      await warn(orgId, 'failed to convert tenant-local date/time to UTC', {
        externalId,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    const eventTypeId = await getOrCreateEventType(supabase, orgId)
    if (!eventTypeId) {
      await warn(orgId, 'no org member to own the synthetic Xkedule event type', { externalId })
      return
    }

    const customerName = typeof input.customerName === 'string' && input.customerName.trim()
      ? input.customerName.trim()
      : 'Customer'
    const customerPhone = typeof input.customerPhone === 'string' ? input.customerPhone : null
    const customerEmail = typeof input.customerEmail === 'string' ? input.customerEmail : null

    // Same E.164 canonicalization + legacy reconciliation the webhook uses
    // (MIR-02), region derived from the same resolved tenant timezone.
    const { value: phoneNorm, matchCandidates } = canonicalizeContactPhone(
      customerPhone,
      countryForTimeZone(timeZone),
    )
    const emailNorm = normaliseEmail(customerEmail)
    const contactId = await matchOrCreateContact(supabase, orgId, {
      name: customerName,
      phoneCandidates: matchCandidates,
      emailNorm,
    })

    const bookerEmail =
      emailNorm ?? (phoneNorm ? `${phoneNorm.replace(/\D/g, '')}@xkedule.local` : `xk-${externalId}@xkedule.local`)
    const price =
      booking.totalPrice != null && !Number.isNaN(Number(booking.totalPrice)) ? Number(booking.totalPrice) : null
    const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null

    const { data: inserted, error } = await supabase
      .from('bookings')
      .insert({
        org_id: orgId,
        event_type_id: eventTypeId,
        booker_name: customerName,
        booker_email: bookerEmail,
        booker_phone: phoneNorm,
        booker_timezone: timeZone,
        notes,
        linked_contact_id: contactId,
        price,
        currency: null,
        external_staff_id: null,
        external_staff_name: null,
        external_source: 'xkedule',
        external_id: externalId,
        external_updated_at: new Date().toISOString(),
        start_at: startAt,
        end_at: endAt,
        status: nativeStatus,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      await warn(orgId, 'booking mirror insert failed', {
        externalId,
        error: error?.message,
      })
      return
    }

    const bookingId = inserted.id as string

    // Always fire the "first-seen" event (meeting.scheduled for the common
    // confirmed case; meeting.cancelled/no_show/completed if Xkedule somehow
    // returned an already-terminal status on create) -- same function/logic
    // the webhook's INSERT branch uses. Passing '' for the Xkedule event
    // name: this call has no webhook event string, and status alone already
    // decides every outcome except the redundant 'booking.cancelled'
    // short-circuit inside calendarEventForNewRow.
    await emitCalendarEvent(
      { supabase },
      { event: calendarEventForNewRow('', nativeStatus), booking_id: bookingId, org_id: orgId },
    )

    // The booking the customer just made is ALREADY confirmed -- fire
    // meeting.confirmed too (the event booking-confirmation.yaml and any
    // tenant-added confirmation workflow actually trigger on), instead of
    // waiting for a webhook round trip that may never come. Mirrors the MCP
    // bookings_create tool's identical rationale (src/lib/mcp/tools/
    // bookings.ts).
    if (nativeStatus === 'confirmed') {
      await emitCalendarEvent(
        { supabase },
        { event: 'meeting.confirmed', booking_id: bookingId, org_id: orgId },
      )
    }
  } catch (err) {
    console.error('[xkedule-booking-events] unexpected error:', err)
    void log({
      event_type: 'xkedule.booking_created_event_failed',
      source: 'action-engine',
      severity: 'error',
      status: 'failed',
      org_id: orgId,
      actor_type: 'system',
      error_message: err instanceof Error ? err.message : String(err),
    })
  }
}
