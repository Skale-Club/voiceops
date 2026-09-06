import { memoTtl } from '@/lib/cache/ttl-memo'
import { xkeduleFetchJson, type XkeduleCredentials } from '@/lib/xkedule/client'
import { getXkeduleCatalog } from '@/lib/xkedule/actions/get-services'
import { checkVoiceBookingConfirmation, type BookingOperation, type VoiceBookingContext, type VoiceBookingFacts } from '@/lib/vapi/booking-confirmation'

interface BookingDetail {
  bookingDate: string
  startTime: string
  items: Array<{ serviceId: number; serviceName: string }>
  staff?: { id: number; name: string } | null
}
interface Quote { items: Array<{ serviceId: number; serviceName: string }>; subtotal: string; currency: string }
const TTL = 60_000

function day(date: unknown, time: unknown): { date: string; time: string } {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid booking date')
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid booking time')
  const d = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error('Invalid booking date')
  return { date, time }
}

/**
 * The facts the customer must hear before a write, resolved from tenant provider
 * data rather than from anything the model wrote. The sentence around them is the
 * model's own (see booking-confirmation.ts); these values are what it may not get
 * wrong. Cached reads keep the submit fast.
 */
export async function buildVoiceBookingSummary(operation: BookingOperation, p: Record<string, unknown>, c: XkeduleCredentials): Promise<VoiceBookingFacts> {
  const key = `xk:consent:${c.organizationId}:${c.tenantBaseUrl}`
  if (operation !== 'create') {
    const id = Number(p.bookingId ?? p.booking_id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid booking id')
    const b = await memoTtl(`${key}:booking:${id}`, TTL, () => xkeduleFetchJson<BookingDetail>(`/api/v1/bookings/${id}`, 'GET', null, c))
    const services = (b.items ?? []).map((i) => i.serviceName).filter(Boolean)
    if (!services.length) throw new Error('Booking services could not be verified')
    const current = day(b.bookingDate, b.startTime)
    const existing = { ...current, services, ...(b.staff?.name ? { staff: b.staff.name } : {}) }
    if (operation === 'cancel') return { services, ...current, existing }
    const moved = day(p.bookingDate, p.startTime)
    const requestedStaff = Number(p.staffMemberId ?? p.staffId)
    let staffName: string | undefined
    if (requestedStaff > 0 && requestedStaff !== b.staff?.id) {
      const catalog = await getXkeduleCatalog(c)
      const member = catalog.staff.find((s) => s.id === requestedStaff)
      if (!member) throw new Error('Staff member could not be verified')
      staffName = member.name
    }
    return { services, ...moved, ...(staffName ? { staffName } : {}), existing }
  }
  const raw = p.serviceIds ?? p.serviceId
  const ids = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map(Number)
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid service ids')
  const q = await memoTtl(`${key}:quote:${ids.join(',')}`, TTL, () => xkeduleFetchJson<Quote>('/api/v1/quote', 'POST', { items: ids.map((serviceId) => ({ serviceId, quantity: 1 })) }, c))
  if (!q.items?.length || !q.currency || !Number.isFinite(Number(q.subtotal)) || !p.customerName) throw new Error('Quote could not be verified')
  let staffName: string | undefined
  const staffId = Number(p.staffMemberId ?? p.staffId)
  if (staffId > 0) {
    const catalog = await getXkeduleCatalog(c)
    const member = catalog.staff.find((s) => s.id === staffId)
    if (!member) throw new Error('Staff member could not be verified')
    staffName = member.name
  }
  return {
    services: q.items.map((i) => i.serviceName),
    price: String(q.subtotal),
    currency: q.currency.toUpperCase(),
    ...day(p.bookingDate, p.startTime),
    ...(staffName ? { staffName } : {}),
    customerName: String(p.customerName),
  }
}

export async function verifyVoiceBooking(operation: BookingOperation, p: Record<string, unknown>, c: XkeduleCredentials, ctx: VoiceBookingContext) {
  try {
    const facts = await buildVoiceBookingSummary(operation, p, c)
    return checkVoiceBookingConfirmation(p, c.organizationId ?? '', ctx, operation, facts)
  } catch {
    return { allowed: false as const, instruction: 'Nothing was changed. I could not verify the appointment details right now. Explain that the request could not be completed and offer to take a message.' }
  }
}
