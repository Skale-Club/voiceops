// Slot generation engine for the calendar system.
// Given user availability + existing bookings + Google Calendar busy times,
// returns available time slots for a specific date.
//
// A day can have MORE THAN ONE availability window (migration 1140 dropped the
// one-window-per-weekday constraint), so `availability` is an array and the
// candidate grid is the concatenation of every window's grid. Callers must pass
// all windows for the weekday — passing only the first desynchronises this file
// from booking-validation.ts, which always reads them all.

import {
  addMinutes,
  format,
  parseISO,
  isBefore,
  isAfter,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import {
  computeHiddenSlotStarts,
  isLookBusyActive,
  LOOK_BUSY_OFF,
  type LookBusyConfig,
} from './look-busy'

export interface TimeSlot {
  start: string // ISO 8601 UTC
  end: string   // ISO 8601 UTC
  startLocal: string // HH:mm in user's timezone
  endLocal: string
}

export interface BusyInterval {
  start: string
  end: string
}

export interface AvailabilityWindow {
  start_time: string // 'HH:mm:ss' or 'HH:mm'
  end_time: string
}

// Check if two intervals overlap.
function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return isBefore(aStart, bEnd) && isAfter(aEnd, bStart)
}

// Parse 'HH:mm:ss' or 'HH:mm' into [hours, minutes].
function parseTime(timeStr: string): [number, number] {
  const parts = timeStr.split(':')
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)]
}

interface Candidate {
  start: Date
  end: Date
}

// Every slot position the day's availability windows produce, chronological and
// de-duplicated. This is the grid the look-busy hide-set is computed over, so
// it must be derived from availability alone — never from what's still free.
export function buildCandidateGrid(params: {
  date: string
  timezone: string
  durationMinutes: number
  availability: AvailabilityWindow[] | null
  bufferMinutes?: number
}): Candidate[] {
  const { date, timezone, durationMinutes, availability, bufferMinutes = 0 } = params
  if (!availability || availability.length === 0) return []

  const stepMinutes = durationMinutes + bufferMinutes
  const localDate = parseISO(date) // interpreted as local date
  const seen = new Set<number>()
  const candidates: Candidate[] = []

  for (const window of availability) {
    const [startH, startM] = parseTime(window.start_time)
    const [endH, endM] = parseTime(window.end_time)

    // Build window start and end in the host's local timezone
    const windowStartLocal = setMilliseconds(
      setSeconds(setMinutes(setHours(localDate, startH), startM), 0),
      0,
    )
    const windowEndLocal = setMilliseconds(
      setSeconds(setMinutes(setHours(localDate, endH), endM), 0),
      0,
    )

    // Convert to UTC
    const windowStartUtc = fromZonedTime(windowStartLocal, timezone)
    const windowEndUtc = fromZonedTime(windowEndLocal, timezone)

    let cursor = windowStartUtc
    while (
      isBefore(addMinutes(cursor, durationMinutes), windowEndUtc) ||
      addMinutes(cursor, durationMinutes).getTime() === windowEndUtc.getTime()
    ) {
      const start = cursor
      const end = addMinutes(cursor, durationMinutes)
      // Overlapping windows would otherwise emit the same position twice.
      if (!seen.has(start.getTime())) {
        seen.add(start.getTime())
        candidates.push({ start, end })
      }
      cursor = addMinutes(cursor, stepMinutes)
    }
  }

  // Windows arrive in whatever order the query returned them.
  candidates.sort((a, b) => a.start.getTime() - b.start.getTime())
  return candidates
}

function toTimeSlot(candidate: Candidate, timezone: string): TimeSlot {
  const startLocal = toZonedTime(candidate.start, timezone)
  const endLocal = toZonedTime(candidate.end, timezone)
  return {
    start: candidate.start.toISOString(),
    end: candidate.end.toISOString(),
    startLocal: format(startLocal, 'HH:mm'),
    endLocal: format(endLocal, 'HH:mm'),
  }
}

// Resolve which candidate starts are withheld by look-busy. Returns an empty
// set unless the event type has it configured AND the caller supplied the id
// the hash is keyed on.
function resolveHiddenStarts(params: {
  date: string
  candidates: Candidate[]
  eventTypeId?: string
  lookBusy?: LookBusyConfig
}): Set<string> {
  const { date, candidates, eventTypeId, lookBusy } = params
  const config = lookBusy ?? LOOK_BUSY_OFF
  if (!eventTypeId || !isLookBusyActive(config)) return new Set<string>()
  return computeHiddenSlotStarts({
    eventTypeId,
    date,
    gridStarts: candidates.map((c) => c.start.toISOString()),
    config,
  })
}

