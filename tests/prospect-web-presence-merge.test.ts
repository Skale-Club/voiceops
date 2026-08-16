import { describe, expect, it } from 'vitest'
import { mergeProspectCustomFields } from '@/lib/prospects/web-presence-merge'

describe('prospect web-presence merge', () => {
  it('clears stale canonical presence fields on an explicit null re-import', () => {
    expect(mergeProspectCustomFields(
      {
        website: 'https://google.com/maps/example',
        web_presence_type: 'owned_website',
        booking_platform: 'Old value',
        unrelated: 'keep me',
      },
      {
        website: null,
        has_owned_website: false,
        web_presence_type: 'directory_listing',
        booking_platform: null,
      },
    )).toEqual({
      website: null,
      has_owned_website: false,
      web_presence_type: 'directory_listing',
      booking_platform: null,
      unrelated: 'keep me',
    })
  })

  it('does not clear unrelated fields with blank input', () => {
    expect(mergeProspectCustomFields(
      { category: 'Barber shop', website: 'https://example.com' },
      { category: '', website: '  ' },
    )).toEqual({ category: 'Barber shop', website: null })
  })
})
