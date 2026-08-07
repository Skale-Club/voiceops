'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { addMinutes, startOfDay, endOfDay, addDays } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { generateSlots, generateSlotsWithReasons, type DebugTimeSlot } from '@/lib/calendar/slots'
import { lookBusyConfigFor } from '@/lib/calendar/look-busy'
import { fetchBusyTimes } from '@/lib/calendar/google-calendar'
import { resolveAndValidateSlot } from '@/lib/calendar/booking-validation'
import { rateLimit } from '@/lib/rate-limit'
import { resolveLiveContactId } from '@/lib/contacts/server'
import {
  sendBookingConfirmation,
  sendBookingCancellation,
} from '@/lib/calendar/emails'
import type { TimeSlot } from '@/lib/calendar/slots'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import { cancelBooking as transitionCancelBooking } from '@/lib/calendar/transition'
import type { CalendarEventPayload } from '@/lib/calendar/events'
import { getSiteOriginFromHeaders } from '@/lib/site-url'
import { BOOKING_STATUSES } from '@/lib/calendar/booking-status'

// Resolve a friendly host display string from auth.users. We don't have a
// dedicated profile-name table for scheduling, so fall back to the email.
// Returns 'your host' as a final fallback so the email body always reads ok.
// Build a defaults map for required custom_field_definitions on contacts.
// The public booker has no UI to fill these in; we provide sensible
// type-appropriate defaults so the contact insert satisfies any required-
// field invariant the org has configured. If the org has none, returns {}.
//
// Service role read | public booking has no auth.uid() context.
async function buildRequiredCustomFieldDefaults(
  orgId: string,
): Promise<Record<string, unknown>> {
  try {
    const svc = createServiceRoleClient()
    const { data } = await svc
      .from('custom_field_definitions')
      .select('key, type, default_value')
      .eq('org_id', orgId)
      .eq('entity', 'contact')
      .eq('required', true)
      .eq('archived', false)

    const defaults: Record<string, unknown> = {}
    for (const def of data ?? []) {
      // Honor an explicit default_value if the admin set one.
      if (def.default_value !== null && def.default_value !== undefined) {
        defaults[def.key] = def.default_value
        continue
      }
      defaults[def.key] = defaultForType(def.type as string)
    }
    return defaults
  } catch (err) {
    console.warn(
      '[calendar/bookings] failed to load custom field defaults:',
      err instanceof Error ? err.message : err,
    )
    return {}
  }
}

function defaultForType(type: string): unknown {
  switch (type) {
    case 'text':
    case 'long_text':
    case 'select':
    case 'email':
    case 'url':
    case 'phone':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'date':
      return '1970-01-01'
    case 'datetime':
      return '1970-01-01T00:00:00.000Z'
    case 'multi_select':
      return []
    case 'currency':
      return { amount: 0, currency: 'USD' }
    default:
      return null
  }
}

async function resolveHostName(userId: string): Promise<string> {
  try {
    const svc = createServiceRoleClient()
    const { data } = await svc.auth.admin.getUserById(userId)
    const user = data?.user
    if (!user) return 'your host'
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    const fullName =
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      null
    if (fullName) return fullName
    return user.email ?? 'your host'
  } catch {
    return 'your host'
  }
}

// Extract the client IP from the incoming request headers. Vercel + most
// reverse proxies populate x-forwarded-for (comma-separated). We take the
// first entry. Falls back to x-real-ip, then 'unknown' so rate limiting
// degrades to a single shared bucket rather than crashing.
async function getClientIp(): Promise<string> {
  try {
    const h = await headers()
    const xff = h.get('x-forwarded-for')
    if (xff) return xff.split(',')[0].trim()
    const xri = h.get('x-real-ip')
    if (xri) return xri.trim()
  } catch {
    // headers() throws outside a request context | treat as unknown.
  }
  return 'unknown'
}

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type BookingRow = {
  id: string
  org_id: string
  event_type_id: string
  booker_name: string
  booker_email: string
  booker_phone: string | null
  booker_timezone: string
  start_at: string
  end_at: string
  notes: string | null
  status: string
  linked_contact_id: string | null
  cancel_token: string
  created_at: string
  updated_at: string
}

