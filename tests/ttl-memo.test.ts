// In-process TTL memo used on the Vapi tool route's hot path. The contract
// that matters: a fresh hit never calls the function, concurrent misses share
// one call, expiry re-runs it, and a rejection caches nothing.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { memoTtl, clearMemo } from '../src/lib/cache/ttl-memo'

beforeEach(() => {
  clearMemo()
  vi.useRealTimers()
})

describe('memoTtl', () => {
  it('runs the function once within the TTL', async () => {
    const fn = vi.fn(async () => 'v')
    expect(await memoTtl('k', 1000, fn)).toBe('v')
    expect(await memoTtl('k', 1000, fn)).toBe('v')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight call between concurrent misses', async () => {
    let resolve!: (v: string) => void
    const fn = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    const a = memoTtl('k', 1000, fn)
    const b = memoTtl('k', 1000, fn)
    resolve('v')
    expect(await Promise.all([a, b])).toEqual(['v', 'v'])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('re-runs after expiry', async () => {
    vi.useFakeTimers()
    const fn = vi.fn(async () => Date.now())
    const first = await memoTtl('k', 50, fn)
    vi.advanceTimersByTime(60)
    const second = await memoTtl('k', 50, fn)
    expect(second).not.toBe(first)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('caches nothing when the function rejects', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    await expect(memoTtl('k', 1000, fn)).rejects.toThrow('boom')
    expect(await memoTtl('k', 1000, fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keys are independent and clearMemo(prefix) is scoped', async () => {
    const fn = vi.fn(async () => 'v')
    await memoTtl('a:1', 1000, fn)
    await memoTtl('b:1', 1000, fn)
    clearMemo('a:')
    await memoTtl('a:1', 1000, fn)
    await memoTtl('b:1', 1000, fn)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
