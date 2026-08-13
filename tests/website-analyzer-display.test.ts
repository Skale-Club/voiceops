import { describe, expect, it } from 'vitest'
import { resolveLatestAnalysisForDisplay } from '@/services/website-analyzer/display'

interface Row {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error_message?: string | null
  lead_score?: number
}

describe('resolveLatestAnalysisForDisplay', () => {
  it('returns null for an empty list', () => {
    expect(resolveLatestAnalysisForDisplay<Row>([])).toBeNull()
  })

  it('returns the same object when the only row is completed', () => {
    const row: Row = { id: 'a', status: 'completed', lead_score: 90 }

    expect(resolveLatestAnalysisForDisplay([row])).toBe(row)
  })

  it('merges a newer running row over an older completed row: keeps completed data, uses newest status/error', () => {
    const running: Row = { id: 'b', status: 'running', error_message: null }
    const completed: Row = { id: 'a', status: 'completed', lead_score: 90, error_message: null }

    const result = resolveLatestAnalysisForDisplay([running, completed])

    expect(result).toEqual({
      id: 'a',
      status: 'running',
      lead_score: 90,
      error_message: null,
    })
  })

  it('merges a newer failed (reclaimed) row over an older completed row, carrying the reclaim message', () => {
    const failed: Row = {
      id: 'b',
      status: 'failed',
      error_message: 'Reclaimed: analysis exceeded 10 minute stale threshold (process likely crashed or was redeployed mid-run).',
    }
    const completed: Row = { id: 'a', status: 'completed', lead_score: 90, error_message: null }

    const result = resolveLatestAnalysisForDisplay([failed, completed])

    expect(result).toEqual({
      id: 'a',
      status: 'failed',
      lead_score: 90,
      error_message: failed.error_message,
    })
  })

  it('returns the newest row as-is when no completed row exists at all', () => {
    const running: Row = { id: 'b', status: 'running' }
    const pending: Row = { id: 'a', status: 'pending' }

    const result = resolveLatestAnalysisForDisplay([running, pending])

    expect(result).toBe(running)
  })

  it('picks the most recent completed row, not an older one, when the newest row is not completed', () => {
    const running: Row = { id: 'c', status: 'running' }
    const mostRecentCompleted: Row = { id: 'b', status: 'completed', lead_score: 75 }
    const olderCompleted: Row = { id: 'a', status: 'completed', lead_score: 40 }

    const result = resolveLatestAnalysisForDisplay([running, mostRecentCompleted, olderCompleted])

    expect(result?.id).toBe('b')
    expect(result?.lead_score).toBe(75)
  })
})
