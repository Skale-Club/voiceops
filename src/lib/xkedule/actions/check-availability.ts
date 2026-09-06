// src/lib/xkedule/actions/check-availability.ts
// GET /api/v1/availability — open slots. Duration is derived by Xkedule from
// the serviceIds, so the AI only needs the date(s) + service(s).
//
// Two shapes, because a caller asks two different questions:
//   • `date`                     → "what's open on Thursday?"
//   • `startDate` + `endDate`    → "when's your next opening?" (AGT-05)
// The range shape existed on Xkedule from the start; this action used to
// hard-require `date`, so an agent asked "when can you fit me in?" had no way
// to ask it and instead guessed one day at a time — dead air on a phone call
// and a wrong guess most times.
//
// `includeStaff` (AGT-06) adds per-slot attribution so "who's free at 3?" is
// one call instead of one call per staff member.
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'
import { fetchXkeduleAvailabilityCached } from '../availability-cache'
import { isBusinessOpenOn } from './business-info'
import { getXkeduleCatalog } from './get-services'

interface AvailabilityParams {
  date?: string
  startDate?: string
  endDate?: string
  serviceId?: number | string
  serviceIds?: Array<number | string> | string
  staffId?: number | string
  staffMemberId?: number | string
  includeStaff?: boolean | string
}

interface Slot {
  time: string
  available: boolean
  /** Present only when includeStaff was requested. */
  staffIds?: number[]
}

interface SlotsResponse {
  slots: Slot[]
  staff?: { id: number; name: string }[]
}

interface RangeResponse {
  range: Record<string, { time: string; available: boolean }[]>
  nextAvailable: { date: string; time: string } | null
}

function normalizeServiceIds(p: AvailabilityParams): number[] {
  const raw = p.serviceIds
    ? Array.isArray(p.serviceIds)
      ? p.serviceIds
      : String(p.serviceIds).split(',')
    : p.serviceId != null
      ? [p.serviceId]
      : []
  return raw.map((x) => Number(x)).filter(Boolean)
}

function isTruthy(value: boolean | string | undefined): boolean {
  return value === true || value === 'true' || value === '1'
}

// The engine used to hand the model raw 24h "09:45", which the voice model
// then read back digit-by-digit ("oh nine forty-five") -- see
// .planning/workstreams/omnichannel-agent-orchestration/VOICE-CALL-4-PLAN.md
// item B. Every slot the model ever sees now leaves this module already in
// the shape a person says out loud: 12-hour, no leading zero, uppercase
// AM/PM. Another agent parses these lines server-side (voice-call-replay,
// clock-choice), so the exact shape below is a contract: "h:mm AM/PM",
// comma-separated, never "and"-joined.

/** "09:45" / "9:45" (24h, zero-padded or not) -> "9:45 AM". Anything that
 * doesn't look like a time is returned unchanged rather than thrown away. */
function spokenTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!m) return time
  const minute = m[2]
  let hour = Number(m[1]) % 24
  const period = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12
  if (hour === 0) hour = 12
  return `${hour}:${minute} ${period}`
}

/** "9:00 AM, 9:45 AM, 10:30 AM" — plain comma-separated, never "and"-joined
 * (see the contract note above: a server-side parser splits on ", "). */
function spokenTimes(times: string[]): string {
  return times.map(spokenTime).join(', ')
}

/** Keep the full server-verified slot set available for a requested time, but
 * make three representative early/middle/late options unmistakable. */
function singleDayAvailability(date: string, times: string[]): string {
  if (times.length <= 3) return `Available times on ${date}: ${spokenTimes(times)}`
  const offeredIndexes = new Set([0, Math.floor((times.length - 1) / 2), times.length - 1])
  const offered = times.filter((_, index) => offeredIndexes.has(index))
  const others = times.filter((_, index) => !offeredIndexes.has(index))
  return `Available times on ${date}: OFFER ONLY these three: ${spokenTimes(offered)}\n`
    + `Other valid times (do not read unless the caller asks for one): ${spokenTimes(others)}`
}

