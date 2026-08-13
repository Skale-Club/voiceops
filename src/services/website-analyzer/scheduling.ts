export const DEFAULT_RECENT_DAYS = 7
export const DEFAULT_BATCH_SIZE = 10

export interface AnalyzerCandidate {
  accountId: string
  orgId: string
  domain: string
  name: string | null
  lastAnalyzedAt: string | null // ISO, null = never analyzed
  accountCreatedAt: string // ISO
}

export interface SelectBatchOptions {
  now: Date
  recentDays?: number
  batchSize?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Selects the next batch of accounts for the Website Analyzer to run against.
 *
 * Starvation bug this fixes: a naive "take the first N eligible candidates in
 * whatever order the query returned them" approach lets accounts that happen
 * to sort first (e.g. by insertion order or id) get re-analyzed over and over
 * while accounts later in the result set are never reached, because each
 * batch selection restarts from the same head of an arbitrarily-ordered list.
 * This function instead defines a total order over ALL eligible candidates --
 * never-analyzed first, then strictly oldest-analyzed-first, with a
 * deterministic tiebreaker -- so which candidates end up in a batch depends
 * only on their analysis recency, never on their position in the input array.
 * That guarantees every eligible account eventually reaches the front of the
 * queue.
 *
 * Eligibility: a candidate whose `lastAnalyzedAt` falls within `recentDays`
 * of `now` is dropped (it was analyzed too recently to be worth re-running).
 * The boundary is inclusive on the eligible side: a candidate analyzed
 * exactly `recentDays` ago is INCLUDED, not excluded -- only strictly less
 * than `recentDays` elapsed is too recent.
 *
 * Ordering (total order, independent of input position):
 *   1. Never-analyzed (`lastAnalyzedAt === null`) ranks ahead of any analyzed
 *      candidate.
 *   2. Among analyzed candidates, oldest `lastAnalyzedAt` first.
 *   3. Ties (including ties among never-analyzed candidates) are broken by
 *      `accountCreatedAt` ascending.
 *
 * Does not mutate the input array; returns a new sliced-to-`batchSize` copy.
 */
export function selectWebsiteAnalyzerBatch(
  candidates: AnalyzerCandidate[],
  opts: SelectBatchOptions
): AnalyzerCandidate[] {
  const { now } = opts
  const recentDays = opts.recentDays ?? DEFAULT_RECENT_DAYS
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const recentThresholdMs = recentDays * DAY_MS

  const eligible = candidates.filter((candidate) => {
    if (candidate.lastAnalyzedAt === null) {
      return true
    }
    const lastAnalyzedAt = new Date(candidate.lastAnalyzedAt)
    const elapsedMs = now.getTime() - lastAnalyzedAt.getTime()
    return elapsedMs >= recentThresholdMs
  })

  const sorted = [...eligible].sort((a, b) => {
    const aTime = a.lastAnalyzedAt === null ? null : new Date(a.lastAnalyzedAt).getTime()
    const bTime = b.lastAnalyzedAt === null ? null : new Date(b.lastAnalyzedAt).getTime()

    if (aTime === null && bTime === null) {
      return compareCreatedAt(a, b)
    }
    if (aTime === null) return -1
    if (bTime === null) return 1
    if (aTime !== bTime) return aTime - bTime

    return compareCreatedAt(a, b)
  })

  return sorted.slice(0, batchSize)
}

function compareCreatedAt(a: AnalyzerCandidate, b: AnalyzerCandidate): number {
  return new Date(a.accountCreatedAt).getTime() - new Date(b.accountCreatedAt).getTime()
}
