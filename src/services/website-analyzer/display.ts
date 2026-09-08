export type AnalysisRowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead'

/**
 * Picks which website_analyses row a UI should render, given rows for one
 * account ordered newest-first.
 *
 * Problem this solves: once an account can have a `pending`/`running` row
 * in flight (or a `failed` row left behind by a reclaim -- see migration
 * 1273 `reclaim_stale_website_analyses`), the newest row is not always the
 * most useful one to show. Naively rendering "the newest row" would let a
 * freshly-queued or just-reclaimed attempt blank out a perfectly good
 * previous analysis (score, brand colors, screenshots) that the user was
 * already looking at.
 *
 * Behavior:
 * - No rows: returns `null`.
 * - Newest row is `completed`: returned unchanged -- it's already the best
 *   available data.
 * - Newest row is NOT `completed`, but some earlier row (newest-first, so
 *   the first `completed` row encountered scanning forward is the most
 *   recent completed one) is `completed`: returns that completed row's data
 *   with `status` and `error_message` overridden from the newest row, so the
 *   UI shows the current in-flight/failed state while still displaying the
 *   last good analysis underneath it.
 * - No row is `completed` at all: returns the newest row unchanged (there is
 *   no "last good data" to fall back to).
 */
export function resolveLatestAnalysisForDisplay<
  T extends { status: AnalysisRowStatus; error_message?: unknown }
>(rowsNewestFirst: T[]): T | null {
  if (rowsNewestFirst.length === 0) {
    return null
  }

  const newest = rowsNewestFirst[0]
  if (newest.status === 'completed') {
    return newest
  }

  const newestCompleted = rowsNewestFirst.find((row) => row.status === 'completed')
  if (!newestCompleted) {
    return newest
  }

  return {
    ...newestCompleted,
    status: newest.status,
    error_message: newest.error_message,
  }
}
