import { beforeEach, describe, expect, it } from 'vitest'
import {
  AnalyzerBusyError,
  getAnalyzerLoad,
  withBrowserSlot,
  __resetAnalyzerConcurrencyForTests,
} from '@/services/website-analyzer/concurrency'
import { ANALYSIS_TIMEOUT_MS } from '@/services/website-analyzer/extractor'
import { DEFAULT_STALE_MINUTES } from '@/services/website-analyzer/staleness'

// These assume the built-in defaults (2 concurrent, 8 queued). The module
// reads its limits once at import time, so the tests describe that shape
// rather than trying to re-configure it per case.
const { maxConcurrent, maxQueued } = getAnalyzerLoad()

/** A promise plus the handles to settle it, so a test can hold slots open for
 *  exactly as long as it needs to observe the pool's accounting. */
function deferred() {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let every already-queued microtask run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('website-analyzer concurrency pool', () => {
  beforeEach(() => {
    __resetAnalyzerConcurrencyForTests()
  })

  it('exposes the defaults that keep the shared host alive', () => {
    expect(maxConcurrent).toBe(2)
    expect(maxQueued).toBe(6)
  })

  it('cannot queue for longer than the stale reclaim tolerates', () => {
    // A queued analysis is holding a website_analyses row, and
    // reclaim_stale_website_analyses fails rows untouched for
    // DEFAULT_STALE_MINUTES. If the back of the queue can wait longer than
    // that, the reclaim starts killing work that is merely waiting its turn.
    // This guards the three constants moving independently.
    const worstCaseWaitMs =
      Math.ceil(maxQueued / maxConcurrent) * ANALYSIS_TIMEOUT_MS
    expect(worstCaseWaitMs).toBeLessThan(DEFAULT_STALE_MINUTES * 60_000)
  })

  it('runs work immediately while slots are free', async () => {
    await expect(withBrowserSlot(async () => 'done')).resolves.toBe('done')
    expect(getAnalyzerLoad().active).toBe(0)
  })

  it('never runs more than maxConcurrent at once', async () => {
    const gate = deferred()
    let running = 0
    let peak = 0

    const tasks = Array.from({ length: maxConcurrent + 3 }, () =>
      withBrowserSlot(async () => {
        running++
        peak = Math.max(peak, running)
        await gate.promise
        running--
      })
    )

    await flush()
    expect(peak).toBe(maxConcurrent)
    expect(getAnalyzerLoad().active).toBe(maxConcurrent)
    expect(getAnalyzerLoad().queued).toBe(3)

    gate.resolve()
    await Promise.all(tasks)

    // Everything eventually ran, and never more than the cap at a time.
    expect(peak).toBe(maxConcurrent)
    expect(getAnalyzerLoad().active).toBe(0)
    expect(getAnalyzerLoad().queued).toBe(0)
  })

  it('queues beyond the cap instead of launching, then drains in order', async () => {
    const gate = deferred()
    const order: number[] = []

    const tasks = Array.from({ length: maxConcurrent + 2 }, (_, i) =>
      withBrowserSlot(async () => {
        order.push(i)
        await gate.promise
      })
    )

    await flush()
    expect(order).toEqual([0, 1]) // only the first maxConcurrent started

    gate.resolve()
    await Promise.all(tasks)
    expect(order).toEqual([0, 1, 2, 3]) // FIFO hand-off, nobody skipped
  })

  it('rejects with AnalyzerBusyError once the queue is also full', async () => {
    const gate = deferred()
    const held = Array.from({ length: maxConcurrent + maxQueued }, () =>
      withBrowserSlot(async () => {
        await gate.promise
      })
    )

    await flush()
    expect(getAnalyzerLoad().freeCapacity).toBe(0)

    // This is the caller the cron must not become: it is turned away rather
    // than growing a backlog that can never drain.
    await expect(withBrowserSlot(async () => 'nope')).rejects.toBeInstanceOf(AnalyzerBusyError)

    gate.resolve()
    await Promise.all(held)
    expect(getAnalyzerLoad().freeCapacity).toBe(maxConcurrent + maxQueued)
  })

  it('returns the slot when the work throws', async () => {
    await expect(
      withBrowserSlot(async () => {
        throw new Error('extraction blew up')
      })
    ).rejects.toThrow('extraction blew up')

    expect(getAnalyzerLoad().active).toBe(0)
    expect(getAnalyzerLoad().freeCapacity).toBe(maxConcurrent + maxQueued)
  })

  it('hands a freed slot to a waiter without ever over-subscribing', async () => {
    const first = deferred()
    const second = deferred()
    let running = 0
    let peak = 0

    const track = (gate: Promise<void>) =>
      withBrowserSlot(async () => {
        running++
        peak = Math.max(peak, running)
        await gate
        running--
      })

    const tasks = [track(first.promise), track(first.promise), track(second.promise)]

    await flush()
    expect(running).toBe(maxConcurrent)

    // Releasing the first two must promote the waiter, not double-book.
    first.resolve()
    await flush()
    expect(running).toBe(1)
    expect(peak).toBe(maxConcurrent)

    second.resolve()
    await Promise.all(tasks)
    expect(getAnalyzerLoad().active).toBe(0)
  })

  it('reports freeCapacity as the slots a caller may still claim', async () => {
    const gate = deferred()
    const tasks = Array.from({ length: 3 }, () =>
      withBrowserSlot(async () => {
        await gate.promise
      })
    )

    await flush()
    const load = getAnalyzerLoad()
    expect(load.active + load.queued).toBe(3)
    expect(load.freeCapacity).toBe(maxConcurrent + maxQueued - 3)

    gate.resolve()
    await Promise.all(tasks)
  })
})
