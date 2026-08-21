import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }) }) }) }),
}))

import { isAuthError, daysUntilExpiry, EXPIRY_WARNING_DAYS } from '@/lib/ads/connection-health'
import { MetaAdsError } from '@/lib/ads/meta-api'
import { GoogleAdsError } from '@/lib/ads/google-api'

describe('Ads connection health — auth error detection', () => {
  it('treats Meta code 190 as a dead credential', () => {
    // 190 is what an expired or revoked user token comes back as. Before this
    // was recognised it surfaced as a generic 502 and the connection stayed
    // marked healthy forever.
    expect(isAuthError(new MetaAdsError('Error validating access token', 190))).toBe(true)
  })

  it('recognises the other Meta auth codes', () => {
    expect(isAuthError(new MetaAdsError('Session expired', 102))).toBe(true)
    expect(isAuthError(new MetaAdsError('Permission denied', 467))).toBe(true)
  })

  it('recognises expiry subcodes under a generic code', () => {
    expect(isAuthError(new MetaAdsError('Session has expired', 190, 463))).toBe(true)
  })

  it('does NOT treat a rate limit or upstream fault as a dead credential', () => {
    // Marking these would show the operator a Reconnect prompt for a problem
    // reconnecting cannot fix.
    expect(isAuthError(new MetaAdsError('User request limit reached', 17))).toBe(false)
    expect(isAuthError(new MetaAdsError('Please reduce the amount of data', 1))).toBe(false)
    expect(isAuthError(new MetaAdsError('Unknown error', 2))).toBe(false)
  })

  it('recognises Google auth failures by status and message', () => {
    expect(isAuthError(new GoogleAdsError('Request had invalid authentication', 'UNAUTHENTICATED'))).toBe(true)
    expect(isAuthError(new GoogleAdsError('The caller does not have permission', 'PERMISSION_DENIED'))).toBe(true)
    expect(isAuthError(new Error('Google token refresh failed: invalid_grant'))).toBe(true)
  })

  it('does NOT treat a Google quota error as a dead credential', () => {
    expect(isAuthError(new GoogleAdsError('Resource exhausted', 'RESOURCE_EXHAUSTED'))).toBe(false)
    expect(isAuthError(new GoogleAdsError('Internal error', 'INTERNAL'))).toBe(false)
  })

  it('handles non-error values without throwing', () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError('some string')).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
  })
})

describe('Token expiry window', () => {
  const now = new Date('2026-08-21T00:00:00.000Z')

  it('returns null when no expiry is recorded', () => {
    expect(daysUntilExpiry(null, now)).toBeNull()
    expect(daysUntilExpiry('not-a-date', now)).toBeNull()
  })

  it('counts days remaining', () => {
    expect(daysUntilExpiry('2026-08-28T00:00:00.000Z', now)).toBe(7)
    expect(daysUntilExpiry('2026-10-20T00:00:00.000Z', now)).toBe(60)
  })

  it('returns a non-positive number once the token has lapsed', () => {
    expect(daysUntilExpiry('2026-08-20T00:00:00.000Z', now)).toBeLessThanOrEqual(0)
    expect(daysUntilExpiry('2026-06-01T00:00:00.000Z', now)).toBeLessThan(0)
  })

  it('flags a token inside the warning window', () => {
    const days = daysUntilExpiry('2026-08-25T00:00:00.000Z', now)
    expect(days).not.toBeNull()
    expect(days! > 0 && days! <= EXPIRY_WARNING_DAYS).toBe(true)
  })
})
