// book_appointment is two-phase, enforced in the action so it holds on every
// channel and with every model: the first call never writes and returns the
// read-back to say; only confirmed=true books.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), DEFAULT_TIMEOUT_MS: 15000, WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'
const CREDS = { tenantBaseUrl: 'https://demo.example', apiKey: 'k', organizationId: 'org-1' }
const ARGS = { serviceIds: '333', bookingDate: '2026-09-07', startTime: '09:00', customerName: 'Vanildo Teste', customerPhone: '+15088018190' }
beforeEach(() => vi.mocked(xkeduleFetchJson).mockReset())

describe('two-phase booking gate', () => {
  it('first call writes nothing and returns the read-back with the exact details', async () => {
    const out = await createXkeduleBooking(ARGS, CREDS as never)
    expect(xkeduleFetchJson).not.toHaveBeenCalled()
    expect(out).toMatch(/^NOT BOOKED YET/)
    expect(out).toContain('2026-09-07 at 09:00')
    expect(out).toContain('Vanildo Teste')
    expect(out).toContain('confirmed: true')
  })
  it('confirmed=true (or "true") books', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValue({ id: 500, status: 'pending', bookingDate: '2026-09-07', startTime: '09:00', endTime: '09:45', totalPrice: 38 })
    const out = await createXkeduleBooking({ ...ARGS, confirmed: true }, CREDS as never)
    expect(xkeduleFetchJson).toHaveBeenCalledTimes(1)
    expect(out).toContain('500')
    vi.mocked(xkeduleFetchJson).mockClear().mockResolvedValue({ id: 501, status: 'pending', bookingDate: '2026-09-07', startTime: '09:00' })
    await createXkeduleBooking({ ...ARGS, confirmed: 'true' }, CREDS as never)
    expect(xkeduleFetchJson).toHaveBeenCalledTimes(1)
  })
  it('confirmed=false or garbage does not book', async () => {
    for (const v of [false, 'no', 'yes please', 0]) {
      const out = await createXkeduleBooking({ ...ARGS, confirmed: v }, CREDS as never)
      expect(out).toMatch(/^NOT BOOKED YET/)
    }
    expect(xkeduleFetchJson).not.toHaveBeenCalled()
  })
  it('missing required fields still win over the gate', async () => {
    const out = await createXkeduleBooking({ customerName: 'x' }, CREDS as never)
    expect(out).toMatch(/Missing required/)
  })
})
