import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_RECENT_DAYS,
  selectWebsiteAnalyzerBatch,
  type AnalyzerCandidate,
} from '@/services/website-analyzer/scheduling'

const NOW = new Date('2026-08-13T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60_000).toISOString()
}

function candidate(overrides: Partial<AnalyzerCandidate>): AnalyzerCandidate {
  return {
    accountId: 'acct',
    orgId: 'org',
    domain: 'example.com',
    name: 'Example',
    lastAnalyzedAt: null,
    accountCreatedAt: daysAgo(30),
    ...overrides,
  }
}

describe('selectWebsiteAnalyzerBatch', () => {
  it('ranks a never-analyzed candidate ahead of one analyzed 8 days ago', () => {
    const neverAnalyzed = candidate({ accountId: 'never', lastAnalyzedAt: null })
    const analyzed8DaysAgo = candidate({ accountId: 'old', lastAnalyzedAt: daysAgo(8) })

    const result = selectWebsiteAnalyzerBatch([analyzed8DaysAgo, neverAnalyzed], { now: NOW })

    expect(result.map((c) => c.accountId)).toEqual(['never', 'old'])
  })

  it('excludes a candidate analyzed 2 days ago at the default 7 day recency window', () => {
    const recentlyAnalyzed = candidate({ accountId: 'recent', lastAnalyzedAt: daysAgo(2) })

    const result = selectWebsiteAnalyzerBatch([recentlyAnalyzed], { now: NOW })

    expect(result).toEqual([])
  })

  it('includes a candidate analyzed exactly recentDays ago (boundary inclusive)', () => {
    const exactlyAtBoundary = candidate({
      accountId: 'boundary',
      lastAnalyzedAt: daysAgo(DEFAULT_RECENT_DAYS),
    })

    const result = selectWebsiteAnalyzerBatch([exactlyAtBoundary], { now: NOW })

    expect(result.map((c) => c.accountId)).toEqual(['boundary'])
  })

  it('breaks ties among never-analyzed candidates by accountCreatedAt ascending', () => {
    const newer = candidate({
      accountId: 'newer',
      lastAnalyzedAt: null,
      accountCreatedAt: daysAgo(1),
    })
    const older = candidate({
      accountId: 'older',
      lastAnalyzedAt: null,
      accountCreatedAt: daysAgo(10),
    })

    const result = selectWebsiteAnalyzerBatch([newer, older], { now: NOW })

    expect(result.map((c) => c.accountId)).toEqual(['older', 'newer'])
  })

  it('respects batchSize: 15 eligible candidates with batchSize 10 returns exactly 10', () => {
    const eligible = Array.from({ length: 15 }, (_, i) =>
      candidate({ accountId: `c${i}`, lastAnalyzedAt: null, accountCreatedAt: daysAgo(i) })
    )

    const result = selectWebsiteAnalyzerBatch(eligible, { now: NOW, batchSize: 10 })

    expect(result).toHaveLength(10)
  })

  it('uses DEFAULT_BATCH_SIZE when batchSize is not provided', () => {
    const eligible = Array.from({ length: DEFAULT_BATCH_SIZE + 5 }, (_, i) =>
      candidate({ accountId: `c${i}`, lastAnalyzedAt: null, accountCreatedAt: daysAgo(i) })
    )

    const result = selectWebsiteAnalyzerBatch(eligible, { now: NOW })

    expect(result).toHaveLength(DEFAULT_BATCH_SIZE)
  })

  it('starvation regression: result is independent of input array position', () => {
    // Indexes 0-49: analyzed 1 hour ago -- ineligible (well within the 7 day window).
    const ineligible = Array.from({ length: 50 }, (_, i) =>
      candidate({ accountId: `ineligible-${i}`, lastAnalyzedAt: hoursAgo(1) })
    )
    // Indexes 50-59: never analyzed -- eligible, and the only eligible candidates.
    const eligible = Array.from({ length: 10 }, (_, i) =>
      candidate({
        accountId: `eligible-${i}`,
        lastAnalyzedAt: null,
        accountCreatedAt: daysAgo(i),
      })
    )
    const input = [...ineligible, ...eligible]
    const inputSnapshot = [...input]

    const result = selectWebsiteAnalyzerBatch(input, { now: NOW, batchSize: 10 })

    expect(result).toHaveLength(10)
    expect(result.every((c) => c.accountId.startsWith('eligible-'))).toBe(true)
    expect(new Set(result.map((c) => c.accountId))).toEqual(
      new Set(eligible.map((c) => c.accountId))
    )

    // Input array must not be mutated.
    expect(input).toEqual(inputSnapshot)
  })
})
