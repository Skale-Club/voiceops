// Mirrors the stale-run threshold used by the SQL RPC
// `public.reclaim_stale_website_analyses` (migration 1273
// `supabase/migrations/1273_website_analyzer_reliability.sql`). Keep the
// default in sync with that migration's DEFAULT and comment if either
// changes.
export const DEFAULT_STALE_MINUTES = 10

export interface AnalysisRowFreshness {
  status: string
  updated_at: string
}

/**
 * Mirrors the SQL RPC's threshold from migration 1273
 * (`public.reclaim_stale_website_analyses`): a row is "stale" only if it is
 * still `pending`/`running` AND has not been touched for at least
 * `staleMinutes`. Any other status (`completed`, `failed`, or anything
 * unrecognized) is never stale -- those runs are already finished and cannot
 * be "stuck".
 *
 * The comparison is boundary-inclusive: a row updated exactly `staleMinutes`
 * ago counts as stale, matching the SQL side's
 * `updated_at < now() - make_interval(mins => p_stale_minutes)` once elapsed
 * time is exactly equal (`now - updated_at >= staleMinutes` <=>
 * `updated_at <= now - staleMinutes`).
 *
 * Fail-safe on bad input: a missing or unparseable `updated_at` returns
 * `false` rather than throwing -- callers use this to decide whether to
 * reclaim a row, and reclaiming a row we can't reason about the age of would
 * be worse than leaving it alone for the next check.
 */
export function isAnalysisRowStale(
  row: AnalysisRowFreshness,
  now: Date,
  staleMinutes: number = DEFAULT_STALE_MINUTES
): boolean {
  if (row.status !== 'pending' && row.status !== 'running') {
    return false
  }

  const updatedAt = new Date(row.updated_at)
  if (Number.isNaN(updatedAt.getTime())) {
    return false
  }

  const elapsedMs = now.getTime() - updatedAt.getTime()
  const thresholdMs = staleMinutes * 60_000
  return elapsedMs >= thresholdMs
}