// Generate available slots for a given date.
// All times are handled in the host's timezone (availability is defined in that timezone).
export function generateSlots(params: {
  date: string        // 'YYYY-MM-DD' | the date to generate slots for
  timezone: string    // IANA timezone of the host (e.g. 'America/Sao_Paulo')
  durationMinutes: number
  availability: AvailabilityWindow[] | null  // null/empty = no availability this day
  existingBookings: BusyInterval[]  // confirmed bookings (UTC ISO strings)
  busyTimes: BusyInterval[]         // Google Calendar busy times (UTC ISO strings)
  bufferMinutes?: number            // buffer between slots (default 0)
  minAdvanceMinutes?: number        // min advance notice (default 60)
  eventTypeId?: string              // required for look-busy (hash key)
  lookBusy?: LookBusyConfig         // default: off
}): TimeSlot[] {
  const {
    date,
    timezone,
    durationMinutes,
    availability,
    existingBookings,
    busyTimes,
    bufferMinutes = 0,
    minAdvanceMinutes = 60,
    eventTypeId,
    lookBusy,
  } = params

  const candidates = buildCandidateGrid({
    date,
    timezone,
    durationMinutes,
    availability,
    bufferMinutes,
  })
  if (candidates.length === 0) return []

  const hidden = resolveHiddenStarts({ date, candidates, eventTypeId, lookBusy })

  // All busy intervals merged
  const allBusy: BusyInterval[] = [...existingBookings, ...busyTimes]
  const now = new Date()
  const minAdvanceCutoff = addMinutes(now, minAdvanceMinutes)

  const slots: TimeSlot[] = []

  for (const candidate of candidates) {
    const { start: slotStart, end: slotEnd } = candidate

    // Skip slots that are too soon
    if (isBefore(slotStart, minAdvanceCutoff)) continue

    // Skip slots withheld by look-busy
    if (hidden.has(slotStart.toISOString())) continue

    // Skip if overlaps any busy interval
    const blocked = allBusy.some((busy) => {
      const bStart = parseISO(busy.start)
      const bEnd = parseISO(busy.end)
      return overlaps(slotStart, slotEnd, bStart, bEnd)
    })

    if (!blocked) slots.push(toTimeSlot(candidate, timezone))
  }

  return slots
}

// ── Debug / troubleshooting types ────────────────────────────────────────────

export type SlotBlockReason = 'past' | 'booked' | 'google_busy' | 'look_busy'

export interface DebugTimeSlot extends TimeSlot {
  available: boolean
  reason?: SlotBlockReason
}

// Like generateSlots but returns ALL candidate slots (available + blocked),
// each tagged with the reason it was blocked. Used by the troubleshooting view.
//
// `revealLookBusy` gates the one reason that must not be public: the
// troubleshooting view is reachable by anyone via ?debug=1 on the public
// booking page, so only an authenticated member of the event type's org may
// see that a free slot is being withheld. With it false, withheld slots are
// dropped outright and the output matches generateSlots exactly.
export function generateSlotsWithReasons(params: {
  date: string
  timezone: string
  durationMinutes: number
  availability: AvailabilityWindow[] | null
  existingBookings: BusyInterval[]
  busyTimes: BusyInterval[]
  bufferMinutes?: number
  minAdvanceMinutes?: number
  eventTypeId?: string
  lookBusy?: LookBusyConfig
  revealLookBusy?: boolean
}): DebugTimeSlot[] {
  const {
    date,
    timezone,
    durationMinutes,
    availability,
    existingBookings,
    busyTimes,
    bufferMinutes = 0,
    minAdvanceMinutes = 60,
    eventTypeId,
    lookBusy,
    revealLookBusy = false,
  } = params

  const candidates = buildCandidateGrid({
    date,
    timezone,
    durationMinutes,
    availability,
    bufferMinutes,
  })
  if (candidates.length === 0) return []

  const hidden = resolveHiddenStarts({ date, candidates, eventTypeId, lookBusy })

  const now = new Date()
  const minAdvanceCutoff = addMinutes(now, minAdvanceMinutes)

  const slots: DebugTimeSlot[] = []

  for (const candidate of candidates) {
    const { start: slotStart, end: slotEnd } = candidate
    const base = toTimeSlot(candidate, timezone)

    if (isBefore(slotStart, minAdvanceCutoff)) {
      slots.push({ ...base, available: false, reason: 'past' })
      continue
    }

    if (hidden.has(slotStart.toISOString())) {
      if (revealLookBusy) {
        slots.push({ ...base, available: false, reason: 'look_busy' })
      }
      continue
    }

    // Check bookings first, then Google Calendar
    const bookedBy = existingBookings.find((b) =>
      overlaps(slotStart, slotEnd, parseISO(b.start), parseISO(b.end)),
    )
    if (bookedBy) {
      slots.push({ ...base, available: false, reason: 'booked' })
      continue
    }

    const gcalBusy = busyTimes.find((b) =>
      overlaps(slotStart, slotEnd, parseISO(b.start), parseISO(b.end)),
    )
    if (gcalBusy) {
      slots.push({ ...base, available: false, reason: 'google_busy' })
      continue
    }

    slots.push({ ...base, available: true })
  }

  return slots
}

// Get which days of the month have availability (for date picker highlighting).
export function getDaysWithAvailability(
  year: number,
  month: number, // 0-indexed
  availableDays: number[], // day_of_week 0-6 that have availability set
  timezone: string,
): string[] {
  const dates: string[] = []
  const now = new Date()

  // Iterate all days of the month
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const dow = date.getDay()
    if (availableDays.includes(dow) && isAfter(date, now)) {
      dates.push(format(date, 'yyyy-MM-dd'))
    }
  }

  return dates
}
