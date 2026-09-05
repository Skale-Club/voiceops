// SEED-027 Phase A: typed calendar event names.
// Every booking lifecycle transition or time-based trigger emits one of these
// via lib/calendar/transition.ts (Phase B). The workflow engine's trigger
// registry indexes workflows by these values.

export type CalendarEvent =
  | 'meeting.requested'
  | 'meeting.scheduled'
  | 'meeting.confirmed'
  | 'meeting.cancelled'
  | 'meeting.rescheduled'
  | 'meeting.no_show'
  | 'meeting.completed'
  | 'meeting.starts_in'
  | 'meeting.ended'

export const CALENDAR_EVENTS: readonly CalendarEvent[] = [
  'meeting.requested',
  'meeting.scheduled',
  'meeting.confirmed',
  'meeting.cancelled',
  'meeting.rescheduled',
  'meeting.no_show',
  'meeting.completed',
  'meeting.starts_in',
  'meeting.ended',
] as const

// Emitted for `meeting.requested` only (see CalendarEventPayload.requested
// below): the raw booking-like fields for a booking a provider has accepted
// but not yet decided (Xkedule's pending/awaiting_approval). MIR-07 means
// this never gets a `bookings` mirror row -- the provider can still reject
// it, and bookings.status's CHECK constraint has no honest "pending" value
// (supabase/migrations/1224_booking_status_showed.sql) -- so this payload
// carries the same shape the other calendar events' bookings row would have
// exposed, instead of a booking_id to look one up by.
export interface RequestedMeetingData {
  booker_name: string
  booker_email: string
  booker_phone: string | null
  start_at: string
  end_at: string
  event_type_id: string | null
  linked_contact_id: string | null
  price: number | null
  external_source: string | null
  external_id: string | null
  status: 'pending'
}

export interface CalendarEventPayload {
  event: CalendarEvent
  // Null only for `meeting.requested` -- see RequestedMeetingData's comment
  // above. Every other event has a real `bookings` row and always passes its
  // id here. When null, `requested` below must be populated instead;
  // lib/calendar/transition.ts's emitCalendarEvent builds the {{meeting.*}}
  // workflow scope straight from it (buildMeetingScopeFromData,
  // lib/calendar/scope.ts) rather than querying `bookings`, and generates a
  // synthetic uuid internally to satisfy event_dispatches.source_id (NOT
  // NULL, but not foreign-keyed to bookings, so a non-row id is safe to
  // record there).
  booking_id: string | null
  org_id: string
  // Populated for meeting.starts_in only.
  offset_minutes?: number
  // Populated for meeting.rescheduled only.
  rescheduled_from?: string
  rescheduled_to?: string
  // Populated for meeting.requested only -- see booking_id's comment above.
  requested?: RequestedMeetingData
}