// ─── Dashboard: list bookings ──────────────────────────────────────────────────

const LIST_LIMIT = 50

export interface BookingListSections {
  upcoming: BookingRow[]
  past: BookingRow[]
  cancelled: BookingRow[]
}

// SYNC-03: replaces the old getBookings(), which selected the entire
// `bookings` table with no .limit()/.range() ever applied — an unbounded
// query that grew linearly with total historical booking count. Each
// section here is independently bounded via .limit(LIST_LIMIT), so the
// flat list at /calendar/bookings can never load more than 150 rows
// regardless of org history size. 'showed' is included in the `past`
// filter server-side (not derived by client-side filtering afterward) —
// this is also the fix for 'showed' bookings vanishing from the UI.
export async function getBookingsForList(): Promise<ActionResult<BookingListSections>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const nowIso = new Date().toISOString()

  const [upcomingRes, pastRes, cancelledRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('*')
      .eq('status', 'confirmed')
      .gte('start_at', nowIso)
      .order('start_at', { ascending: true })
      .limit(LIST_LIMIT),
    supabase
      .from('bookings')
      .select('*')
      .in('status', ['confirmed', 'no_show', 'showed'])
      .lt('start_at', nowIso)
      .order('start_at', { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from('bookings')
      .select('*')
      .eq('status', 'cancelled')
      .order('start_at', { ascending: false })
      .limit(LIST_LIMIT),
  ])

  const firstError = upcomingRes.error ?? pastRes.error ?? cancelledRes.error
  if (firstError) return { ok: false, error: firstError.message }

  return {
    ok: true,
    data: {
      upcoming: upcomingRes.data ?? [],
      past: pastRes.data ?? [],
      cancelled: cancelledRes.data ?? [],
    },
  }
}

// SYNC-03: replaces the from/to params on the old getBookings() that the
// calendar week/month view (/calendar/calendar) never actually passed,
// even though it already computes a weekStart/weekEnd window for its
// Google Calendar fetch. Date-bounded by design — callers MUST supply a
// finite window; there is no "fetch everything" mode anymore.
export async function getBookingsForRange(params: {
  from: string
  to: string
  status?: string
}): Promise<ActionResult<BookingRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  let query = supabase
    .from('bookings')
    .select('*')
    .gte('start_at', params.from)
    .lte('start_at', params.to)
    .order('start_at', { ascending: true })

  if (params.status) {
    query = query.eq('status', params.status as 'confirmed' | 'cancelled' | 'no_show' | 'showed')
  }

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

// ─── Dashboard: cancel booking ────────────────────────────────────────────────

export async function cancelBooking(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { data: orgId } = await (await createClient()).rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'not_authenticated' }

  const svc = createServiceRoleClient()
  const result = await transitionCancelBooking({ supabase: svc, depth: 0 }, id, orgId)
  if (!result.ok) return { ok: false, error: result.error ?? 'cancel_failed' }

  revalidatePath('/calendar/bookings')
  void sendCancellationEmailForBooking(id).catch(() => {})

  return { ok: true, data: undefined }
}

