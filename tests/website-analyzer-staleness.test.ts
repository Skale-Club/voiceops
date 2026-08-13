import { describe, expect, it } from 'vitest'
import { isAnalysisRowStale } from '@/services/website-analyzer/staleness'

const NOW = new Date('2026-08-13T12:00:00.000Z')

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString()
}

describe('isAnalysisRowStale', () => {
  it('never treats a completed row as stale regardless of age', () => {
    expect(
      isAnalysisRowStale({ status: 'completed', updated_at: minutesAgo(10_000) }, NOW, 10)
    ).toBe(false)
  })

  it('never treats a failed row as stale regardless of age', () => {
    expect(
      isAnalysisRowStale({ status: 'failed', updated_at: minutesAgo(10_000) }, NOW, 10)
    ).toBe(false)
  })

  it('flags a running row updated 11 minutes ago as stale at a 10 minute threshold', () => {
    expect(isAnalysisRowStale({ status: 'running', updated_at: minutesAgo(11) }, NOW, 10)).toBe(
      true
    )
  })

  it('does not flag a pending row updated 5 minutes ago as stale at a 10 minute threshold', () => {
    expect(isAnalysisRowStale({ status: 'pending', updated_at: minutesAgo(5) }, NOW, 10)).toBe(
      false
    )
  })

  it('is boundary-inclusive: updated exactly staleMinutes ago is stale', () => {
    expect(isAnalysisRowStale({ status: 'running', updated_at: minutesAgo(10) }, NOW, 10)).toBe(
      true
    )
  })

  it('returns false and does not throw for an unparseable updated_at', () => {
    expect(() =>
      isAnalysisRowStale({ status: 'running', updated_at: 'not-a-date' }, NOW, 10)
    ).not.toThrow()
    expect(isAnalysisRowStale({ status: 'running', updated_at: 'not-a-date' }, NOW, 10)).toBe(
      false
    )
  })

  it('returns false and does not throw for a missing updated_at', () => {
    expect(() =>
      isAnalysisRowStale({ status: 'running', updated_at: undefined as unknown as string }, NOW, 10)
    ).not.toThrow()
    expect(
      isAnalysisRowStale({ status: 'running', updated_at: undefined as unknown as string }, NOW, 10)
    ).toBe(false)
  })
})
