// The singular/plural mismatch that made every new xcraper_master audience
// report "the selected source scope is empty or invalid" on 2026-09-09, about a
// scope that resolved to 582 accounts. createAudience writes `sourceTypes`
// (plural array); the validator was reading `sourceType` (singular string).
import { describe, expect, it } from 'vitest'
import { audienceSourceTypes, normalizeAudienceSourceDefinition } from '@/lib/meta/audience-source'

/** Mirrors configSourceValid's xcraper_master branch in the server action. */
const scopeSelectsSomething = (kind: string, definition: unknown): boolean =>
  (audienceSourceTypes(normalizeAudienceSourceDefinition(kind, definition)) ?? []).length > 0

describe('xcraper_master scope validity accepts what createAudience actually writes', () => {
  it('accepts the plural shape the create action persists', () => {
    expect(scopeSelectsSomething('xcraper_master', {
      kind: 'xcraper_master',
      sourceTypes: ['xcraper', 'google-maps'],
    })).toBe(true)
  })

  it('still accepts the legacy singular shape, so older rows keep working', () => {
    expect(scopeSelectsSomething('xcraper_master', { sourceType: 'xcraper' })).toBe(true)
  })

  it('accepts a scope pinned to a non-xcraper scrape source', () => {
    // The old check hardcoded === 'xcraper' and silently rejected this, even
    // though readSourceTypes honours an explicit singular pin exactly.
    expect(scopeSelectsSomething('xcraper_master', { sourceType: 'google-maps' })).toBe(true)
  })

  it('falls back to every known scrape source when the definition is unset', () => {
    expect(scopeSelectsSomething('xcraper_master', {})).toBe(true)
    expect(scopeSelectsSomething('xcraper_master', null)).toBe(true)
  })
})
