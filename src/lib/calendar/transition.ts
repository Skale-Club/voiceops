// SEED-027 Phase B: one-path booking status transitions.
//
// Every booking mutation (create / confirm / cancel / reschedule / no_show /
// complete) flows through this module. Each transition:
//   1. Updates the bookings row in a transaction
//   2. Records an event_dispatches audit row capturing the transition
//   3. Enqueues matching workflows (lookup by trigger_type='event' and
//      trigger_config.event matches)
//
// The actual workflow enqueue is delegated to runWorkflow (SEED-025 Phase B
// runner). Phase C of SEED-027 adds the tick scheduler for time-based events.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { CalendarEvent, CalendarEventPayload } from '@/lib/calendar/events'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { buildMeetingScope, buildMeetingScopeFromData } from '@/lib/calendar/scope'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { resumeMatchingWaits } from '@/lib/flows/resume-waits'
import type { BookingStatus } from '@/lib/calendar/booking-status'

interface TransitionContext {
  supabase: SupabaseClient<Database>
  // depth+parent_id let us detect runaway cascades (workflow → booking
  // creation → meeting.scheduled → another workflow → ...)
  parentDispatchId?: string | null
  depth?: number
}

const MAX_CASCADE_DEPTH = 3

async function recordDispatch(
  ctx: TransitionContext,
  orgId: string,
  event: CalendarEvent,
  sourceId: string,
  payload: Json,
  workflowIds: string[],
): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('event_dispatches')
    .insert({
      org_id: orgId,
      event_type: event,
      source_table: 'bookings',
      source_id: sourceId,
      workflow_ids: workflowIds,
      payload,
      parent_id: ctx.parentDispatchId ?? null,
      depth: ctx.depth ?? 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[calendar/transition] dispatch record error:', error.message)
    return null
  }
  return (data as { id: string }).id
}

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  event: CalendarEvent,
): Promise<MatchedWorkflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, current_version_id')
    .eq('org_id', orgId)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event })

  if (error || !data) return []
  return (data as MatchedWorkflow[]).map((r) => ({
    id: r.id,
    current_version_id: r.current_version_id ?? null,
  }))
}

// Public API ------------------------------------------------------------------

export async function emitCalendarEvent(
  ctx: TransitionContext,
  payload: CalendarEventPayload,
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  if ((ctx.depth ?? 0) > MAX_CASCADE_DEPTH) {
    console.warn(
      '[calendar/transition] cascade depth limit hit',
      payload.event,
      payload.booking_id,
    )
    return { dispatched: 0, dispatch_id: null }
  }

  const matched = await findMatchingWorkflows(ctx.supabase, payload.org_id, payload.event)
  // meeting.requested has no `bookings` row (see CalendarEventPayload's
  // comment) -- event_dispatches.source_id is NOT NULL but carries no FK to
  // bookings, so a synthetic id it never wrote a row for is safe to record.
  const sourceId = payload.booking_id ?? crypto.randomUUID()
  const dispatch_id = await recordDispatch(
    ctx,
    payload.org_id,
    payload.event,
    sourceId,
    payload as unknown as Json,
    matched.map((m) => m.id),
  )

  // Build the meeting scope for workflow variable interpolation + wait
  // correlation. Built unconditionally (even with no trigger matches) because a
  // run may be *waiting* for this event without any workflow being triggered by it.
  const scope = payload.booking_id
    ? await buildMeetingScope(ctx.supabase, payload.booking_id, {
        rescheduled_from: payload.rescheduled_from,
        rescheduled_to: payload.rescheduled_to,
      })
    : payload.requested
      ? await buildMeetingScopeFromData(ctx.supabase, payload.org_id, sourceId, {
          booker_name: payload.requested.booker_name,
          booker_email: payload.requested.booker_email,
          booker_phone: payload.requested.booker_phone,
          start_at: payload.requested.start_at,
          end_at: payload.requested.end_at,
          event_type_id: payload.requested.event_type_id,
          linked_contact_id: payload.requested.linked_contact_id,
        })
      : null
  if (!scope) {
    return { dispatched: 0, dispatch_id }
  }

  const triggerInput: Record<string, unknown> = {
    meeting: scope,
    event: payload.event,
  }

  // Resume any runs suspended on a wait node that this event satisfies,
  // correlated to the meeting's contact. Independent of trigger matches.
  void resumeMatchingWaits(ctx.supabase, {
    orgId: payload.org_id,
    eventType: payload.event,
    contactId: scope.attendee_contact?.id ?? null,
    payload: triggerInput,
  }).catch((err) => {
    console.error('[calendar/transition] resumeMatchingWaits error:', err)
  })

  if (matched.length === 0) {
    return { dispatched: 0, dispatch_id }
  }

  // Load each matched workflow's current definition.
  const versionIds = matched
    .map((m) => m.current_version_id)
    .filter((id): id is string => Boolean(id))

  if (versionIds.length === 0) {
    return { dispatched: 0, dispatch_id }
  }

  const { data: versions } = await ctx.supabase
    .from('workflow_versions')
    .select('id, definition')
    .in('id', versionIds)

  const defById = new Map<string, unknown>()
  for (const v of versions ?? []) {
    defById.set(v.id as string, v.definition)
  }

  // Fire-and-forget each matched workflow. A failing workflow does not
  // block the event or the originating booking mutation.
  for (const wf of matched) {
    const definition = wf.current_version_id
      ? defById.get(wf.current_version_id)
      : null
    if (!definition) continue
    // Flows containing a wait node run through the persistent engine (supports
    // suspend/resume). Everything else stays on the lightweight sync runner.
    if (definitionHasWait(definition)) {
      void runFlow({
        workflowId: wf.id,
        versionId: wf.current_version_id ?? null,
        definition: definition as FlowDefinition,
        orgId: payload.org_id,
        triggerType: 'event',
        triggerPayload: triggerInput,
        supabase: ctx.supabase,
      }).catch((err) => {
        console.error('[calendar/transition] runFlow error:', err)
      })
    } else {
      void runFlowSync({
        workflowId: wf.id,
        definition,
        triggerInput,
        context: { orgId: payload.org_id },
      }).catch((err) => {
        console.error('[calendar/transition] runFlowSync error:', err)
      })
    }
  }

  return { dispatched: matched.length, dispatch_id }
}

