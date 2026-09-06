// On a phone call the identity is the number on the line. The model's
// arguments cannot look up another customer or change another customer's
// booking, whatever the caller says.
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { clearMemo } from '@/lib/cache/ttl-memo'
import { assertBookingOwnedByCaller, samePhone } from '@/lib/xkedule/booking-ownership'
import { cancelXkeduleBooking } from '@/lib/xkedule/actions/cancel-booking'
import { rescheduleXkeduleBooking } from '@/lib/xkedule/actions/reschedule-booking'
import { lookupXkeduleCustomer } from '@/lib/xkedule/actions/lookup-customer'

const creds = { tenantBaseUrl: 'https://example.test', apiKey: 'mock', organizationId: 'org-1' }
const CALLER = '+15088018190'
const OTHER = '+16175550100'

function provider(bookingPhone: string) {
  vi.mocked(xkeduleFetchJson).mockImplementation(async (path, method) => {
    if (method === 'GET' && /^\/api\/v1\/bookings\/\d+$/.test(path)) {
      return { id: 470, bookingDate: '2026-09-08', startTime: '10:30', items: [{ serviceId: 333, serviceName: 'Signature Haircut' }], contact: { phone: bookingPhone } }
    }
    if (method === 'GET' && path.startsWith('/api/v1/customers?phone=')) {
      return { customer: { id: 1, name: 'Someone Else', email: 'else@example.test', phone: decodeURIComponent(path.split('=')[1]) }, upcomingBookings: [] }
    }
    return { id: 470, status: 'cancelled' }
  })
}

beforeEach(() => { vi.stubEnv('ENCRYPTION_SECRET', 'ab'.repeat(32)); vi.mocked(xkeduleFetchJson).mockReset(); clearMemo() })

describe('samePhone', () => {
  it.each([
    ['+15088018190', '5088018190', true],
    ['+1 (508) 801-8190', '+15088018190', true],
    ['+15088018190', '+16175550100', false],
    ['', '+15088018190', false],
    [undefined, '+15088018190', false],
  ])('%s vs %s -> %s', (a, b, expected) => expect(samePhone(a, b)).toBe(expected))
})

describe('booking ownership', () => {
  it('refuses when the booking belongs to another number, without any write', async () => {
    provider(OTHER)
    const r = await assertBookingOwnedByCaller(470, { callerNumber: CALLER }, creds)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.instruction).toMatch(/isn't under the number/)
  })
  it('refuses without a caller number, without reading the booking', async () => {
    provider(CALLER)
    const r = await assertBookingOwnedByCaller(470, {}, creds)
    expect(r.ok).toBe(false)
    expect(xkeduleFetchJson).not.toHaveBeenCalled()
  })
  it('refuses when the booking cannot be read', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValue(new Error('404'))
    expect((await assertBookingOwnedByCaller(470, { callerNumber: CALLER }, creds)).ok).toBe(false)
  })
  it('accepts the owner', async () => {
    provider(CALLER)
    expect((await assertBookingOwnedByCaller(470, { callerNumber: CALLER }, creds)).ok).toBe(true)
  })
})

describe('cancel and reschedule on a phone call', () => {
  const voice = { callId: 'call-1', messages: [{ role: 'user', content: 'cancel appointment 470' }] }
  it('cancel of a booking that is not the caller\'s never reaches the provider and never asks for consent', async () => {
    provider(OTHER)
    const result = await cancelXkeduleBooking({ bookingId: 470, confirmed: true }, creds, voice, { callerNumber: CALLER })
    expect(result).toMatch(/isn't under the number/)
    expect(result).not.toMatch(/NOT CANCELLED YET|confirmationToken/)
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([, method]) => method === 'POST')).toBe(false)
  })
  it('reschedule of a booking that is not the caller\'s is refused the same way', async () => {
    provider(OTHER)
    const result = await rescheduleXkeduleBooking({ bookingId: 470, bookingDate: '2026-09-09', startTime: '09:00', confirmed: true }, creds, voice, { callerNumber: CALLER })
    expect(result).toMatch(/isn't under the number/)
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([, method]) => method === 'POST')).toBe(false)
  })
  it('a call without a number cannot change any existing booking', async () => {
    provider(CALLER)
    const result = await cancelXkeduleBooking({ bookingId: 470 }, creds, voice, {})
    expect(result).toMatch(/number isn't available/)
    expect(xkeduleFetchJson).not.toHaveBeenCalled()
  })
  it("the owner's cancel proceeds to the consent gate (not to the provider yet)", async () => {
    provider(CALLER)
    const result = await cancelXkeduleBooking({ bookingId: 470 }, creds, voice, { callerNumber: CALLER })
    expect(result).toMatch(/NOT CANCELLED YET/)
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([, method]) => method === 'POST')).toBe(false)
  })
  it('the widget path (no caller identity) is unchanged', async () => {
    provider(OTHER)
    const result = await cancelXkeduleBooking({ bookingId: 470 }, creds)
    expect(result).toMatch(/is now cancelled/)
  })
})

describe('lookup output', () => {
  it('never includes the email', async () => {
    provider(CALLER)
    const result = await lookupXkeduleCustomer({ phone: CALLER }, creds)
    expect(result).toContain('Someone Else')
    expect(result).not.toContain('@')
  })
})
