// Retry policy for the Website Analyzer (Fase 33 — Xphere part).
//
// Evidence: the analyzer cron retried `https://gubarbershop.com` (which does not
// resolve — `net::ERR_NAME_NOT_RESOLVED`) 432 times in three days, every 10
// minutes, because nothing distinguished "this domain will never work" from
// "the site hiccuped once." Every failure got a brand-new pending row and was
// retried on the very next tick forever, burning one of the ~10 analyzer slots
// per run indefinitely.
//
// Two failure classes:
//   - Permanent: the domain or endpoint is fundamentally broken. Retrying more
//     never helps. Marked `dead` on the FIRST occurrence.
//   - Transient: a network hiccup, timeout, 5xx, or a stale/crashed-worker
//     reclaim. Retried up to MAX_TRANSIENT_ATTEMPTS times with exponential-ish
//     backoff, then `dead` too — a domain that fails three times running,
//     hours apart, is not going to start working on attempt four.
//
// `reclaim_stale_website_analyses` (SQL, migration 1273 + 1298) mirrors this
// exact schedule for rows it reclaims from a crashed/redeployed worker — see
// the comment there. Keep both in sync if this schedule changes.

export type FailureClass = 'permanent' | 'transient'

/** Number of transient attempts (after the first failure) before giving up
 *  permanently. Mirrors the `> 3` check in `reclaim_stale_website_analyses`. */
export const MAX_TRANSIENT_ATTEMPTS = 3

/** Backoff (in minutes) applied after the Nth failure, 1-indexed:
 *  attempt 1 -> 10min, attempt 2 -> 60min, attempt 3 -> 360min. Mirrors the
 *  CASE expression in `reclaim_stale_website_analyses` (migration 1298). */
export const BACKOFF_MINUTES = [10, 60, 360] as const

// Permanent: DNS never resolved, TLS/cert is broken, or the origin told us the
// resource is gone for good. None of these get better with a retry.
const PERMANENT_PATTERNS: RegExp[] = [
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_CERT_[A-Z_]+/i,
  /ERR_SSL_[A-Z_]+/i,
  // HTTP 404/410 "when observable" — i.e. when the failure message names the
  // status explicitly, not a bare "404" that could be a port number or date.
  /\b(?:http|status(?:\s*code)?)\D{0,10}\b(404|410)\b/i,
  /\b(404|410)\D{0,10}(?:not found|gone)\b/i,
]

// Transient: connection hiccups, timeouts, upstream 5xx, and our own
// stale-reclaim message (the worker died mid-run — not the domain's fault).
const TRANSIENT_PATTERNS: RegExp[] = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\b(?:http|status(?:\s*code)?)\D{0,10}\b(50[0-9])\b/i,
  /^Reclaimed:/i,
  /exceeded \d+ minute stale threshold/i,
]

/**
 * Classifies an analyzer error message as `permanent` (never retry, terminal
 * on first occurrence) or `transient` (retry with backoff, terminal after
 * MAX_TRANSIENT_ATTEMPTS).
 *
 * Unrecognized errors default to `transient` — the safe failure mode is a
 * bounded number of retries, not silently killing an account's analysis
 * forever on an error class nobody has seen and classified yet.
 */
export function classifyAnalysisFailure(errorMessage: string): FailureClass {
  const message = errorMessage ?? ''
  if (PERMANENT_PATTERNS.some((re) => re.test(message))) {
    return 'permanent'
  }
  if (TRANSIENT_PATTERNS.some((re) => re.test(message))) {
    return 'transient'
  }
  return 'transient'
}

export interface RetryOutcome {
  /** Terminal status to persist on the `website_analyses` row. */
  status: 'failed' | 'dead'
  /** New cumulative attempt count to persist. */
  attempts: number
  /** When this account becomes eligible again, or null if terminal (`dead`). */
  nextAttemptAt: Date | null
  /** The failure class this outcome was derived from, for logging. */
  failureClass: FailureClass
}

/**
 * Computes what to persist on a `website_analyses` row after a failure.
 *
 * `previousAttempts` is the attempt count carried forward from the account's
 * prior analysis row (0 for a never-attempted or freshly-succeeded account) —
 * see `website_analyzer_candidates.last_attempts` and how the cron carries it
 * into the new row's `attempts` at insert time. This function does not read
 * or write the database; it is pure so the classification and backoff
 * schedule can be unit tested without Playwright or Supabase.
 */
export function computeRetryOutcome(opts: {
  errorMessage: string
  previousAttempts: number
  now: Date
}): RetryOutcome {
  const { errorMessage, now } = opts
  const previousAttempts = Math.max(0, opts.previousAttempts)
  const failureClass = classifyAnalysisFailure(errorMessage)

  if (failureClass === 'permanent') {
    return {
      status: 'dead',
      attempts: previousAttempts + 1,
      nextAttemptAt: null,
      failureClass,
    }
  }

  const attempts = previousAttempts + 1
  if (attempts > MAX_TRANSIENT_ATTEMPTS) {
    return { status: 'dead', attempts, nextAttemptAt: null, failureClass }
  }

  const backoffMinutes = BACKOFF_MINUTES[attempts - 1]
  return {
    status: 'failed',
    attempts,
    nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60_000),
    failureClass,
  }
}
