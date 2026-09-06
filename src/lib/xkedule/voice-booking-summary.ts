import { memoTtl } from '@/lib/cache/ttl-memo'
import { xkeduleFetchJson, type XkeduleCredentials } from '@/lib/xkedule/client'
import { getXkeduleCatalog } from '@/lib/xkedule/actions/get-services'
import { checkVoiceBookingConfirmation, type BookingOperation, type VoiceBookingContext } from '@/lib/vapi/booking-confirmation'

interface BookingDetail {
  bookingDate: string
  startTime: string
  items: Array<{ serviceId: number; serviceName: string }>
  staff?: { id: number; name: string } | null
}
interface Quote { items: Array<{ serviceId: number; serviceName: string }>; subtotal: string; currency: string }
const TTL = 60_000
function when(date: unknown, time: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid booking date')
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid booking time')
  const d = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error('Invalid booking date')
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d)
  const [h, m] = time.split(':')
  return `${day} at ${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? 'PM' : 'AM'}`
}

/** Canonical customer-visible summary, resolved from tenant provider facts rather
 * than a model-authored confirmation sentence. Cached reads keep the submit fast. */
export async function buildVoiceBookingSummary(operation: BookingOperation, p: Record<string, unknown>, c: XkeduleCredentials): Promise<string> {
  const key = `xk:consent:${c.organizationId}:${c.tenantBaseUrl}`
  if (operation !== 'create') {
    const id = Number(p.bookingId ?? p.booking_id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid booking id')
    const b = await memoTtl(`${key}:booking:${id}`, TTL, () => xkeduleFetchJson<BookingDetail>(`/api/v1/bookings/${id}`, 'GET', null, c))
    const service = b.items?.map((i) => i.serviceName).join(' and ')
    if (!service) throw new Error('Booking services could not be verified')
    const existing = `your ${service} appointment${b.staff?.name ? ` with ${b.staff.name}` : ''} on ${when(b.bookingDate, b.startTime)}`
    if (operation === 'cancel') return `I will cancel ${existing}.`
    const requestedStaff = Number(p.staffMemberId ?? p.staffId)
    let staff = ''
    if (requestedStaff > 0 && requestedStaff !== b.staff?.id) {
      const catalog = await getXkeduleCatalog(c)
      const member = catalog.staff.find((s) => s.id === requestedStaff)
      if (!member) throw new Error('Staff member could not be verified')
      staff = ` with ${member.name}`
    }
    return `I will move ${existing} to ${when(p.bookingDate, p.startTime)}${staff}.`
  }
  const raw = p.serviceIds ?? p.serviceId
  const ids = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map(Number)
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid service ids')
  const q = await memoTtl(`${key}:quote:${ids.join(',')}`, TTL, () => xkeduleFetchJson<Quote>('/api/v1/quote', 'POST', { items: ids.map((serviceId) => ({ serviceId, quantity: 1 })) }, c))
  if (!q.items?.length || !q.currency || !Number.isFinite(Number(q.subtotal)) || !p.customerName) throw new Error('Quote could not be verified')
  let staff = ''
  const staffId = Number(p.staffMemberId ?? p.staffId)
  if (staffId > 0) {
    const catalog = await getXkeduleCatalog(c)
    const member = catalog.staff.find((s) => s.id === staffId)
    if (!member) throw new Error('Staff member could not be verified')
    staff = ` with ${member.name}`
  }
  const extra = `${p.customerAddress ? ` Service address: ${p.customerAddress}.` : ''}${p.notes ? ` Notes: ${p.notes}.` : ''}`
  return `I will request ${q.items.map((i) => i.serviceName).join(' and ')}${staff} for ${Number(q.subtotal).toFixed(2)} ${q.currency.toUpperCase()} on ${when(p.bookingDate, p.startTime)}, under ${p.customerName}.${extra}`
}

export async function verifyVoiceBooking(operation: BookingOperation, p: Record<string, unknown>, c: XkeduleCredentials, ctx: VoiceBookingContext) {
  try {
    const summary = await buildVoiceBookingSummary(operation, p, c)
    return checkVoiceBookingConfirmation(p, c.organizationId ?? '', ctx, operation, summary)
  } catch {
    return { allowed: false as const, instruction: 'Nothing was changed. I could not verify the appointment details right now. Explain that the request could not be completed and offer to take a message.' }
  }
}
