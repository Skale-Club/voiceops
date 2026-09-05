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
    const upcoming = data.upcomingBookings.length
      ? data.upcomingBookings.map((b) => `#${b.id} on ${b.bookingDate} at ${b.startTime} (${b.status})${b.staffMemberId ? `, staff member id ${b.staffMemberId}` : ''}${b.totalPrice != null ? `, $${b.totalPrice}` : ''}`).join('\n')
      : 'No upcoming bookings.'
    return `Found customer: ${data.customer.name}${data.customer.email ? ` (${data.customer.email})` : ''}\n${upcoming}`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('404')) return "I don't have a record for that phone number yet."
    throw err
  }
}
