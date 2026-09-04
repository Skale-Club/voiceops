// tests/idempotency-abandoned-coverage.test.ts
//
// PERF-03 coverage, not mechanism.
//
// Phase 133 built abandoned-ownership recording correctly and wired it into
// exactly one call site: the Vapi tool webhook. An independent verification of
// that phase found the gap — `run-agent.ts` (blocking and streaming) and
// `build-workflow-tools.ts` all derive idempotency keys for side-effecting
// actions and all have failure handling, and none of them recorded
// abandonment. An agent-driven side-effecting call that timed out left no
// ownership marker, so a later retry saw a free slot.
//
// That is the same shape as the Xkedule gap: a mechanism that is correct and
// never reached. These tests pin the reach, because the mechanism's own tests
// could not have caught it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAbortLikeError } from '@/lib/agent-runtime/idempotency'

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8').replace(/\r\n/g, '\n')
}

describe('isAbortLikeError', () => {
  it('recognises the DOM abort and timeout error names', () => {
    const abort = new Error('whatever')
    abort.name = 'AbortError'
    const timeout = new Error('whatever')
    timeout.name = 'TimeoutError'
    expect(isAbortLikeError(abort)).toBe(true)
    expect(isAbortLikeError(timeout)).toBe(true)
  })

  it('recognises timeout wording in the message when the name is generic', () => {
    expect(isAbortLikeError(new Error('The operation timed out'))).toBe(true)
    expect(isAbortLikeError(new Error('request timeout after 15000ms'))).toBe(true)
    expect(isAbortLikeError(new Error('aborted'))).toBe(true)
  })

  it('does not classify an ordinary failure as abort-like', () => {
    expect(isAbortLikeError(new Error('Invalid customer id'))).toBe(false)
    expect(isAbortLikeError(new Error('403 Forbidden'))).toBe(false)
  })

  it('returns false for non-Error values rather than throwing', () => {
    expect(isAbortLikeError(null)).toBe(false)
    expect(isAbortLikeError(undefined)).toBe(false)
    expect(isAbortLikeError('timed out')).toBe(false)
    expect(isAbortLikeError({ name: 'AbortError' })).toBe(false)
  })

  it('errs toward recording rather than skipping, which is the safe direction', () => {
    // Over-recording marks a slot abandoned, so a retry refuses. Under-recording
    // leaves the slot free, so a retry double-executes. If this classifier is
    // ever tightened, keep that asymmetry in mind.
    expect(isAbortLikeError(new Error('upstream aborted the connection'))).toBe(true)
  })
})

describe('every path that guards a side-effecting action also records abandonment', () => {
  const runAgent = readSource('src/lib/agent-runtime/run-agent.ts')
  const workflowTools = readSource('src/lib/agent-runtime/build-workflow-tools.ts')
  const vapiRoute = readSource('src/app/api/vapi/tools/route.ts')

  it('the Vapi tool webhook records abandonment (the original call site)', () => {
    expect(vapiRoute).toMatch(/recordAbandonedIdempotency\(/)
  })

  it('the blocking agent tool loop records abandonment on an abort', () => {
    expect(runAgent).toMatch(/isAbortLikeError\(err\)[\s\S]{0,200}?recordAbandonedIdempotency\(/)
  })

  it('the streaming agent tool loop records abandonment on an abort', () => {
    expect(runAgent).toMatch(/isAbortLikeError\(errStream\)[\s\S]{0,200}?recordAbandonedIdempotency\(/)
  })

  it('the workflow tool path records abandonment on a timed-out dispatch', () => {
    // This path signals a timeout with a flag rather than by throwing, so it
    // needs its own check and would not be covered by the abort classifier.
    expect(workflowTools).toMatch(/dispatched\.timed_out[\s\S]{0,300}?recordAbandonedIdempotency\(/)
  })

  it('records abandonment before returning, never after recording success', () => {
    // If the success receipt landed first, the row would say "completed" for
    // work that never completed.
    const abandonedAt = workflowTools.indexOf('recordAbandonedIdempotency(')
    const recordedAt = workflowTools.indexOf('recordIdempotency({')
    expect(abandonedAt).toBeGreaterThan(-1)
    expect(recordedAt).toBeGreaterThan(-1)
    expect(abandonedAt).toBeLessThan(recordedAt)
  })
})
