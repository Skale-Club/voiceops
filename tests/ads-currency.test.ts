import { describe, expect, it } from 'vitest'

import {
  formatCurrency,
  formatMetaBudget,
  formatGoogleMicros,
  minorUnitsPerMajor,
  toMetaMinorUnits,
} from '@/lib/ads/currency'

describe('Ads currency formatting', () => {
  it('uses 100 minor units for standard currencies', () => {
    expect(minorUnitsPerMajor('USD')).toBe(100)
    expect(minorUnitsPerMajor('BRL')).toBe(100)
    expect(minorUnitsPerMajor('eur')).toBe(100)
  })

  it('uses 1 minor unit for zero-decimal currencies', () => {
    // A yen budget of 5000 is 5000 minor units, not 500000 — treating it like
    // cents would move the budget by two orders of magnitude.
    expect(minorUnitsPerMajor('JPY')).toBe(1)
    expect(minorUnitsPerMajor('KRW')).toBe(1)
  })

  it('formats in the account currency rather than defaulting to dollars', () => {
    const brl = formatCurrency(1234.5, 'BRL', { locale: 'pt-BR' })
    expect(brl).toContain('R$')
    expect(brl).not.toContain('$1,234')

    expect(formatCurrency(1234.5, 'USD')).toContain('$')
    expect(formatCurrency(1234.5, 'EUR')).toContain('€')
  })

  it('formats an unfamiliar but well-formed code by prefixing it', () => {
    // Intl accepts any three-letter code and renders it as a prefix (with a
    // non-breaking space), so this path never reaches the catch.
    const formatted = formatCurrency(10, 'XYZ')
    expect(formatted).toContain('XYZ')
    expect(formatted).toContain('10.00')
  })

  it('falls back instead of throwing on a malformed currency code', () => {
    // Intl throws RangeError for these; a render path must not die because an
    // account came back with a junk currency field.
    expect(formatCurrency(10, 'BADCODE')).toBe('BADCODE 10.00')
    expect(formatCurrency(10, 'XY')).toBe('XY 10.00')
  })

  it('treats a missing currency as USD instead of throwing', () => {
    expect(formatCurrency(10, null)).toContain('$')
    expect(formatCurrency(10, undefined)).toContain('$')
  })

  it('converts Meta minor units back to the major unit', () => {
    // Meta reports daily_budget in the account's minor units.
    expect(formatMetaBudget('5000', 'USD')).toBe('$50')
    expect(formatMetaBudget('5000', 'JPY')).toContain('5,000')
  })

  it('converts Google micros regardless of currency', () => {
    // Google always uses 1e6 per major unit, even for zero-decimal currencies.
    expect(formatGoogleMicros('50000000', 'USD')).toBe('$50.00')
    expect(formatGoogleMicros('50000000', 'JPY')).toContain('50')
  })

  it('round-trips a major-unit budget into Meta minor units', () => {
    expect(toMetaMinorUnits(50, 'USD')).toBe(5000)
    expect(toMetaMinorUnits(50, 'BRL')).toBe(5000)
    expect(toMetaMinorUnits(5000, 'JPY')).toBe(5000)
  })

  it('rounds fractional budgets to whole minor units', () => {
    // The API rejects fractional minor units.
    expect(toMetaMinorUnits(10.005, 'USD')).toBe(1001)
    expect(Number.isInteger(toMetaMinorUnits(33.333, 'USD'))).toBe(true)
  })
})
