// src/lib/xkedule/mirror.ts
//
// Shared building blocks for turning an Xkedule booking into a row in the
// native `bookings` table, used by BOTH write paths that create this mirror:
//   1. POST /api/xkedule/webhook (src/app/api/xkedule/webhook/route.ts) --
//      the Xkedule -> Xphere direction, driven by Xkedule's own webhook
//      delivery (not configured for every tenant).
//   2. The Action Engine's xkedule_create_booking executor
//      (src/lib/action-engine/executors/xkedule-booking-events.ts) -- fires
//      immediately after OUR OWN platform action creates a booking directly
//      against Xkedule's /api/v1/bookings, so a confirmation doesn't have to
//      wait for (1) to ever happen.
//
// Extracted verbatim out of route.ts so the two paths can never drift on
// contact matching, event-type bootstrap, or status mapping -- see each
// route's own file header for the invariants (MIR-02/MIR-06/MIR-07) these
// enforce.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { CalendarEvent } from '@/lib/calendar/events'
import type { BookingStatus } from '@/lib/calendar/booking-status'

type ServiceClient = SupabaseClient<Database>

// Exhaustive set of Xkedule statuses either write path knows how to handle.
// A genuinely unrecognized value (typo, new provider status, malformed
// payload) must be logged and skipped BEFORE any DB access -- never silently
// coerced to 'confirmed' (SYNC-02/D-02: no silent coercion).
export const KNOWN_XKEDULE_STATUSES = new Set([
  'pending', 'awaiting_approval', 'confirmed', 'completed', 'cancelled', 'no_show',
])

// MIR-07: pending/awaiting_approval bookings must never mirror as confirmed
// -- Xkedule's booking can still be rejected while in these states, so
// mirroring it (and firing meeting.scheduled/meeting.confirmed) would
// trigger reminder/opportunity/confirmation workflows for something that
// might never happen. There is no DB-level "pending" bookings.status value
// (LIFE-02 deliberately keeps the vocabulary to
// confirmed/cancelled/no_show/showed, see the CHECK constraint in
// supabase/migrations/1224_booking_status_showed.sql) -- rather than widen
// that CHECK constraint and every transition's allowedFrom for a state that
// may resolve to "never happened," both write paths simply do not mirror
// the booking at all (no insert, no update, no contact write, no calendar
// event) until Xkedule reports a decided status.
export const UNCONFIRMED_XKEDULE_STATUSES = new Set(['pending', 'awaiting_approval'])

export function isUnconfirmedXkeduleStatus(status: string): boolean {
  return UNCONFIRMED_XKEDULE_STATUSES.has(status)
}

// Xkedule status (pending|awaiting_approval|confirmed|completed|cancelled|no_show)
// -> native enum. pending/awaiting_approval must never reach this function
// (see UNCONFIRMED_XKEDULE_STATUSES above); unrecognized values must never
// reach it either (reject via KNOWN_XKEDULE_STATUSES first). 'completed'
// maps to 'showed' -- the DB's only attendance/completion value (LIFE-02).
export function mapStatus(s: string): BookingStatus {
  if (s === 'cancelled') return 'cancelled'
  if (s === 'no_show') return 'no_show'
  if (s === 'completed') return 'showed'
  return 'confirmed'
}

// Called ONLY for a booking Xphere has never mirrored before (a fresh
// INSERT). The first event/call for any booking is a "scheduled" moment
// from this mirror's point of view, regardless of which Xkedule event name
// triggered it -- an out-of-order `booking.updated` arriving before
// `booking.created` (network reordering) must not be mislabeled as a
// reschedule of something that never existed. A booking that arrives
// already cancelled/no_show/completed still gets its real terminal event.
// `event` is the Xkedule webhook event name when called from the webhook
// (e.g. 'booking.cancelled'); the Action Engine's own create path has no
// such event name and passes '' -- status alone already decides every
// outcome except the (redundant, belt-and-suspenders) 'booking.cancelled'
// short-circuit below.
export function calendarEventForNewRow(event: string, status: BookingStatus): CalendarEvent {
  if (event === 'booking.cancelled' || status === 'cancelled') return 'meeting.cancelled'
  if (status === 'no_show') return 'meeting.no_show'
  if (status === 'showed') return 'meeting.completed'
  return 'meeting.scheduled'
}

// Lazily get-or-create a synthetic "Xkedule" event type for the org. bookings
// requires event_type_id (NOT NULL); event_types requires a user_id (any member).
export async function getOrCreateEventType(supabase: ServiceClient, orgId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('event_types')
    .select('id')
    .eq('org_id', orgId)
    .eq('slug', 'xkedule')
    .maybeSingle()
  if (existing) return existing.id

  const { data: member } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle()
  if (!member) return null

  const { data: created, error } = await supabase
    .from('event_types')
    .insert({
      org_id: orgId,
      user_id: member.user_id,
      title: 'Xkedule',
      slug: 'xkedule',
      description: 'Bookings mirrored from Xkedule',
      location_type: 'in_person',
    })
    .select('id')
    .single()
  if (error || !created) {
    console.error('[xkedule/mirror] event_type create error:', error)
    return null
  }
  return created.id
}

// Match by phone (E.164, MIR-02-reconciled against legacy loose-normalized
// rows) -> email (normalized) -> create. Mirrors /api/v1/contacts.
export async function matchOrCreateContact(
  supabase: ServiceClient,
  orgId: string,
  c: { name: string; phoneCandidates: string[]; emailNorm: string | null },
): Promise<string | null> {
  let existingId: string | null = null
  if (c.phoneCandidates.length > 0) {
    // .limit(1) instead of .maybeSingle(): with MIR-02's multi-candidate
    // match, two DISTINCT existing contacts could each satisfy a different
    // candidate (a legacy loose-form row and a separately-created E.164-form
    // row for the same real number) -- .maybeSingle() would error on more
    // than one match. Deterministically prefer the oldest (first-created)
    // contact rather than crash over exactly the duplicate this feature
    // exists to reconcile.
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .in('phone_e164', c.phoneCandidates)
      .neq('identity_status', 'archived_duplicate')
      .order('created_at', { ascending: true })
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id
  }
  if (!existingId && c.emailNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', c.emailNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existingId = data.id
  }
  if (existingId) return existingId

  const phoneToStore = c.phoneCandidates[0] ?? null
  const { data, error } = await supabase
    .from('contacts')
    .insert({ org_id: orgId, name: c.name, phone: phoneToStore, email: c.emailNorm, source: 'api' })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[xkedule/mirror] contact create error:', error)
    return null
  }
  return data.id
}
