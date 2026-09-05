// SEED-027 Phase E: builds the {{meeting.*}} variable scope that calendar-
// triggered workflows consume. Joins booking + contact + organizer + event
// type + resolved location (SEED-028 D) into a single namespace.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  resolveMeetingLocation,
  type LocationKind,
} from '@/lib/calendar/location-resolver'

export interface MeetingScope {
  id: string
  org_id: string
  title: string
  starts_at: string
  ends_at: string
  /** ISO timestamp 24 hours before starts_at — useful as a wait `until` target. */
  starts_at_minus_24h: string
  /** ISO timestamp 1 hour before starts_at — useful as a wait `until` target. */
  starts_at_minus_1h: string
  /** ISO timestamp 2 hours after ends_at — useful as a wait `until` target. */
  ends_at_plus_2h: string
  /** Date-only in the booking timezone, e.g. "July 1, 2026" */
  starts_date: string
  /** Time-only in the booking timezone, e.g. "9:00 AM" */
  starts_time: string
  /** IANA timezone name from the booking, e.g. "America/New_York" */
  timezone: string
  /** Google Calendar "Add to Calendar" URL pre-filled with booking details */
  google_calendar_url: string
  duration_minutes: number
  status: string
  notes: string | null
  organizer: {
    user_id: string | null
    name: string | null
    email: string | null
  }
  attendee_contact: {
    id: string | null
    name: string
    /** First word of the contact name */
    first_name: string
    email: string
    phone: string | null
  }
  event_type: {
    id: string | null
    name: string | null
    slug: string | null
  }
  location: {
    kind: string
    label: string
    address: string | null
    coordinates: { lat: number; lng: number } | null
    phone: string | null
  }
  link: string
  rescheduled_from?: string
  rescheduled_to?: string
}

// The subset of a `bookings` row assembleMeetingScope needs. Populated
// either by a real SELECT (buildMeetingScope) or synthesized directly from
// an event's own payload when there is no mirror row to query
// (buildMeetingScopeFromData -- see its comment below).
interface BookingLike {
  id: string
  org_id: string
  booker_name: string
  booker_email: string
  booker_phone: string | null
  booker_timezone: string | null
  start_at: string
  end_at: string
  status: string
  notes: string | null
  linked_contact_id: string | null
  location_kind: string | null
  location_data: Record<string, unknown> | null
  meeting_url: string | null
  meeting_phone: string | null
  event_type_id: string | null
}

export async function buildMeetingScope(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  extras?: { rescheduled_from?: string; rescheduled_to?: string },
): Promise<MeetingScope | null> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      `
      id, org_id, booker_name, booker_email, booker_phone, booker_timezone,
      start_at, end_at, status, notes, linked_contact_id,
      location_kind, location_data, meeting_url, meeting_phone, event_type_id
      `,
    )
    .eq('id', bookingId)
    .single()

  if (error || !booking) return null

  return assembleMeetingScope(supabase, booking as unknown as BookingLike, extras)
}

// Data shape emitted for `meeting.requested` (see CalendarEventPayload's
// `requested` field, lib/calendar/events.ts) -- a pending/awaiting_approval
// Xkedule booking that MIR-07 deliberately never mirrors into `bookings`
// (the provider can still reject it, and bookings.status's CHECK constraint
// has no honest value for "pending" -- supabase/migrations/
// 1224_booking_status_showed.sql). There is therefore no row id to query;
// this builds the same {{meeting.*}} scope shape directly from the raw
// fields the caller already gathered (src/lib/action-engine/executors/
// xkedule-booking-events.ts), sharing every join/formatting rule in
// assembleMeetingScope with the real, row-backed path above.
export interface RequestedBookingData {
  booker_name: string
  booker_email: string
  booker_phone: string | null
  booker_timezone?: string | null
  start_at: string
  end_at: string
  event_type_id: string | null
  linked_contact_id: string | null
  notes?: string | null
}

export async function buildMeetingScopeFromData(
  supabase: SupabaseClient<Database>,
  orgId: string,
  syntheticId: string,
  data: RequestedBookingData,
): Promise<MeetingScope> {
  const booking: BookingLike = {
    id: syntheticId,
    org_id: orgId,
    booker_name: data.booker_name,
    booker_email: data.booker_email,
    booker_phone: data.booker_phone,
    booker_timezone: data.booker_timezone ?? null,
    start_at: data.start_at,
    end_at: data.end_at,
    status: 'pending',
    notes: data.notes ?? null,
    linked_contact_id: data.linked_contact_id,
    location_kind: null,
    location_data: null,
    meeting_url: null,
    meeting_phone: null,
    event_type_id: data.event_type_id,
  }
  return assembleMeetingScope(supabase, booking)
}

