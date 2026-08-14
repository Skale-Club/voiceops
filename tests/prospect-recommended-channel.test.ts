import { describe, expect, it } from 'vitest'

import {
  accountEmailFromCustomFields,
  deriveRecommendedChannel,
  resolveRecommendedChannel,
} from '@/lib/prospects/recommended-channel'

describe('deriveRecommendedChannel', () => {
  it('prefers email when both identifiers are present', () => {
    expect(deriveRecommendedChannel({ email: 'a@b.com', phone: '+15551234567' })).toBe('email')
  })

  it('falls back to call when only a phone is known', () => {
    // The scraped-but-no-website segment: Google Maps gives a phone, never an email.
    expect(deriveRecommendedChannel({ phone: '+15551234567' })).toBe('call')
  })

  it('returns null when there is nothing to reach the prospect on', () => {
    expect(deriveRecommendedChannel({})).toBeNull()
    expect(deriveRecommendedChannel({ email: null, phone: null })).toBeNull()
  })

  it.each(['', '   '])('treats blank identifier %p as absent', (blank) => {
    expect(deriveRecommendedChannel({ email: blank, phone: blank })).toBeNull()
    expect(deriveRecommendedChannel({ email: blank, phone: '+15551234567' })).toBe('call')
  })
})

describe('resolveRecommendedChannel', () => {
  it('derives when the caller supplied nothing', () => {
    expect(resolveRecommendedChannel(undefined, { phone: '+15551234567' })).toBe('call')
  })

  it('never overrides an explicit caller value', () => {
    // Xcraper already sends this; a server-side guess must not fight it.
    expect(resolveRecommendedChannel('whatsapp', { email: 'a@b.com' })).toBe('whatsapp')
  })

  it('preserves an explicit null as a deliberate clear, not a gap to fill', () => {
    expect(resolveRecommendedChannel(null, { phone: '+15551234567' })).toBeNull()
  })
})

describe('accountEmailFromCustomFields', () => {
  it('reads the scraped address an account keeps in custom_fields', () => {
    expect(accountEmailFromCustomFields({ email: 'shop@example.com' })).toBe('shop@example.com')
  })

  it.each([null, undefined, 'string', [], { email: 42 }, {}])(
    'returns null for %p',
    (customFields) => {
      expect(accountEmailFromCustomFields(customFields)).toBeNull()
    },
  )
})
