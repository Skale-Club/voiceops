import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SCRAPE_SOURCE_TYPES,
  audienceSourceTypes,
  matchesAudienceSourceType,
  normalizeAudienceSourceDefinition,
} from '@/lib/meta/audience-source'

describe('normalizeAudienceSourceDefinition', () => {
  it('defaults an unset scrape definition to every known scrape source', () => {
    const definition = normalizeAudienceSourceDefinition('xcraper_master', {})
    expect(definition).toEqual({ kind: 'xcraper_master', sourceTypes: [...DEFAULT_SCRAPE_SOURCE_TYPES] })
    // The two push paths that have actually shipped prospects.
    expect(matchesAudienceSourceType('xcraper', definition)).toBe(true)
    expect(matchesAudienceSourceType('google-maps', definition)).toBe(true)
  })

  it.each([null, undefined, 'not an object', [], 42])(
    'falls back to the default sources for malformed definition %p',
    (raw) => {
      const definition = normalizeAudienceSourceDefinition('xcraper_master', raw)
      expect(definition).toEqual({ kind: 'xcraper_master', sourceTypes: [...DEFAULT_SCRAPE_SOURCE_TYPES] })
    },
  )

  it('honours an explicit singular sourceType exactly and never widens it', () => {
    // A saved scope pinned to one provider is a deliberate narrowing; silently
    // adding sources would change an existing audience's membership.
    const definition = normalizeAudienceSourceDefinition('xcraper_master', { sourceType: 'apollo' })
    expect(audienceSourceTypes(definition)).toEqual(['apollo'])
    expect(matchesAudienceSourceType('apollo', definition)).toBe(true)
    expect(matchesAudienceSourceType('xcraper', definition)).toBe(false)
  })

  it('prefers the plural sourceTypes and de-duplicates it', () => {
    const definition = normalizeAudienceSourceDefinition('xcraper_master', {
      sourceType: 'ignored-when-plural-present',
      sourceTypes: ['xcraper', 'google-maps', 'xcraper'],
    })
    expect(audienceSourceTypes(definition)).toEqual(['xcraper', 'google-maps'])
  })

  it('ignores blank and non-string entries', () => {
    const definition = normalizeAudienceSourceDefinition('xcraper_master', {
      sourceTypes: ['xcraper', '   ', 7, null],
    })
    expect(audienceSourceTypes(definition)).toEqual(['xcraper'])
  })

  it('treats a blank singular sourceType as unset rather than as a filter matching nothing', () => {
    const definition = normalizeAudienceSourceDefinition('xcraper_master', { sourceType: '  ' })
    expect(audienceSourceTypes(definition)).toEqual([...DEFAULT_SCRAPE_SOURCE_TYPES])
  })

  it('reads prospect_segment entity keys and reports no source filter', () => {
    const definition = normalizeAudienceSourceDefinition('prospect_segment', {
      entityKeys: ['account:a1', 'contact:c1', 9],
    })
    expect(definition).toEqual({ kind: 'prospect_segment', entityKeys: ['account:a1', 'contact:c1'] })
    expect(audienceSourceTypes(definition)).toBeNull()
    expect(matchesAudienceSourceType('xcraper', definition)).toBe(false)
  })
})

describe('matchesAudienceSourceType', () => {
  const definition = normalizeAudienceSourceDefinition('xcraper_master', {})

  it.each([null, undefined, '', 'ghl_sync'])('rejects unselected source %p', (sourceType) => {
    expect(matchesAudienceSourceType(sourceType, definition)).toBe(false)
  })
})
