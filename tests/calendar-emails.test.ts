import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/email/resend', () => ({
  sendTenantEmail: vi.fn(),
  sendPlatformEmail: vi.fn(),
}))

import { sendPlatformEmail, sendTenantEmail } from '@/lib/email/resend'
import {
  sendBookingCancellation,
  sendBookingConfirmation,
} from '@/lib/calendar/emails'

const base = {
  bookerEmail: 'booker@example.com',
  bookerName: 'Booker',
  eventTitle: 'Discovery Call',
  hostName: 'Host',
  startAt: '2026-08-20T15:00:00.000Z',
  endAt: '2026-08-20T15:30:00.000Z',
  timezone: 'America/New_York',
  cancelUrl: 'https://xphere.app/book/cancel/token',
}

describe('calendar email sender resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTenantEmail).mockResolvedValue({ id: 'tenant-email' })
    vi.mocked(sendPlatformEmail).mockResolvedValue({ id: 'platform-email' })
  })

  it('uses the booking org tenant integration for confirmations', async () => {
    await sendBookingConfirmation({ ...base, orgId: 'org-1' })

    expect(sendTenantEmail).toHaveBeenCalledWith(
      'org-1',
      'booker@example.com',
      expect.stringContaining('Booking confirmed'),
      expect.any(String),
      undefined,
      expect.objectContaining({
        kind: 'transactional',
        source: 'calendar',
        attachments: [
          expect.objectContaining({ filename: 'invite.ics', content: expect.any(String) }),
        ],
      }),
    )
    expect(sendPlatformEmail).not.toHaveBeenCalled()
  })

  it('falls back to platform settings when the tenant send fails', async () => {
    vi.mocked(sendTenantEmail).mockResolvedValue({ error: 'Tenant email integration not configured' })

    await sendBookingCancellation({
      ...base,
      orgId: 'org-1',
      rebookUrl: 'https://xphere.app/book/org/event',
    })

    expect(sendPlatformEmail).toHaveBeenCalledWith(
      'booker@example.com',
      expect.stringContaining('Booking cancelled'),
      expect.any(String),
      undefined,
      { source: 'calendar' },
    )
  })

  it('uses platform settings directly when no org id is available', async () => {
    await sendBookingConfirmation(base)

    expect(sendTenantEmail).not.toHaveBeenCalled()
    expect(sendPlatformEmail).toHaveBeenCalledOnce()
  })
})