// Shared helper for cancellation paths. Looks up the booking + event type
// + calendar profile + host name, then queues the cancellation email.
// Never throws | caller wraps with .catch already.
async function sendCancellationEmailForBooking(bookingId: string): Promise<void> {
  try {
    const svc = createServiceRoleClient()

    const { data: b } = await svc
      .from('bookings')
      .select('id, booker_name, booker_email, booker_timezone, start_at, event_type_id')
      .eq('id', bookingId)
      .maybeSingle()
    if (!b) return

    const { data: et } = await svc
      .from('event_types')
      .select('title, user_id, slug')
      .eq('id', b.event_type_id)
      .maybeSingle()
    if (!et) return

    const { data: profile } = await svc
      .from('calendar_profiles')
      .select('slug')
      .eq('user_id', et.user_id)
      .maybeSingle()

    const hostName = await resolveHostName(et.user_id)
    const siteUrl = await getSiteOriginFromHeaders()
    const rebookUrl = profile?.slug
      ? `${siteUrl}/book/${profile.slug}/${et.slug}`
      : siteUrl

    await sendBookingCancellation({
      bookerEmail: b.booker_email,
      bookerName: b.booker_name,
      hostName,
      eventTitle: et.title,
      startAt: b.start_at,
      timezone: b.booker_timezone,
      rebookUrl,
    })
  } catch (err) {
    console.warn(
      '[calendar/bookings] cancellation email pipeline failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── Look busy ────────────────────────────────────────────────────────────────

// May the caller be told that a free slot is being withheld? The
// troubleshooting view is reachable by ANY visitor via ?debug=1 on the public
// booking page, so revealing the 'look_busy' reason there would hand the
// mechanism to the very bookers it is meant to be invisible to. Only an
// authenticated member of the event type's own org gets the reveal; everyone
// else sees exactly what a booker sees.
//
// Deliberately uses the authenticated client, never the service-role client
// this action otherwise runs on — the whole point is to check the caller's own
// identity and membership.
async function canRevealLookBusy(orgId: string): Promise<boolean> {
  try {
    const user = await getUser()
    if (!user) return false
    const authed = await createClient()
    const { data } = await authed
      .from('org_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle()
    return Boolean(data)
  } catch {
    // Never let an auth hiccup fail open into a public reveal.
    return false
  }
}

// ─── Public: get available slots for a date ───────────────────────────────────
// Called server-side from the public booking page (no auth needed).

export async function getAvailableSlots(params: {
  eventTypeId: string
  date: string // 'YYYY-MM-DD'
  bookerTimezone?: string
}): Promise<ActionResult<TimeSlot[]>> {
  const supabase = createServiceRoleClient()

  // Fetch event type
  const { data: et } = await supabase
    .from('event_types')
    .select('*')
    .eq('id', params.eventTypeId)
    .eq('active', true)
    .single()

  if (!et) return { ok: false, error: 'event_type_not_found' }

  const userId = et.user_id
  const orgId = et.org_id

  // Fetch calendar profile for timezone
  const { data: profile } = await supabase
    .from('calendar_profiles')
    .select('timezone, conflict_calendar_ids, look_busy_mode, look_busy_percent, look_busy_max_per_day')
    .eq('user_id', userId)
    .single()

  const timezone = profile?.timezone ?? 'UTC'
  const conflictCalendarIds = profile?.conflict_calendar_ids?.length
    ? profile.conflict_calendar_ids
    : ['primary']

  // Map date string to day of week
  const [year, month, day] = params.date.split('-').map(Number)
  const dateObj = new Date(year, month - 1, day)
  const dow = dateObj.getDay()

  // Fetch availability for that day. Selected as an array (never
  // .maybeSingle()) — a weekday can have 2+ windows since migration 1140, and
  // the look-busy hide-set is keyed on the whole day's grid, so passing only
  // the first window would desync this from resolveAndValidateSlot.
  const { data: avail } = await supabase
    .from('user_availability')
    .select('start_time, end_time')
    .eq('user_id', userId)
    .eq('day_of_week', dow)

  if (!avail || avail.length === 0) return { ok: true, data: [] }

  // Fetch existing bookings for that day (in UTC range)
  const dayStartUtc = fromZonedTime(
    new Date(year, month - 1, day, 0, 0, 0),
    timezone,
  )
  const dayEndUtc = fromZonedTime(
    new Date(year, month - 1, day, 23, 59, 59),
    timezone,
  )

  const { data: existing } = await supabase
    .from('bookings')
    .select('start_at, end_at')
    .eq('event_type_id', params.eventTypeId)
    .eq('status', 'confirmed')
    .gte('start_at', dayStartUtc.toISOString())
    .lte('start_at', dayEndUtc.toISOString())

  const existingBookings = (existing ?? []).map((b) => ({
    start: b.start_at,
    end: b.end_at,
  }))

  // Fetch Google Calendar busy times (optional, fails silently)
  const busyTimes = await fetchBusyTimes(
    userId,
    orgId,
    dayStartUtc.toISOString(),
    dayEndUtc.toISOString(),
    conflictCalendarIds,
  ).catch(() => [])

  const slots = generateSlots({
    date: params.date,
    timezone,
    durationMinutes: et.duration_minutes,
    availability: avail,
    existingBookings,
    busyTimes,
    bufferMinutes: 0,
    minAdvanceMinutes: 60,
    eventTypeId: et.id,
    lookBusy: lookBusyConfigFor(profile ?? {}),
  })

  return { ok: true, data: slots }
}

// ─── Debug: all slots with blocking reasons (troubleshooting view) ──────────

export async function getDebugSlots(params: {
  eventTypeId: string
  date: string
  bookerTimezone?: string
}): Promise<ActionResult<DebugTimeSlot[]>> {
  const supabase = createServiceRoleClient()

  const { data: et } = await supabase
    .from('event_types')
    .select('*')
    .eq('id', params.eventTypeId)
    .eq('active', true)
    .single()

  if (!et) return { ok: false, error: 'event_type_not_found' }

  const userId = et.user_id
  const orgId = et.org_id

  const { data: profile } = await supabase
    .from('calendar_profiles')
    .select('timezone, conflict_calendar_ids, look_busy_mode, look_busy_percent, look_busy_max_per_day')
    .eq('user_id', userId)
    .single()

  const timezone = profile?.timezone ?? 'UTC'
  const conflictCalendarIds = profile?.conflict_calendar_ids?.length
    ? profile.conflict_calendar_ids
    : ['primary']

  const [year, month, day] = params.date.split('-').map(Number)
  const dateObj = new Date(year, month - 1, day)
  const dow = dateObj.getDay()

  // Array, not .maybeSingle() — see the note in getAvailableSlots.
  const { data: avail } = await supabase
    .from('user_availability')
    .select('start_time, end_time')
    .eq('user_id', userId)
    .eq('day_of_week', dow)

  if (!avail || avail.length === 0) return { ok: true, data: [] }

  const dayStartUtc = fromZonedTime(new Date(year, month - 1, day, 0, 0, 0), timezone)
  const dayEndUtc = fromZonedTime(new Date(year, month - 1, day, 23, 59, 59), timezone)

  const { data: existing } = await supabase
    .from('bookings')
    .select('start_at, end_at')
    .eq('event_type_id', params.eventTypeId)
    .eq('status', 'confirmed')
    .gte('start_at', dayStartUtc.toISOString())
    .lte('start_at', dayEndUtc.toISOString())

  const existingBookings = (existing ?? []).map((b) => ({ start: b.start_at, end: b.end_at }))
  const busyTimes = await fetchBusyTimes(userId, orgId, dayStartUtc.toISOString(), dayEndUtc.toISOString(), conflictCalendarIds).catch(() => [])

  const slots = generateSlotsWithReasons({
    date: params.date,
    timezone,
    durationMinutes: et.duration_minutes,
    availability: avail,
    existingBookings,
    busyTimes,
    bufferMinutes: 0,
    minAdvanceMinutes: 60,
    eventTypeId: et.id,
    lookBusy: lookBusyConfigFor(profile ?? {}),
    revealLookBusy: await canRevealLookBusy(orgId),
  })

  return { ok: true, data: slots }
}

// ─── Public: create booking ───────────────────────────────────────────────────

const createBookingSchema = z.object({
  event_type_id: z.string().uuid(),
  start_at: z.string(), // ISO 8601
  booker_name: z.string().min(1).max(100),
  booker_email: z.string().email(),
  booker_phone: z.string().max(30).optional(),
  booker_timezone: z.string().default('UTC'),
  notes: z.string().max(2000).optional(),
  location_kind: z.string().optional(),
})

export type CreateBookingInput = z.input<typeof createBookingSchema>

export async function createBooking(
  input: CreateBookingInput,
): Promise<ActionResult<{ id: string; cancel_token: string }>> {
  const parsed = createBookingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  // Rate limit per (IP, event_type) | 5 bookings per hour. Fails open if
  // Redis is unreachable so we never block legitimate traffic on infra hiccups.
  const ip = await getClientIp()
  const rl = await rateLimit(
    `booking:${ip}:${parsed.data.event_type_id}`,
    5,
    3600,
  )
  if (!rl.allowed) return { ok: false, error: 'rate_limited' }

  const supabase = createServiceRoleClient()

  const resolved = await resolveAndValidateSlot(supabase, {
    eventTypeId: parsed.data.event_type_id,
    startAtIso: parsed.data.start_at,
  })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const { eventType: et, startAt, endAt, hostTimezone } = resolved.data

  // Create or link CRM contact
  let linkedContactId: string | null = null
  try {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', et.org_id)
      .eq('email', parsed.data.booker_email)
      .maybeSingle()

    if (existing) {
      linkedContactId = existing.id
    } else {
      // Build defaults for required custom_field_definitions so the insert
      // does not violate any org-level required-field invariant. If the org
      // has no required custom fields this returns {} and the insert is a no-op.
      const customFieldsDefaults = await buildRequiredCustomFieldDefaults(et.org_id)

      const { data: newContact, error: insertErr } = await supabase
        .from('contacts')
        .insert({
          org_id: et.org_id,
          name: parsed.data.booker_name,
          email: parsed.data.booker_email,
          phone: parsed.data.booker_phone ?? null,
          source: 'manual',
          custom_fields: customFieldsDefaults,
        })
        .select('id')
        .single()
      if (insertErr) {
        // Validation / constraint failure | log + fall back to no link.
        console.warn(
          '[calendar/bookings] contact auto-create failed; booking will proceed without contact link:',
          insertErr.message,
        )
      } else {
        linkedContactId = newContact?.id ?? null
      }
    }
  } catch (err) {
    // CRM link failure is non-fatal | log + proceed.
    console.warn(
      '[calendar/bookings] contact link pipeline failed:',
      err instanceof Error ? err.message : err,
    )
  }

  // Determine the effective location kind:
  // Use the booker's selection if it's one of the allowed kinds; otherwise
  // fall back to the first allowed kind (or the legacy location_type).
  const allowedKinds = (et.allowed_location_kinds ?? []) as string[]
  const effectiveLocationKind: string | null =
    parsed.data.location_kind && allowedKinds.includes(parsed.data.location_kind)
      ? parsed.data.location_kind
      : (allowedKinds[0] ?? et.location_type ?? null)

  const liveContactId = linkedContactId ? await resolveLiveContactId(linkedContactId) : null

  // Insert booking
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      org_id: et.org_id,
      event_type_id: parsed.data.event_type_id,
      booker_name: parsed.data.booker_name,
      booker_email: parsed.data.booker_email,
      booker_phone: parsed.data.booker_phone ?? null,
      booker_timezone: parsed.data.booker_timezone,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      notes: parsed.data.notes ?? null,
      linked_contact_id: liveContactId,
      // The first entry in the shared status vocabulary (booking-status.ts) is 'confirmed' — every new booking starts confirmed (no 'pending' state exists in this system).
      status: BOOKING_STATUSES[0],
      location_kind: effectiveLocationKind,
    })
    .select('id, cancel_token')
    .single()

  if (error || !booking) {
    // 23505 = Postgres unique_violation. The partial unique index
    // idx_bookings_event_slot_unique (migration 072) fires when a concurrent
    // request booked this slot between our pre-SELECT and INSERT.
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return { ok: false, error: 'slot_taken' }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  // Create Google Calendar event (fire-and-forget, non-fatal). Persist the
  // returned event id so future cancel/reschedule propagation has a durable
  // link (SYNC-01) — previously the id was discarded entirely.
  try {
    const { createCalendarEvent } = await import('@/lib/calendar/google-calendar')
    const googleEventId = await createCalendarEvent(et.user_id, et.org_id, {
      summary: `${et.title} with ${parsed.data.booker_name}`,
      description: parsed.data.notes,
      start: startAt.toISOString(),
      end: endAt.toISOString(),
      attendeeEmail: parsed.data.booker_email,
      attendeeName: parsed.data.booker_name,
      location: et.location_value ?? undefined,
      timezone: hostTimezone,
    })
    if (googleEventId) {
      await supabase.from('bookings').update({ google_event_id: googleEventId }).eq('id', booking.id)
    }
  } catch {
    // Non-fatal
  }

  // Google Meet link generation (SYNC-04): when the booker's resolved
  // location kind is google_meet, create a Meet-enabled Calendar event now
  // — before the confirmation email fires — so meeting_url is already on
  // the row when the email pipeline re-fetches it below. Mirrors the same
  // logic that already exists (but is unreachable dead code) in
  // transition.ts::confirmBooking. google_event_id is persisted onto the
  // SAME dedicated bookings.google_event_id column Phase 129 introduces
  // (not location_data) — this intentionally overwrites whatever plain
  // Calendar event id 129's own createCalendarEvent block wrote a few
  // lines above, since the Meet-enabled event is the more relevant one
  // for a google_meet booking.
  if (effectiveLocationKind === 'google_meet') {
    try {
      const { createMeetingLink } = await import('@/lib/calendar/google-calendar')
      const meetResult = await createMeetingLink(et.org_id, {
        title: et.title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        attendeeEmail: parsed.data.booker_email,
      })
      if (meetResult) {
        await supabase
          .from('bookings')
          .update({
            meeting_url: meetResult.meeting_url,
            google_event_id: meetResult.google_event_id,
          })
          .eq('id', booking.id)
      }
    } catch (meetErr) {
      console.warn(
        '[calendar/bookings] Google Meet link creation failed:',
        meetErr instanceof Error ? meetErr.message : meetErr,
      )
    }
  }

  // Booker confirmation email (fire-and-forget, helper never throws).
  // We pass an inline `void` so the action returns immediately; the email
  // helper has its own try/catch that logs and swallows any failure.
  void (async () => {
    const hostName = await resolveHostName(et.user_id)
    const siteUrl = await getSiteOriginFromHeaders()
    const cancelUrl = `${siteUrl}/book/cancel/${booking.id}?token=${booking.cancel_token}`

    // Re-fetch the booking to pick up any meeting_url written by the
    // google_meet flow that runs in the same request.
    const { data: freshBooking } = await supabase
      .from('bookings')
      .select('meeting_url, meeting_phone, location_data')
      .eq('id', booking.id)
      .maybeSingle()

    await sendBookingConfirmation({
      bookerEmail: parsed.data.booker_email,
      bookerName: parsed.data.booker_name,
      hostName,
      eventTitle: et.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      timezone: parsed.data.booker_timezone,
      cancelUrl,
      locationKind: effectiveLocationKind ?? undefined,
      meetingUrl: freshBooking?.meeting_url ?? undefined,
      meetingPhone: freshBooking?.meeting_phone ?? undefined,
      locationAddress: et.location_value ?? undefined,
    })
  })().catch(() => {})

  // Fire-and-forget meeting.scheduled event dispatch.
  void emitCalendarEvent(
    { supabase, depth: 0 },
    {
      event: 'meeting.scheduled',
      booking_id: booking.id,
      org_id: et.org_id,
    } satisfies CalendarEventPayload,
  ).catch(() => {})

  return { ok: true, data: { id: booking.id, cancel_token: booking.cancel_token } }
}

// ─── Internal: operator creates a booking from the dashboard calendar ─────────

const createInternalBookingSchema = z.object({
  event_type_id: z.string().uuid(),
  start_at: z.string(), // ISO 8601
  // Optional duration override (operator dragged a custom slot on the calendar).
  // Falls back to the event type's default duration when omitted.
  duration_minutes: z.number().int().min(5).max(720).optional(),
  booker_name: z.string().min(1).max(100),
  booker_email: z.string().email().optional().or(z.literal('')),
  booker_phone: z.string().max(30).optional().or(z.literal('')),
  booker_timezone: z.string().default('UTC'),
  notes: z.string().max(2000).optional().or(z.literal('')),
  location_kind: z.string().optional(),
  contact_id: z.string().uuid().optional(),
})

export type CreateInternalBookingInput = z.input<typeof createInternalBookingSchema>

/**
 * Operator-facing booking creation (dashboard calendar). Unlike the public
 * `createBooking`, this requires an authenticated user, has no rate limit, and
 * accepts an optional email/contact. Side-effects (Google Calendar event +
 * confirmation email) run only when a booker email is present.
 */
export async function createBookingInternal(
  input: CreateInternalBookingInput,
): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = createInternalBookingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const email = parsed.data.booker_email?.trim() || null
  const phone = parsed.data.booker_phone?.trim() || null
  const notes = parsed.data.notes?.trim() || null

  const supabase = createServiceRoleClient()

  const { data: et } = await supabase
    .from('event_types')
    .select('duration_minutes, org_id, user_id, title, location_type, location_value, allowed_location_kinds')
    .eq('id', parsed.data.event_type_id)
    .eq('active', true)
    .single()

  if (!et) return { ok: false, error: 'event_type_not_found' }

  // Scope the booking to the operator's active org.
  const { data: orgId } = await (await createClient()).rpc('get_current_org_id')
  if (orgId && et.org_id !== orgId) return { ok: false, error: 'forbidden' }

  const { data: hostProfile } = await supabase
    .from('calendar_profiles')
    .select('timezone')
    .eq('user_id', et.user_id)
    .maybeSingle()
  const hostTimezone = hostProfile?.timezone ?? 'UTC'

  const startAt = new Date(parsed.data.start_at)
  const durationMinutes =
    parsed.data.duration_minutes && parsed.data.duration_minutes > 0
      ? parsed.data.duration_minutes
      : et.duration_minutes
  const endAt = addMinutes(startAt, durationMinutes)

  // Race-condition guard.
  const { data: conflict } = await supabase
    .from('bookings')
    .select('id')
    .eq('event_type_id', parsed.data.event_type_id)
    .eq('status', 'confirmed')
    .lt('start_at', endAt.toISOString())
    .gt('end_at', startAt.toISOString())
    .maybeSingle()
  if (conflict) return { ok: false, error: 'slot_taken' }

  // Resolve / link contact: prefer the explicit contact_id, else match by email.
  let linkedContactId: string | null = null
  if (parsed.data.contact_id) {
    linkedContactId = parsed.data.contact_id
  } else if (email) {
    try {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', et.org_id)
        .eq('email', email)
        .maybeSingle()
      if (existing) {
        linkedContactId = existing.id
      } else {
        const customFieldsDefaults = await buildRequiredCustomFieldDefaults(et.org_id)
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            org_id: et.org_id,
            name: parsed.data.booker_name,
            email,
            phone,
            source: 'manual',
            custom_fields: customFieldsDefaults,
          })
          .select('id')
          .single()
        linkedContactId = newContact?.id ?? null
      }
    } catch {
      /* non-fatal */
    }
  }

  const allowedKinds = (et.allowed_location_kinds ?? []) as string[]
  const effectiveLocationKind: string | null =
    parsed.data.location_kind && allowedKinds.includes(parsed.data.location_kind)
      ? parsed.data.location_kind
      : (allowedKinds[0] ?? et.location_type ?? null)

  const liveContactId = linkedContactId ? await resolveLiveContactId(linkedContactId) : null

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      org_id: et.org_id,
      event_type_id: parsed.data.event_type_id,
      booker_name: parsed.data.booker_name,
      booker_email: email ?? '',
      booker_phone: phone,
      booker_timezone: parsed.data.booker_timezone,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      notes,
      linked_contact_id: liveContactId,
      // The first entry in the shared status vocabulary (booking-status.ts) is 'confirmed' — every new booking starts confirmed (no 'pending' state exists in this system).
      status: BOOKING_STATUSES[0],
      location_kind: effectiveLocationKind,
    })
    .select('id, cancel_token')
    .single()

  if (error || !booking) {
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return { ok: false, error: 'slot_taken' }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  // Google Meet link generation (SYNC-04): applies regardless of whether a
  // booker email was provided — it's about the location kind, not the
  // notification path below (which is gated on `email`). google_event_id is
  // persisted onto the SAME dedicated bookings.google_event_id column Phase
  // 129 introduces (not location_data).
  if (effectiveLocationKind === 'google_meet') {
    try {
      const { createMeetingLink } = await import('@/lib/calendar/google-calendar')
      const meetResult = await createMeetingLink(et.org_id, {
        title: et.title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        attendeeEmail: email ?? undefined,
      })
      if (meetResult) {
        await supabase
          .from('bookings')
          .update({
            meeting_url: meetResult.meeting_url,
            google_event_id: meetResult.google_event_id,
          })
          .eq('id', booking.id)
      }
    } catch (meetErr) {
      console.warn(
        '[calendar/bookings] Google Meet link creation failed:',
        meetErr instanceof Error ? meetErr.message : meetErr,
      )
    }
  }

  // Side-effects only when we have a booker email (GCal attendee + email need it).
  if (email) {
    try {
      const { createCalendarEvent } = await import('@/lib/calendar/google-calendar')
      const googleEventId = await createCalendarEvent(et.user_id, et.org_id, {
        summary: `${et.title} with ${parsed.data.booker_name}`,
        description: notes ?? undefined,
        start: startAt.toISOString(),
        end: endAt.toISOString(),
        attendeeEmail: email,
        attendeeName: parsed.data.booker_name,
        location: et.location_value ?? undefined,
        timezone: hostTimezone,
      })
      if (googleEventId) {
        await supabase.from('bookings').update({ google_event_id: googleEventId }).eq('id', booking.id)
      }
    } catch {
      /* non-fatal */
    }

    void (async () => {
      const hostName = await resolveHostName(et.user_id)
      const siteUrl = await getSiteOriginFromHeaders()
      const cancelUrl = `${siteUrl}/book/cancel/${booking.id}?token=${booking.cancel_token}`
      const { data: freshBooking } = await supabase
        .from('bookings')
        .select('meeting_url, meeting_phone, location_data')
        .eq('id', booking.id)
        .maybeSingle()
      await sendBookingConfirmation({
        bookerEmail: email,
        bookerName: parsed.data.booker_name,
        hostName,
        eventTitle: et.title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timezone: parsed.data.booker_timezone,
        cancelUrl,
        locationKind: effectiveLocationKind ?? undefined,
        meetingUrl: freshBooking?.meeting_url ?? undefined,
        meetingPhone: freshBooking?.meeting_phone ?? undefined,
        locationAddress: et.location_value ?? undefined,
      })
    })().catch(() => {})
  }

  void emitCalendarEvent(
    { supabase, depth: 0 },
    {
      event: 'meeting.scheduled',
      booking_id: booking.id,
      org_id: et.org_id,
    } satisfies CalendarEventPayload,
  ).catch(() => {})

  revalidatePath('/calendar/calendar')
  return { ok: true, data: { id: booking.id } }
}

// ─── Public: cancel via token ─────────────────────────────────────────────────

export async function cancelBookingByToken(
  bookingId: string,
  cancelToken: string,
): Promise<ActionResult<void>> {
  const supabase = createServiceRoleClient()

  // Token verification happens here, read-only, BEFORE any mutation attempt
  // -- an invalid token or already-cancelled booking never reaches the
  // canonical transition service at all.
  const { data, error } = await supabase
    .from('bookings')
    .select('id, org_id')
    .eq('id', bookingId)
    .eq('cancel_token', cancelToken)
    .eq('status', 'confirmed')
    .single()

  if (error || !data) return { ok: false, error: 'not_found_or_already_cancelled' }

  const result = await transitionCancelBooking({ supabase, depth: 0 }, bookingId, data.org_id)
  if (!result.ok) return { ok: false, error: 'not_found_or_already_cancelled' }

  void sendCancellationEmailForBooking(bookingId).catch(() => {})

  return { ok: true, data: undefined }
}
