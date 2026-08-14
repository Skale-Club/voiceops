import { describe, expect, it, vi } from 'vitest'
import {
  isDndBlocked,
  loadEmailSuppressions,
  normalizeOutreachEmail,
} from '@/lib/prospects/outreach-eligibility'

describe('outreach eligibility', () => {
  it('normalizes email addresses for suppression comparisons', () => {
    expect(normalizeOutreachEmail('  Person@Example.COM ')).toBe('person@example.com')
    expect(normalizeOutreachEmail('not-an-email')).toBeNull()
  })

  it('honors channel-specific and global DND settings', () => {
    expect(isDndBlocked(true, ['email'], 'email')).toBe(true)
    expect(isDndBlocked(true, ['sms'], 'email')).toBe(false)
    expect(isDndBlocked(true, ['all'], 'sms')).toBe(true)
    expect(isDndBlocked(false, ['all'], 'email')).toBe(false)
  })

  it('loads normalized suppressions scoped to the organization', async () => {
    const inQuery = vi.fn().mockResolvedValue({
      data: [{ email: 'blocked@example.com' }],
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ in: inQuery })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })

    const result = await loadEmailSuppressions(
      { from },
      'org-1',
      ['BLOCKED@example.com', 'allowed@example.com', 'blocked@example.com'],
    )

    expect(result).toEqual(new Set(['blocked@example.com']))
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(inQuery).toHaveBeenCalledWith('email', ['blocked@example.com', 'allowed@example.com'])
  })

  it('fails closed when suppressions cannot be read', async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: null, error: new Error('database unavailable') }),
          }),
        }),
      }),
    }

    await expect(loadEmailSuppressions(client, 'org-1', ['person@example.com']))
      .rejects.toThrow('Could not verify email suppression status')
  })
})