async function assembleMeetingScope(
  supabase: SupabaseClient<Database>,
  booking: BookingLike,
  extras?: { rescheduled_from?: string; rescheduled_to?: string },
): Promise<MeetingScope> {
  // Optional joins (event_type, store, contact). Each is best-effort |
  // missing rows just leave the corresponding fields null.
  const [eventTypeRes, contactRes] = await Promise.all([
    booking.event_type_id
      ? supabase
          .from('event_types')
          .select('id, title, slug, location_type, location_value, user_id')
          .eq('id', booking.event_type_id)
          .single()
      : Promise.resolve({ data: null }),
    booking.linked_contact_id
      ? supabase
          .from('contacts')
          .select('id, name, email, phone')
          .eq('id', booking.linked_contact_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const eventType = (eventTypeRes as { data: { id?: string; title?: string; slug?: string; location_type?: string; location_value?: string; user_id?: string } | null }).data
  const contact = (contactRes as { data: { id?: string; name?: string | null; email?: string | null; phone?: string | null } | null }).data

  let organizer: MeetingScope['organizer'] = { user_id: null, name: null, email: null }
  if (eventType?.user_id) {
    try {
      const { data: userRes } = await supabase.auth.admin.getUserById(eventType.user_id)
      const user = userRes?.user
      if (user) {
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>
        const fullName =
          (typeof meta.full_name === 'string' && meta.full_name) ||
          (typeof meta.name === 'string' && meta.name) ||
          null
        organizer = { user_id: eventType.user_id, name: fullName, email: user.email ?? null }
      }
    } catch (err) {
      console.warn('[calendar/scope] organizer lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  // Hydrate the store location only when the booking explicitly uses it.
  let store: Awaited<ReturnType<typeof loadStore>> = null
  if (booking.location_kind === 'store_location') {
    const storeId = (booking.location_data as Record<string, unknown>)?.store_id
    if (typeof storeId === 'string') {
      store = await loadStore(supabase, storeId)
    }
  }

  const tz = (booking.booker_timezone as string | null) ?? 'America/New_York'
  const startDate = new Date(booking.start_at as string)
  const endDate = new Date(booking.end_at as string)
  const startMs = startDate.getTime()
  const endMs = endDate.getTime()
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000))

  const startsDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'long', day: 'numeric', year: 'numeric',
  }).format(startDate)
  const startsTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(startDate)

  const resolved = resolveMeetingLocation({
    kind: (booking.location_kind ?? eventType?.location_type ?? null) as LocationKind | null,
    meeting_url: booking.meeting_url,
    meeting_phone: booking.meeting_phone,
    location_data: booking.location_data as Record<string, unknown>,
    store,
    contact: contact
      ? { name: contact.name ?? '', phone: contact.phone ?? null, address: null }
      : null,
    legacy_location_type: eventType?.location_type ?? null,
    legacy_location_value: eventType?.location_value ?? null,
  })

  const fullName = contact?.name ?? (booking.booker_name as string) ?? ''
  const firstName = fullName.split(' ')[0] ?? fullName

  const gcalTitle = encodeURIComponent(eventType?.title ?? 'Appointment')
  const gcalStart = startDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const gcalEnd = endDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const gcalLoc = encodeURIComponent(resolved.address ?? '')
  const googleCalendarUrl =
    `https://www.google.com/calendar/render?action=TEMPLATE&text=${gcalTitle}&dates=${gcalStart}/${gcalEnd}&location=${gcalLoc}`

  return {
    id: booking.id as string,
    org_id: booking.org_id as string,
    title: eventType?.title ?? 'Meeting',
    starts_at: booking.start_at as string,
    ends_at: booking.end_at as string,
    starts_at_minus_24h: new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
    starts_at_minus_1h: new Date(startMs - 60 * 60 * 1000).toISOString(),
    ends_at_plus_2h: new Date(endMs + 2 * 60 * 60 * 1000).toISOString(),
    starts_date: startsDate,
    starts_time: startsTime,
    timezone: tz,
    google_calendar_url: googleCalendarUrl,
    duration_minutes: durationMinutes,
    status: booking.status as string,
    notes: (booking.notes as string | null) ?? null,
    organizer,
    attendee_contact: contact
      ? {
          id: contact.id ?? null,
          name: contact.name ?? booking.booker_name as string,
          first_name: firstName,
          email: contact.email ?? (booking.booker_email as string),
          phone: contact.phone ?? (booking.booker_phone as string | null),
        }
      : {
          id: null,
          name: booking.booker_name as string,
          first_name: firstName,
          email: booking.booker_email as string,
          phone: booking.booker_phone as string | null,
        },
    event_type: {
      id: eventType?.id ?? null,
      name: eventType?.title ?? null,
      slug: eventType?.slug ?? null,
    },
    location: {
      kind: resolved.kind,
      label: resolved.label,
      address: resolved.address,
      coordinates: resolved.coordinates,
      phone: resolved.phone,
    },
    link: resolved.link,
    ...extras,
  }
}

async function loadStore(supabase: SupabaseClient<Database>, storeId: string) {
  const { data } = await supabase
    .from('tenant_locations')
    .select(
      'name, address_line_1, address_line_2, city, state, postal_code, country, latitude, longitude, phone',
    )
    .eq('id', storeId)
    .single()
  return data as Awaited<ReturnType<typeof supabase.from>>['data'] extends infer T
    ? T
    : null
}