// ─── Transition core ────────────────────────────────────────────────────────
//
// State machine (LIFE-02): confirmed is the only non-terminal state. Every
// real (non-idempotent) transition below originates FROM 'confirmed'.
// cancelled/no_show/showed are terminal -- re-requesting the SAME status is
// an idempotent no-op (closes the double-fire bug the old dashboard
// cancelBooking had); requesting a DIFFERENT status from a terminal state is
// illegal_transition, never a silent no-op that still emits (D-02).
//
// Every guarded function below requires an explicit orgId and verifies it
// via the RPC (migration 1251) before mutating -- these functions are always
// called with a SERVICE ROLE client (bypasses bookings' per-request RLS), so
// the tenant boundary is re-checked server-side inside the RPC itself rather
// than relied upon from RLS. This also closes a real pre-Phase-127 gap: the
// old flows/engine.ts booking_* action handlers took a bare booking_id from
// workflow config with NO org check at all.

interface TransitionRpcResult {
  transitioned: boolean
  old_status: BookingStatus
  new_status: BookingStatus
}

async function runStatusTransition(
  ctx: TransitionContext,
  bookingId: string,
  orgId: string,
  newStatus: BookingStatus,
  allowedFrom: BookingStatus[],
): Promise<{ ok: true; transitioned: boolean } | { ok: false; error: string }> {
  const { data, error } = await ctx.supabase.rpc('transition_booking_status', {
    p_booking_id: bookingId,
    p_org_id: orgId,
    p_new_status: newStatus,
    p_allowed_from: allowedFrom,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('booking_not_found')) return { ok: false, error: 'booking_not_found' }
    if (msg.includes('illegal_transition')) return { ok: false, error: 'illegal_transition' }
    return { ok: false, error: msg || 'transition_failed' }
  }

  const result = data as unknown as TransitionRpcResult
  return { ok: true, transitioned: result.transitioned }
}

