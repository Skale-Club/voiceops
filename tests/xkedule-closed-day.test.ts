// "Closed on Sunday" and "fully booked on Sunday" are different answers a
// customer hears very differently; the provider returns an empty list for both.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), DEFAULT_TIMEOUT_MS: 15000, WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { clearMemo } from '@/lib/cache/ttl-memo'
import { isBusinessOpenOn } from '@/lib/xkedule/actions/business-info'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'

const CREDS = { tenantBaseUrl: 'https://demo.example', apiKey: 'k', organizationId: 'org-1' }
const HOURS = { businessHours: { monday: { isOpen: true, start: '09:00', end: '18:00' }, sunday: { isOpen: false } } }

beforeEach(() => { clearMemo(); vi.mocked(xkeduleFetchJson).mockReset() })

describe('isBusinessOpenOn', () => {
  it('reads the weekday of the date in the business week', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValue(HOURS)
    expect(await isBusinessOpenOn(CREDS, '2026-09-06')).toMatchObject({ open: false, weekday: 'Sunday' }) // 2026-09-06 is a Sunday
    expect(await isBusinessOpenOn(CREDS, '2026-09-07')).toMatchObject({ open: true, weekday: 'Monday', hours: '09:00-18:00' })
  })
  it('returns null rather than guessing when hours are unknown', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValue({})
    expect(await isBusinessOpenOn(CREDS, '2026-09-06')).toBeNull()
    vi.mocked(xkeduleFetchJson).mockRejectedValue(new Error('down'))
    expect(await isBusinessOpenOn(CREDS, '2026-09-06')).toBeNull()
  })
})

describe('check_availability with no slots', () => {
  it('says closed on a closed day', async () => {
    vi.mocked(xkeduleFetchJson).mockImplementation(async (path: string) => (String(path).includes('business-info') ? HOURS : { slots: [] }))
    const out = await checkXkeduleAvailability({ date: '2026-09-06', serviceIds: '333' }, CREDS as never)
    expect(out).toContain('closed on Sunday')
    expect(out).not.toContain('fully booked')
  })
  it('says fully booked on an open day', async () => {
    vi.mocked(xkeduleFetchJson).mockImplementation(async (path: string) => (String(path).includes('business-info') ? HOURS : { slots: [] }))
    const out = await checkXkeduleAvailability({ date: '2026-09-07', serviceIds: '333' }, CREDS as never)
    expect(out).toContain('fully booked')
  })
})
