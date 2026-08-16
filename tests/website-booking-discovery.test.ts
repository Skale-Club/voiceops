import { describe, expect, it } from 'vitest'
import { discoverBooking } from '@/services/website-analyzer/booking-discovery'

describe('website booking discovery', () => {
  it('prioritizes a known third-party provider', () => {
    const result = discoverBooking('https://barber.example', [
      { url: '/booking', label: 'Book now', source: 'link' },
      { url: 'https://book.thecut.co/barber', label: 'Appointments', source: 'link' },
    ])
    expect(result).toMatchObject({
      detected: true,
      mode: 'third_party',
      primaryProvider: 'TheCut',
      primaryUrl: 'https://book.thecut.co/barber',
    })
    expect(result.platforms).toContain('Website booking')
  })

  it('detects an embedded GlossGenius booking frame without CTA text', () => {
    expect(discoverBooking('https://barber.example', [
      { url: 'https://shop.glossgenius.com/widget', source: 'iframe' },
    ])).toMatchObject({ detected: true, mode: 'third_party', primaryProvider: 'GlossGenius' })
  })

  it('detects a same-site booking route', () => {
    expect(discoverBooking('https://barber.example', [
      { url: '/appointments', label: 'Schedule appointment', source: 'link' },
    ])).toMatchObject({ detected: true, mode: 'on_site', primaryProvider: 'Website booking' })
  })

  it('ignores ordinary navigation links', () => {
    expect(discoverBooking('https://barber.example', [
      { url: '/about', label: 'About us', source: 'link' },
      { url: 'https://instagram.com/barber', label: 'Instagram', source: 'link' },
    ])).toMatchObject({ detected: false, mode: 'none', links: [] })
  })
})

