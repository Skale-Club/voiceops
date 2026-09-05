// src/lib/xkedule/actions/business-info.ts
// GET /api/v1/business-info — opening hours, address, timezone, service area
// and booking policies, formatted for an AI agent.
//
// Exists because the alternative is an agent improvising. "Are you open
// Sunday?" and "can I cancel same-day?" are the two questions a booking bot
// gets constantly, and a confident wrong answer to either costs the shop a
// no-show or a refund argument. Unpublished policy comes back as nothing at
// all, which the agent must relay as "I don't know" — never as "there is none".
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'
import { memoTtl } from '@/lib/cache/ttl-memo'

// A read the conversation repeats on almost every turn (each specialist
// resolves a service name to an id through it). The catalogue does not change
// between two turns; the provider takes 1.5-3s to answer it from production.
// Keyed by tenant base URL so two organizations never share an answer.
const BUSINESS_INFO_CACHE_TTL_MS = 600000

interface DayHours {
  isOpen?: boolean
  start?: string
  end?: string
}

interface BusinessInfoResponse {
  businessName?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  timezone?: string | null
  currency?: string | null
  businessHours?: Record<string, DayHours>
  serviceArea?: {
    groups?: { name: string; cities?: { name: string; state?: string | null }[] }[]
    legacy?: { name: string; region?: string | null }[]
  }
  policies?: {
    minimumBookingValue?: number
    serviceDeliveryModel?: string | null
    booking?: {
      cancellation?: string | null
      noShow?: string | null
      lateArrival?: string | null
      deposit?: string | null
      additional?: string | null
    }
  }
}

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

function titleCase(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1)
}

function formatHours(hours: Record<string, DayHours> | undefined): string {
  if (!hours) return ''
  const lines = DAY_ORDER.filter((day) => hours[day]).map((day) => {
    const entry = hours[day]
    return entry.isOpen && entry.start && entry.end
      ? `${titleCase(day)}: ${entry.start}–${entry.end}`
      : `${titleCase(day)}: closed`
  })
  return lines.length ? `\nOpening hours:\n${lines.join('\n')}` : ''
}

function formatPolicies(policies: BusinessInfoResponse['policies']): string {
  const booking = policies?.booking
  if (!booking) return ''
  const entries: Array<[string, string | null | undefined]> = [
    ['Cancellation', booking.cancellation],
    ['No-show', booking.noShow],
    ['Late arrival', booking.lateArrival],
    ['Deposit', booking.deposit],
    ['Also', booking.additional],
  ]
  const published = entries.filter(([, text]) => typeof text === 'string' && text.trim().length > 0)
  if (published.length === 0) {
    // Said explicitly so the model does not read silence as permission to guess.
    return '\nBooking policies: not published — say you will check with the shop rather than stating a policy.'
  }
  return `\nBooking policies:\n${published.map(([label, text]) => `${label}: ${text}`).join('\n')}`
}

function formatServiceArea(area: BusinessInfoResponse['serviceArea']): string {
  const names = [
    ...(area?.groups ?? []).flatMap((g) => (g.cities ?? []).map((c) => c.name)),
    ...(area?.legacy ?? []).map((a) => a.name),
  ].filter(Boolean)
  if (names.length === 0) return ''
  return `\nService area: ${[...new Set(names)].join(', ')}`
}

/** The raw business-info document, cached per tenant. Shared with availability so a
 *  day with no slots can be told apart as "closed" rather than "fully booked". */
export async function fetchBusinessInfoCached(credentials: XkeduleCredentials): Promise<BusinessInfoResponse> {
  return memoTtl(
    `xk:business_info:${credentials.tenantBaseUrl}`,
    BUSINESS_INFO_CACHE_TTL_MS,
    () => xkeduleFetchJson<BusinessInfoResponse>('/api/v1/business-info', 'GET', null, credentials),
  )
}

/**
 * Whether the business is open on a given YYYY-MM-DD, per its weekly hours.
 * Returns null when hours are unknown (never claims "closed" on missing data).
 */
export async function isBusinessOpenOn(credentials: XkeduleCredentials, date: string): Promise<{ open: boolean; weekday: string; hours: string } | null> {
  try {
    const info = await fetchBusinessInfoCached(credentials)
    const hours = info.businessHours
    if (!hours) return null
    const weekday = DAY_ORDER[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]
    const day = hours[weekday]
    if (!day) return null
    const open = day.isOpen !== false && !!day.start && !!day.end
    return { open, weekday: titleCase(weekday), hours: open ? `${day.start}-${day.end}` : 'closed' }
  } catch {
    return null
  }
}

export async function getXkeduleBusinessInfo(
  _params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const data = await fetchBusinessInfoCached(credentials)

  const header = [
    data.businessName ? `Business: ${data.businessName}` : null,
    data.address ? `Address: ${data.address}` : null,
    data.phone ? `Phone: ${data.phone}` : null,
    data.email ? `Email: ${data.email}` : null,
    data.timezone ? `Timezone: ${data.timezone}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return `${header}${formatHours(data.businessHours)}${formatServiceArea(data.serviceArea)}${formatPolicies(data.policies)}`.trim()
}