// Note: in production, bookings are born with status 'confirmed' (see
// executeBookingCreate and the public booking flow) -- there is no writer
// that creates a booking in a state confirmBooking would legally transition
// FROM. confirmBooking is therefore structurally idempotent-or-illegal
// today: a real 'confirmed'->'confirmed' call always short-circuits at the
// `!result.transitioned` branch below and never reaches the
// emitCalendarEvent('meeting.confirmed', ...) call in production traffic.
// This is intentional, not a dead branch to "fix" -- the guard stays in
// place so a future writer that legitimately introduces a pre-confirmation
// state (e.g. a 'pending' hold) has a safe transition to call into.
export async function confirmBooking(
  ctx: TransitionContext,
  bookingId: string,
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await runStatusTransition(ctx, bookingId, orgId, 'confirmed', ['confirmed'])
  if (!result.ok) return result
  if (!result.transitioned) return { ok: true } // idempotent, no re-emit

  // Optional Google Meet link creation -- best-effort. Failure here does not
  // roll back the already-committed status transition, nor block the
  // meeting.confirmed emission below.
  try {
    const { data: booking } = await ctx.supabase
      .from('bookings')
      .select('location_kind, event_type_id, start_at, end_at, booker_email, meeting_url')
      .eq('id', bookingId)
      .maybeSingle()

    if (booking?.location_kind === 'google_meet' && !booking.meeting_url) {
      const { data: et } = await ctx.supabase
        .from('event_types')
        .select('title')
        .eq('id', booking.event_type_id as string)
        .maybeSingle()

      const { createMeetingLink } = await import('@/lib/calendar/google-calendar')
      const meetResult = await createMeetingLink(orgId, {
        title: et?.title ?? 'Meeting',
        startAt: booking.start_at as string,
        endAt: booking.end_at as string,
        attendeeEmail: (booking.booker_email as string | null) ?? undefined,
      })
      if (meetResult) {
        await ctx.supabase
          .from('bookings')
          .update({
            meeting_url: meetResult.meeting_url,
            location_data: { google_event_id: meetResult.google_event_id },
          })
          .eq('id', bookingId)
      }
    }
  } catch (meetErr) {
    console.warn(
      '[calendar/transition] Google Meet link creation failed:',
      meetErr instanceof Error ? meetErr.message : meetErr,
    )
  }

  await emitCalendarEvent(ctx, { event: 'meeting.confirmed', booking_id: bookingId, org_id: orgId })
  return { ok: true }
}

export async function cancelBooking(
  ctx: TransitionContext,
  bookingId: string,
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await runStatusTransition(ctx, bookingId, orgId, 'cancelled', ['confirmed'])
  if (!result.ok) return result
  if (!result.transitioned) return { ok: true }
  await emitCalendarEvent(ctx, { event: 'meeting.cancelled', booking_id: bookingId, org_id: orgId })
  return { ok: true }
}

export async function markNoShow(
  ctx: TransitionContext,
  bookingId: string,
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await runStatusTransition(ctx, bookingId, orgId, 'no_show', ['confirmed'])
  if (!result.ok) return result
  if (!result.transitioned) return { ok: true }
  await emitCalendarEvent(ctx, { event: 'meeting.no_show', booking_id: bookingId, org_id: orgId })
  return { ok: true }
}

// LIFE-02: the DB's only attendance/completion value is 'showed' -- there is
// no 'completed' DB status. The workflow-facing event name stays
// 'meeting.completed' (src/lib/calendar/events.ts, src/lib/workflows/spec.ts,
// and the skleanings-post-service-review.yaml seed already document/consume
// this name). This is the transition src/lib/flows/engine.ts's
// booking_mark_complete action node calls (Plan 127-06) instead of its old
// write of an invalid literal status value ("completed" — never a valid
// DB status — cast away via `as 'confirmed'` to silence the compiler).
export async function markShowed(
  ctx: TransitionContext,
  bookingId: string,
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await runStatusTransition(ctx, bookingId, orgId, 'showed', ['confirmed'])
  if (!result.ok) return result
  if (!result.transitioned) return { ok: true }
  await emitCalendarEvent(ctx, { event: 'meeting.completed', booking_id: bookingId, org_id: orgId })
  return { ok: true }
}

// Does not change status -- not routed through transition_booking_status.
// Mirrors cancelBookingByToken's existing safe SELECT + guarded
// UPDATE...WHERE status='confirmed' pattern (src/app/(dashboard)/calendar/
// _actions/bookings.ts).
export async function rescheduleBooking(
  ctx: TransitionContext,
  bookingId: string,
  orgId: string,
  newStartAt: string,
  newEndAt: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: booking, error } = await ctx.supabase
    .from('bookings')
    .select('id, org_id, status, start_at')
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, error: 'booking_not_found' }
  if (booking.org_id !== orgId) return { ok: false, error: 'booking_not_found' }
  if (booking.status !== 'confirmed') return { ok: false, error: 'illegal_transition' }

  const oldStart = booking.start_at as string

  const { data: updated, error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ start_at: newStartAt, end_at: newEndAt, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .select('id')
    .single()

  if (updateErr || !updated) return { ok: false, error: 'illegal_transition' }

  await emitCalendarEvent(ctx, {
    event: 'meeting.rescheduled',
    booking_id: bookingId,
    org_id: orgId,
    rescheduled_from: oldStart,
    rescheduled_to: newStartAt,
  })

  return { ok: true }
}