/** "Saturday" for "2026-09-12", read as a calendar date (UTC) so the weekday
 * never shifts with the process's local timezone. */
function weekdayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(parsed)
}

export async function checkXkeduleAvailability(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  let p = params as AvailabilityParams

  const ids = normalizeServiceIds(p)
  if (ids.length === 0) {
    return 'Please provide a serviceId to check availability.'
  }
  const serviceIds = ids.join(',')
  const rawStaffId = Number(p.staffId ?? p.staffMemberId)
  const staffId = Number.isInteger(rawStaffId) && rawStaffId > 0 ? rawStaffId : undefined

  // ── Range shape: "when is the next opening?" ────────────────────────────────
  // A one-day "range" (startDate === endDate, or no endDate) is a single-date
  // question asked with the other field names. Fold it into the single-date
  // path so it hits the cache a quote just pre-warmed; the range path is
  // uncached by design and was costing the widget's day turn the provider's
  // full cold cost twice (measured 2026-09-05: 12.8s + 13.0s in one turn).
  //
  // `p.startDate`/`p.endDate` empty strings ("", the shape the model sends
  // when `date` is what it actually means to answer) are falsy in JS, so
  // both `!p.date` guards above and the `p.startDate` checks here already
  // treat "" exactly like undefined -- no separate empty-string branch
  // needed, but see tests/xkedule-availability-cache.test.ts for coverage
  // pinning this so it can't regress silently.
  if (!p.date && p.startDate && (!p.endDate || p.endDate === p.startDate)) {
    p = { ...p, date: p.startDate }
  }

  if (!p.date && p.startDate && p.endDate) {
    const query = new URLSearchParams({ startDate: p.startDate, endDate: p.endDate, serviceIds })
    if (staffId) query.set('staffId', String(Number(staffId)))

    const data = await xkeduleFetchJson<RangeResponse>(
      `/api/v1/availability?${query.toString()}`,
      'GET',
      null,
      credentials,
    )

    const allDays = Object.entries(data.range ?? {})
      .map(([date, slots]) => [date, (slots ?? []).filter((s) => s.available).map((s) => s.time)] as const)
      .filter(([, times]) => times.length > 0)

    if (allDays.length === 0) {
      return `No availability between ${p.startDate} and ${p.endDate}.`
    }

    // Cap to the first 3 days that actually have openings: the model needs
    // enough to offer a choice, not a wall of a fortnight of days, and the
    // days are already in date order from the provider.
    const days = allDays.slice(0, 3)

    // Cap the per-day time list too, same reasoning, one level down.
    const summary = days
      .map(([date, times]) => {
        const shown = times.slice(0, 6)
        const more = times.length > shown.length ? ` (+${times.length - shown.length} more)` : ''
        return `${date} (${weekdayOf(date)}): ${spokenTimes(shown)}${more}`
      })
      .join('\n')

    return `Next openings from ${p.startDate}:\n${summary}`
  }

  // ── Single-date shape ──────────────────────────────────────────────────────
  const date = p.date
  if (!date) {
    return 'Please provide either a date (YYYY-MM-DD), or startDate and endDate to scan for the next opening.'
  }

  const query = new URLSearchParams({ date, serviceIds })
  if (staffId) query.set('staffId', String(Number(staffId)))
  // includeStaff is single-date only on the Xkedule side, and pointless when the
  // caller already pinned one staff member.
  const wantsStaff = isTruthy(p.includeStaff) && !staffId
  if (wantsStaff) query.set('includeStaff', 'true')

  // Routed through the shared TTL memo (60s, mirroring the provider's own
  // warm window) so a date already prefetched off a successful get_quote
  // call — see src/lib/xkedule/availability-cache.ts — is an in-process hit
  // instead of paying the 8-14s cold path again. The range shape above isn't
  // cached: a prefetch can't guess an arbitrary startDate/endDate window.
  const data = await fetchXkeduleAvailabilityCached<SlotsResponse>(
    {
      organizationId: credentials.organizationId,
      tenantBaseUrl: credentials.tenantBaseUrl,
      serviceIds: ids,
      date,
      staffId,
      includeStaff: wantsStaff,
    },
    () =>
      xkeduleFetchJson<SlotsResponse>(`/api/v1/availability?${query.toString()}`, 'GET', null, credentials),
  )

  const available = (data.slots ?? []).filter((s) => s.available)
  if (available.length === 0) {
    // "Closed on Sunday" and "fully booked on Sunday" are different answers a
    // customer hears very differently; the provider returns an empty list for
    // both. Ask the business hours (cached per tenant) before saying either.
    const day = await isBusinessOpenOn(credentials, date)
    if (day && !day.open) {
      return `The business is closed on ${day.weekday} (${date}). Suggest the next open day instead.`
    }
    // Late in the day "fully booked" is misleading: the day is simply over.
    // A pinned barber with nothing that day is not "fully booked" either (call
    // 5, 2026-09-06: "Tony is fully booked tomorrow" when Tony does not work
    // Mondays). Either way the model's next words should be the next real
    // openings, so they come back in the same result instead of costing
    // another turn and another provider round trip on the line.
    const staffName = staffId ? await staffNameOf(credentials, staffId) : undefined
    const who = staffId ? ` with ${staffName ?? 'that barber'}` : ''
    const headline = day?.today
      ? `No openings left today (${date})${who}.`
      : staffId
        ? `No openings${who} on ${day?.weekday ?? date} (${date}).`
        : `No available time slots on ${date} (fully booked).`
    const next = await nextOpeningsAfter(credentials, ids, staffId, date)
    return next ? `${headline}\n${next}` : `${headline} Suggest another day.`
  }

  if (!wantsStaff || !data.staff?.length) {
    return singleDayAvailability(date, available.map((s) => s.time))
  }

  const nameById = new Map(data.staff.map((m) => [m.id, m.name]))
  const lines = available.map((slot) => {
    const names = (slot.staffIds ?? []).map((id) => nameById.get(id) ?? `#${id}`)
    const time = spokenTime(slot.time)
    return names.length > 0 ? `${time} — ${names.join(', ')}` : time
  })
  return `Available slots on ${date} (with who can take them):\n${lines.join('\n')}`
}

