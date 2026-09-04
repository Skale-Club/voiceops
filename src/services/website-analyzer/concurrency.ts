// Global cap on how many headless Chromium instances the analyzer may hold
// open at once.
//
// WHY THIS EXISTS (incident 2026-08-30): the cron route fired its whole batch
// of 10 analyses fire-and-forget every 10 minutes, and each analysis launched
// its own Chromium. Nothing bounded them, so when analyses ran longer than the
// tick interval the ticks stacked: 74 live browsers / 633 processes / 5.5 GB
// on an 8 GB shared Docker host. RAM and swap were both exhausted, load hit
// 445, xphere's own health check failed, Traefik dropped it from the
// load balancer ("no available server"), and the neighbouring apps plus sshd
// were starved along with it.
//
// The fix is a hard ceiling that every browser launch must pass through,
// regardless of caller — the cron, the public API, or a dashboard action.
// A slow site can now only make the queue longer, never the host slower.
//
// Scope: this is per Node process, which is exactly right today (the
// standalone Next server is a single process per container). If the app is
// ever scaled to multiple replicas the ceiling becomes per-replica, and the
// limit must be divided across them or moved into a shared lock.

/** Concurrent Chromium instances. Each one costs roughly 300-600 MB with the
 *  two contexts the extractor opens, so 2 is the most an 8 GB shared host can
 *  absorb while leaving room for the Next server and its neighbours. */
const MAX_CONCURRENT = readPositiveInt(process.env.WEBSITE_ANALYZER_MAX_CONCURRENT, 2)

/** Callers waiting for a slot. Beyond this the analyzer reports itself busy
 *  instead of growing an unbounded backlog — a queue that can never drain is
 *  just the original bug with extra steps.
 *
 *  The depth is bounded from above by the stale reclaim, not just by taste:
 *  a queued analysis is holding a website_analyses row, and
 *  reclaim_stale_website_analyses fails any row untouched for
 *  DEFAULT_STALE_MINUTES (10). The last caller in line waits about
 *  ceil(MAX_QUEUED / MAX_CONCURRENT) * ANALYSIS_TIMEOUT_MS, so at 6/2/150s
 *  that is 7.5 minutes — comfortably inside the window even if every analysis
 *  ahead of it runs to its hard timeout. Raising this without raising the
 *  stale threshold would let the reclaim fail work that is merely waiting. */
const MAX_QUEUED = readPositiveInt(process.env.WEBSITE_ANALYZER_MAX_QUEUED, 6)

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

let active = 0
let queued = 0
const waiters: Array<() => void> = []

/** Thrown when the analyzer is saturated. Callers should back off and retry on
 *  a later tick rather than piling on — the work is picked up again because
 *  the DB row keeps its pending/stale status. */
export class AnalyzerBusyError extends Error {
  constructor(message = 'Website analyzer is at capacity') {
    super(message)
    this.name = 'AnalyzerBusyError'
  }
}

export interface AnalyzerLoad {
  /** Browsers currently open. */
  active: number
  /** Callers parked waiting for a slot. */
  queued: number
  maxConcurrent: number
  maxQueued: number
  /** Slots a caller may still claim right now without being rejected. */
  freeCapacity: number
}

export function getAnalyzerLoad(): AnalyzerLoad {
  return {
    active,
    queued,
    maxConcurrent: MAX_CONCURRENT,
    maxQueued: MAX_QUEUED,
    freeCapacity: Math.max(0, MAX_CONCURRENT + MAX_QUEUED - (active + queued)),
  }
}

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return
  }
  if (queued >= MAX_QUEUED) {
    throw new AnalyzerBusyError(
      `Website analyzer is at capacity (${active} running, ${queued} queued)`
    )
  }
  queued++
  try {
    // release() hands the slot over directly and leaves `active` incremented,
    // so no other caller can slip into it between the wake-up and the resume.
    await new Promise<void>((resolve) => waiters.push(resolve))
  } finally {
    queued--
  }
}

function release(): void {
  const next = waiters.shift()
  if (next) {
    next() // slot transferred; `active` intentionally stays as-is
    return
  }
  active--
}

/** Run `fn` holding one browser slot. Queues if all slots are taken, and
 *  throws AnalyzerBusyError if the queue is also full. The slot is always
 *  returned, including when `fn` throws. */
export async function withBrowserSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

/** Test-only: drop all accounting back to zero between cases. */
export function __resetAnalyzerConcurrencyForTests(): void {
  active = 0
  queued = 0
  waiters.length = 0
}
