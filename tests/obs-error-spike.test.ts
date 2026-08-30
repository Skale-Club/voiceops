import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  recordError,
  getErrorSpikeState,
  __setDeliverForTests,
  __resetErrorSpikeStateForTests,
} from '@/lib/obs/error-spike'

/** Lets the fire-and-forget dispatch inside recordError() settle. */
const flush = () => new Promise((r) => setTimeout(r, 0))

const THRESHOLD = 10
const WINDOW_MS = 5 * 60_000
const COOLDOWN_MS = 30 * 60_000
// A real wall-clock base. A synthetic timestamp smaller than COOLDOWN_MS would
// make the initial `lastAlertAt = 0` look like a recent alert and suppress the
// first spike — an artefact of the test clock, not of the detector.
const BASE = 1_800_000_000_000

describe('error spike detector', () => {
  let delivered: Array<{ key: string; title: string; fields?: Record<string, unknown> }>

  beforeEach(() => {
    __resetErrorSpikeStateForTests()
    delivered = []
    __setDeliverForTests(async (alert) => {
      delivered.push(alert as (typeof delivered)[number])
    })
  })

  it('stays quiet below the threshold', async () => {
    const t = BASE
    for (let i = 0; i < THRESHOLD - 1; i++) recordError('twilio.send_failed', t + i)
    await flush()
    expect(delivered).toHaveLength(0)
    expect(getErrorSpikeState().windowCount).toBe(THRESHOLD - 1)
  })

  it('fires exactly once when the window crosses the threshold', async () => {
    const t = BASE
    for (let i = 0; i < THRESHOLD; i++) recordError('twilio.send_failed', t + i)
    await flush()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].title).toBe('Error spike')
    expect(delivered[0].fields?.errors).toBe(THRESHOLD)
  })

  it('names the events responsible, most frequent first', async () => {
    const t = BASE
    for (let i = 0; i < 7; i++) recordError('twilio.send_failed', t + i)
    for (let i = 0; i < 3; i++) recordError('google.token_refresh_failed', t + 10 + i)
    await flush()
    expect(delivered).toHaveLength(1)
    const top = String(delivered[0].fields?.top)
    expect(top).toMatch(/^twilio\.send_failed \(7\)/)
    expect(top).toContain('google.token_refresh_failed (3)')
  })

  // The rule that keeps the channel worth reading: an outage lasts longer than
  // one window, and repeating "still broken" every five minutes is how a
  // channel trains people to ignore it.
  it('stays silent through the cooldown, then speaks again after it', async () => {
    const t = BASE
    for (let i = 0; i < THRESHOLD; i++) recordError('boom', t + i)
    await flush()
    expect(delivered).toHaveLength(1)

    // A second full burst inside the cooldown must not produce a message.
    const during = t + COOLDOWN_MS - 1000
    for (let i = 0; i < THRESHOLD; i++) recordError('boom', during + i)
    await flush()
    expect(delivered).toHaveLength(1)

    // Past the cooldown, a genuinely continuing incident speaks again.
    const after = t + COOLDOWN_MS + 1000
    for (let i = 0; i < THRESHOLD; i++) recordError('boom', after + i)
    await flush()
    expect(delivered).toHaveLength(2)
  })

  it('resets the count when the window lapses, so a trickle never accumulates', async () => {
    const t = BASE
    // The measured background rate is 4.8 errors/DAY. Nine errors spread across
    // separate windows must never add up to a spike.
    for (let i = 0; i < 9; i++) recordError('background', t + i * (WINDOW_MS + 1))
    await flush()
    expect(delivered).toHaveLength(0)
    expect(getErrorSpikeState().windowCount).toBe(1)
  })

  it('ignores its own delivery failures, so the alert cannot feed on itself', async () => {
    const t = BASE
    for (let i = 0; i < THRESHOLD * 2; i++) recordError('alert_channel_failed', t + i)
    await flush()
    expect(delivered).toHaveLength(0)
    expect(getErrorSpikeState().windowCount).toBe(0)
  })

  it('never throws, even when the delivery channel rejects', async () => {
    __setDeliverForTests(async () => {
      throw new Error('telegram unreachable')
    })
    const t = BASE
    expect(() => {
      for (let i = 0; i < THRESHOLD; i++) recordError('boom', t + i)
    }).not.toThrow()
    await flush()
  })

  it('does not count errors logged while an alert is in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    __setDeliverForTests(async () => {
      await gate
    })
    const t = BASE
    for (let i = 0; i < THRESHOLD; i++) recordError('boom', t + i)
    // Dispatch is open; these must be dropped rather than counted.
    for (let i = 0; i < 5; i++) recordError('boom', t + 100 + i)
    expect(getErrorSpikeState().windowCount).toBe(0)
    release()
    await flush()
  })

  afterEach(() => {
    __setDeliverForTests(null)
    vi.restoreAllMocks()
  })
})
