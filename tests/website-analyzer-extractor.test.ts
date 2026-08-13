import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { calculateLeadScore, rgbToHex, toBrandColors } from '@/services/website-analyzer/extractor'

describe('rgbToHex', () => {
  it('converts an rgb() triple to lowercase hex', () => {
    expect(rgbToHex('rgb(18, 52, 86)')).toBe('#123456')
  })

  it('converts an rgba() value, ignoring the alpha channel', () => {
    expect(rgbToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff0000')
  })

  it('pads single-digit components with a leading zero', () => {
    expect(rgbToHex('rgb(1, 2, 3)')).toBe('#010203')
  })

  it('returns null for "transparent"', () => {
    expect(rgbToHex('transparent')).toBeNull()
  })

  it('returns null for other non-matching input', () => {
    expect(rgbToHex('not-a-color')).toBeNull()
  })
})

describe('toBrandColors', () => {
  it('dedupes repeated hexes, keeping the first occurrence and its role', () => {
    const result = toBrandColors([
      { value: 'rgb(1, 2, 3)', role: 'background' },
      { value: 'rgb(1, 2, 3)', role: 'accent' }, // duplicate hex, later role must be dropped
      { value: 'rgb(4, 5, 6)', role: 'text' },
    ])
    expect(result).toEqual([
      { hex: '#010203', role: 'background' },
      { hex: '#040506', role: 'text' },
    ])
  })

  it('skips samples whose value fails conversion', () => {
    const result = toBrandColors([
      { value: 'transparent', role: 'background' },
      { value: 'rgb(4, 5, 6)', role: 'text' },
      { value: 'garbage', role: 'accent' },
    ])
    expect(result).toEqual([{ hex: '#040506', role: 'text' }])
  })

  it('preserves role and first-seen order across multiple distinct colors', () => {
    const result = toBrandColors([
      { value: 'rgb(10, 20, 30)', role: 'background' },
      { value: 'rgb(40, 50, 60)', role: 'text' },
      { value: 'rgb(70, 80, 90)', role: 'accent' },
    ])
    expect(result.map((c) => c.hex)).toEqual(['#0a141e', '#28323c', '#46505a'])
    expect(result.map((c) => c.role)).toEqual(['background', 'text', 'accent'])
  })
})

describe('calculateLeadScore', () => {
  const cleanSite = {
    siteReachable: true,
    isMobileResponsive: true,
    hasLogo: true,
    hasCTA: true,
    hasContactInfo: false,
    loadMs: 1000,
    hasCSSVars: true,
    colorCount: 2,
  }

  const worstCaseSite = {
    siteReachable: true,
    isMobileResponsive: false,
    hasLogo: false,
    hasCTA: false,
    hasContactInfo: true,
    loadMs: 5000,
    hasCSSVars: false,
    colorCount: 1,
  }

  it('scores an unreachable site as 0 regardless of every other flag', () => {
    expect(
      calculateLeadScore({
        ...worstCaseSite,
        siteReachable: false,
      }),
    ).toBe(0)
  })

  it('scores a clean site (responsive, logo, CTA, cssVars, >=2 colors, fast, no contact info) as 25', () => {
    expect(calculateLeadScore(cleanSite)).toBe(25)
  })

  it('scores the worst case (every opportunity signal true) as 100, capped', () => {
    // 25 base + 20 + 10 + 15 + 10 + 5 + 10 + 5 = 100
    expect(calculateLeadScore(worstCaseSite)).toBe(100)
  })

  // Regression lock: this documents the blast radius of the cross-origin stylesheet
  // bug (fixed in extractColors) that used to make hasCSSVars false on most modern
  // sites — silently inflating every affected score by exactly 10 points.
  it('scores two otherwise-identical inputs differing only in hasCSSVars exactly 10 points apart', () => {
    const withVars = calculateLeadScore({ ...cleanSite, hasCSSVars: true })
    const withoutVars = calculateLeadScore({ ...cleanSite, hasCSSVars: false })
    expect(withoutVars - withVars).toBe(10)
  })
})

describe('extractColors cross-origin stylesheet handling (structural guard)', () => {
  // Guards against silently reintroducing the bug where a single cross-origin
  // stylesheet (e.g. Google Fonts) aborted CSS-custom-property harvesting for
  // every remaining stylesheet, because the try/catch wrapped the whole outer
  // loop instead of just the per-sheet cssRules access.
  it('wraps the try/catch inside the styleSheets loop, not around it', () => {
    const extractorPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/services/website-analyzer/extractor.ts')
    const source = readFileSync(extractorPath, 'utf-8')

    const loopIndex = source.indexOf('for (const sheet of document.styleSheets)')
    const tryIndex = source.indexOf('try {', loopIndex)

    expect(loopIndex).toBeGreaterThan(-1)
    expect(tryIndex).toBeGreaterThan(-1)
    // The `try {` guarding cssRules access must appear AFTER the loop opens,
    // i.e. inside the loop body — not before it wrapping the whole loop.
    expect(tryIndex).toBeGreaterThan(loopIndex)
  })
})
