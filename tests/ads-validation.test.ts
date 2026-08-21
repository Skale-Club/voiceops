import { describe, expect, it } from 'vitest'

import { buildGaqlDateCondition } from '@/lib/ads/google-api'
import {
  AdsValidationError,
  IsoDateSchema,
  NumericIdSchema,
  MetaAdAccountIdSchema,
  assertIsoDate,
  assertNumericId,
  normalizeCustomerId,
} from '@/lib/ads/validation'

describe('Ads input validation', () => {
  it('accepts a real calendar date', () => {
    expect(IsoDateSchema.safeParse('2026-08-21').success).toBe(true)
  })

  it('rejects a well-formed but impossible date', () => {
    // The shape matches YYYY-MM-DD, so a regex alone would let it through.
    expect(IsoDateSchema.safeParse('2026-02-31').success).toBe(false)
    expect(IsoDateSchema.safeParse('2026-13-01').success).toBe(false)
  })

  it('rejects dates carrying SQL fragments', () => {
    for (const attack of [
      "2026-01-01' OR '1'='1",
      "2026-01-01' AND campaign.id = 1 --",
      '2026-01-01; DROP TABLE campaign',
      "' UNION SELECT",
    ]) {
      expect(IsoDateSchema.safeParse(attack).success).toBe(false)
    }
  })

  it('accepts digit-only ids and rejects everything else', () => {
    expect(NumericIdSchema.safeParse('1234567890').success).toBe(true)
    expect(NumericIdSchema.safeParse('123-456-7890').success).toBe(false)
    expect(NumericIdSchema.safeParse('1 OR 1=1').success).toBe(false)
    expect(NumericIdSchema.safeParse('').success).toBe(false)
  })

  it('validates Meta ad account ids by their act_ prefix', () => {
    expect(MetaAdAccountIdSchema.safeParse('act_123456789').success).toBe(true)
    expect(MetaAdAccountIdSchema.safeParse('123456789').success).toBe(false)
    expect(MetaAdAccountIdSchema.safeParse('act_abc').success).toBe(false)
  })

  it('throws AdsValidationError from the assert helpers', () => {
    expect(() => assertIsoDate("2026-01-01' OR 1=1", 'since')).toThrow(AdsValidationError)
    expect(() => assertNumericId('1; DROP TABLE', 'campaign_id')).toThrow(AdsValidationError)
    expect(assertIsoDate('2026-01-01', 'since')).toBe('2026-01-01')
    expect(assertNumericId('42', 'campaign_id')).toBe('42')
  })

  it('strips dashes from pasted customer ids', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890')
  })
})

describe('GAQL date condition', () => {
  it('maps native presets to DURING keywords', () => {
    expect(buildGaqlDateCondition('last_30d')).toBe('segments.date DURING LAST_30_DAYS')
    expect(buildGaqlDateCondition('yesterday')).toBe('segments.date DURING YESTERDAY')
  })

  it('interpolates a validated custom range', () => {
    expect(buildGaqlDateCondition('custom', '2026-01-01', '2026-01-31'))
      .toBe("segments.date BETWEEN '2026-01-01' AND '2026-01-31'")
  })

  it('refuses to build a condition from an injected date', () => {
    // This is the whole point: the value lands inside a query literal, so a
    // rejected parse is the only thing standing between a request param and
    // an appended GAQL clause.
    expect(() => buildGaqlDateCondition('custom', "2026-01-01' OR '1'='1", '2026-01-31'))
      .toThrow(AdsValidationError)
    expect(() => buildGaqlDateCondition('custom', '2026-01-01', "2026-01-31' --"))
      .toThrow(AdsValidationError)
  })

  it('resolves non-native presets to a concrete range instead of silently using 30 days', () => {
    const condition = buildGaqlDateCondition('last_6m')
    expect(condition).toMatch(/^segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'$/)
    expect(condition).not.toContain('LAST_30_DAYS')
  })
})
