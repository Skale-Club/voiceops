// src/lib/xkedule/actions/lookup-customer.ts
// GET /api/v1/customers?phone= — resolve a caller's phone number to their
// Xkedule contact record and upcoming (non-cancelled) bookings, so a voice
// or chat agent can recognize a returning customer.
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface LookupCustomerParams {
  phone?: string
  customerPhone?: string
  [key: string]: unknown
}

interface UpcomingBooking {
  id: number
  status: string
  bookingDate: string
  startTime: string
  staffMemberId?: number | null
  totalPrice?: string | number | null
}

interface BookingDetail {
  items?: Array<{ serviceId: number; serviceName: string }>
  staff?: { id: number; name: string } | null
}

interface CustomerResponse {
  customer: { id: number; name: string; email: string | null; phone: string | null }
  upcomingBookings: UpcomingBooking[]
}

export async function lookupXkeduleCustomer(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const p = params as LookupCustomerParams
  const phone = p.phone ?? p.customerPhone
  if (!phone) {
    return 'Please provide a phone number to look up.'
  }

  try {
    const data = await xkeduleFetchJson<CustomerResponse>(
      `/api/v1/customers?phone=${encodeURIComponent(String(phone))}`,
      'GET',
      null,
      credentials,
    )
    // The customer endpoint lists bookings without their services or staff.
    // A move needs both (the availability check is per service and staff),
    // so each upcoming booking is described from its detail endpoint; the
    // lookup is warmed at pickup, so the extra round trips are off the line.
    const details = await Promise.all(data.upcomingBookings.slice(0, 3).map(async (b) => {
      try {
        const d = await xkeduleFetchJson<BookingDetail>(`/api/v1/bookings/${b.id}`, 'GET', null, credentials)
        const services = (d.items ?? []).map((i) => `${i.serviceName} (service id ${i.serviceId})`).join(' + ')
        const staff = d.staff?.name ? ` with ${d.staff.name} (staff id ${d.staff.id})` : b.staffMemberId ? ` with staff id ${b.staffMemberId}` : ''
        return `#${b.id} on ${b.bookingDate} at ${b.startTime} (${b.status})${services ? `: ${services}` : ''}${staff}${b.totalPrice != null ? `, $${b.totalPrice}` : ''}`
      } catch {
        return `#${b.id} on ${b.bookingDate} at ${b.startTime} (${b.status})${b.staffMemberId ? `, staff id ${b.staffMemberId}` : ''}${b.totalPrice != null ? `, $${b.totalPrice}` : ''}`
      }
    }))
    const upcoming = details.length ? details.join('\n') : 'No upcoming bookings.'
    // Name and appointments only. The email, address and phone are never put
    // in front of the model: on a phone line they would be read aloud, and
    // the caller already knows their own.
    return `Found customer: ${data.customer.name}\n${upcoming}`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('404')) return "I don't have a record for that phone number yet."
    throw err
  }
}