/** The barber's name for a staff id, from the cached catalogue; undefined when unknown. */
async function staffNameOf(credentials: XkeduleCredentials, staffId: number): Promise<string | undefined> {
  try {
    const catalog = await getXkeduleCatalog(credentials)
    return catalog.staff.find((m) => m.id === staffId)?.name
  } catch {
    return undefined
  }
}

/**
 * The next days with openings after `date` (14 days, first three days that
 * have any), in the same spoken shape as the range query, or null when there
 * are none or the provider fails. One extra provider round trip, only ever
 * paid when a day came back empty.
 */
async function nextOpeningsAfter(credentials: XkeduleCredentials, ids: number[], staffId: number | undefined, date: string): Promise<string | null> {
  try {
    const start = new Date(`${date}T12:00:00Z`)
    if (!Number.isFinite(start.getTime())) return null
    const from = new Date(start.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10)
    const to = new Date(start.getTime() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const query = new URLSearchParams({ startDate: from, endDate: to, serviceIds: ids.join(',') })
    if (staffId) query.set('staffId', String(staffId))
    const data = await xkeduleFetchJson<RangeResponse>(`/api/v1/availability?${query.toString()}`, 'GET', null, credentials)
    const days = Object.entries(data.range ?? {})
      .map(([d, slots]) => [d, (slots ?? []).filter((x) => x.available).map((x) => x.time)] as const)
      .filter(([, times]) => times.length > 0)
      .slice(0, 3)
    if (days.length === 0) return null
    const summary = days.map(([d, times]) => {
      const shown = times.slice(0, 6)
      const more = times.length > shown.length ? ` (+${times.length - shown.length} more)` : ''
      return `${d} (${weekdayOf(d)}): ${spokenTimes(shown)}${more}`
    }).join('\n')
    return `Next openings${staffId ? ' with the same barber' : ''}:\n${summary}`
  } catch {
    return null
  }
}
