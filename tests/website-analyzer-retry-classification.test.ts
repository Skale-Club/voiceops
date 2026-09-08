import { describe, expect, it } from 'vitest'
import {
  BACKOFF_MINUTES,
  MAX_TRANSIENT_ATTEMPTS,
  classifyAnalysisFailure,
  computeRetryOutcome,
} from '@/services/website-analyzer/retry-classification'

const NOW = new Date('2026-09-08T12:00:00.000Z')

describe('classifyAnalysisFailure', () => {
  it('classifies ERR_NAME_NOT_RESOLVED as permanent (the gubarbershop.com case)', () => {
    expect(
      classifyAnalysisFailure('net::ERR_NAME_NOT_RESOLVED at https://gubarbershop.com/')
    ).toBe('permanent')
  })

  it('classifies ERR_CERT_* variants as permanent', () => {
    expect(classifyAnalysisFailure('net::ERR_CERT_AUTHORITY_INVALID')).toBe('permanent')
    expect(classifyAnalysisFailure('net::ERR_CERT_COMMON_NAME_INVALID')).toBe('permanent')
    expect(classifyAnalysisFailure('net::ERR_CERT_DATE_INVALID')).toBe('permanent')
  })

  it('classifies an observable HTTP 404/410 as permanent', () => {
    expect(classifyAnalysisFailure('Navigation failed: HTTP 404')).toBe('permanent')
    expect(classifyAnalysisFailure('status code 410 received')).toBe('permanent')
    expect(classifyAnalysisFailure('404 Not Found')).toBe('permanent')
    expect(classifyAnalysisFailure('410 Gone')).toBe('permanent')
  })

  it('does not classify a bare "404" with no HTTP/status context as permanent', () => {
    // e.g. a port number, an unrelated numeric id -- should not be
    // over-matched into killing an analysis for the wrong reason.
    expect(classifyAnalysisFailure('connection refused on port 4041')).not.toBe('permanent')
  })

  it('classifies ECONNRESET as transient', () => {
    expect(classifyAnalysisFailure('read ECONNRESET')).toBe('transient')
  })

  it('classifies a navigation timeout as transient', () => {
    expect(classifyAnalysisFailure('Navigation timeout of 45000 ms exceeded')).toBe('transient')
    expect(classifyAnalysisFailure('Timed out waiting for selector')).toBe('transient')
  })

  it('classifies a 5xx as transient', () => {
    expect(classifyAnalysisFailure('Navigation failed: HTTP 503')).toBe('transient')
    expect(classifyAnalysisFailure('upstream returned status 502')).toBe('transient')
  })

  it('classifies the stale-reclaim message as transient', () => {
    expect(
      classifyAnalysisFailure(
        'Reclaimed: analysis exceeded 10 minute stale threshold (process likely crashed or was redeployed mid-run).'
      )
    ).toBe('transient')
  })

  it('defaults an unrecognized error to transient rather than killing the account outright', () => {
    expect(classifyAnalysisFailure('something completely unexpected happened')).toBe('transient')
  })
})

describe('computeRetryOutcome', () => {
  it('marks a permanent failure dead on the first occurrence, with no next attempt', () => {
    const outcome = computeRetryOutcome({
      errorMessage: 'net::ERR_NAME_NOT_RESOLVED',
      previousAttempts: 0,
      now: NOW,
    })
    expect(outcome).toMatchObject({ status: 'dead', attempts: 1, nextAttemptAt: null, failureClass: 'permanent' })
  })

  it('marks a permanent failure dead even if prior transient attempts already happened', () => {
    const outcome = computeRetryOutcome({
      errorMessage: 'net::ERR_CERT_AUTHORITY_INVALID',
      previousAttempts: 2,
      now: NOW,
    })
    expect(outcome.status).toBe('dead')
    expect(outcome.attempts).toBe(3)
    expect(outcome.nextAttemptAt).toBeNull()
  })

  it('backs off a first transient failure by 10 minutes', () => {
    const outcome = computeRetryOutcome({ errorMessage: 'read ECONNRESET', previousAttempts: 0, now: NOW })
    expect(outcome.status).toBe('failed')
    expect(outcome.attempts).toBe(1)
    expect(outcome.nextAttemptAt?.toISOString()).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString())
  })

  it('backs off a second transient failure by 60 minutes', () => {
    const outcome = computeRetryOutcome({ errorMessage: 'read ECONNRESET', previousAttempts: 1, now: NOW })
    expect(outcome.status).toBe('failed')
    expect(outcome.attempts).toBe(2)
    expect(outcome.nextAttemptAt?.toISOString()).toBe(new Date(NOW.getTime() + 60 * 60_000).toISOString())
  })

  it('backs off a third transient failure by 360 minutes', () => {
    const outcome = computeRetryOutcome({ errorMessage: 'read ECONNRESET', previousAttempts: 2, now: NOW })
    expect(outcome.status).toBe('failed')
    expect(outcome.attempts).toBe(3)
    expect(outcome.nextAttemptAt?.toISOString()).toBe(new Date(NOW.getTime() + 360 * 60_000).toISOString())
  })

  it('goes terminal (dead) after exhausting MAX_TRANSIENT_ATTEMPTS transient failures', () => {
    expect(MAX_TRANSIENT_ATTEMPTS).toBe(3)
    const outcome = computeRetryOutcome({ errorMessage: 'read ECONNRESET', previousAttempts: 3, now: NOW })
    expect(outcome.status).toBe('dead')
    expect(outcome.attempts).toBe(4)
    expect(outcome.nextAttemptAt).toBeNull()
  })

  it('the exported backoff schedule matches the three attempts exercised above', () => {
    expect(BACKOFF_MINUTES).toEqual([10, 60, 360])
  })

  it('treats a negative previousAttempts defensively as zero', () => {
    const outcome = computeRetryOutcome({ errorMessage: 'read ECONNRESET', previousAttempts: -5, now: NOW })
    expect(outcome.attempts).toBe(1)
    expect(outcome.status).toBe('failed')
  })
})
