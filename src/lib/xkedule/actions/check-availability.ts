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

/** "09:00, 09:45 and 10:30" — reads back naturally on a voice call. */
function listTimes(times: string[]): string {
  if (times.length <= 1) return times.join('')
  return `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`
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

    const days = Object.entries(data.range ?? {})
      .map(([date, slots]) => [date, (slots ?? []).filter((s) => s.available).map((s) => s.time)] as const)
      .filter(([, times]) => times.length > 0)

    if (days.length === 0) {
      return `No availability between ${p.startDate} and ${p.endDate}.`
    }

    const next = data.nextAvailable
      ? `Next available: ${data.nextAvailable.date} at ${data.nextAvailable.time}.`
      : ''
    // Cap the per-day list: the model needs enough to offer a choice, not a
    // wall of 12 times per day across a fortnight.
    const summary = days
      .map(([date, times]) => {
        const shown = times.slice(0, 6)
        const more = times.length > shown.length ? ` (+${times.length - shown.length} more)` : ''
        return `${date}: ${listTimes(shown)}${more}`
      })
      .join('\n')

    return `${next}\n${summary}`.trim()
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
    return `No available time slots on ${date} (fully booked). Suggest another day.`
  }

  if (!wantsStaff || !data.staff?.length) {
    return `Available slots on ${date}: ${available.map((s) => s.time).join(', ')}`
  }

  const nameById = new Map(data.staff.map((m) => [m.id, m.name]))
  const lines = available.map((slot) => {
    const names = (slot.staffIds ?? []).map((id) => nameById.get(id) ?? `#${id}`)
    return names.length > 0 ? `${slot.time} — ${names.join(', ')}` : slot.time
  })
  return `Available slots on ${date} (with who can take them):\n${lines.join('\n')}`
}
