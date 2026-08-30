// src/lib/obs/error-spike.ts
//
// LAYER 3 of three (see docs/TELEGRAM-ALERTS.md). Turns a BURST of
// logger.error() into one ops alert.
//
// Every other signal in /api/cron/obs-alerts names a specific failure someone
// thought to instrument: cost near the cap, a scrape that failed, a cron that
// stopped ticking. This is the net under all of them. Dozens of real failure
// paths — the action engine, Twilio and Resend send failures, token refreshes,
// webhook handlers, the Next error boundaries — only ever reach
// `logger.error(...)`, which forwards to Sentry and to event_logs and stops
// there. That is fine for forensics and useless for being told.
//
// Wired into logger.emit()'s existing `level === 'error'` branch, alongside the
// Sentry and event_logs forwards, so no call site changes and nothing new can
// be forgotten.
//
// ## Why a rate, not an error
//
// Alerting on every error would be unusable: one broken endpoint across several
// orgs produces hundreds a minute, and a channel that floods is a channel that
// gets muted — which costs you the alerts that matter. So this reports a CHANGE
// IN RATE: quiet while errors trickle at their normal background level, one
// message when they jump, naming the events responsible so the message says
// what broke rather than merely that something did.
//
// ## The threshold, measured
//
// Taken from this project's own event_logs (severity='error') over the 30 days
// to 2026-08-30, not inherited from a sibling project:
//
//   143 errors / 30d      = 4.8/day = 0.20/hour
//   5-min windows w/ error: 59 of 8,640 (0.7%)
//   errors per active window: median 3 · p90 3 · max 6
//
// 10 in 5 minutes is ~3x the worst burst actually observed, and would have
// fired ZERO times across those 30 days. That silence is the point: the signal
// is the jump, not the errors. Re-measure before changing it — the query is in
// docs/TELEGRAM-ALERTS.md.
//
// State is per-process and in memory. A restart resets it, which is correct: a
// fresh process has no history to compare against, and a restart is itself
// usually the response to the spike. It also means each container in a rolling
// deploy counts independently, so the effective threshold is per-instance.

import type { Alert } from '@/lib/obs/alerts'

/** Rolling window over which errors are counted. */
const WINDOW_MS = 5 * 60_000

/** Errors within one window before it counts as a spike. See the header. */
const SPIKE_THRESHOLD =
  Number(process.env.ERROR_SPIKE_THRESHOLD) > 0
    ? Math.floor(Number(process.env.ERROR_SPIKE_THRESHOLD))
    : 10

/**
 * Silence after firing. An outage lasts longer than one window, and repeating
 * "still broken" every five minutes is how a channel trains people to ignore
 * it. Thirty minutes is long enough to stay quiet through a deploy-and-recover
 * cycle and short enough that a genuinely worsening incident speaks again.
 */
const COOLDOWN_MS =
  Number(process.env.ERROR_SPIKE_COOLDOWN_MS) > 0
    ? Math.floor(Number(process.env.ERROR_SPIKE_COOLDOWN_MS))
    : 30 * 60_000

/** How many distinct event names the alert names before it stops listing. */
const TOP_EVENTS = 5

/**
 * Events this alert must never count, or it feeds on itself.
 *
 * Delivering the alert calls Telegram and, failing that, Resend. When the spike
 * IS the network or the database being unreachable, that delivery fails and
 * logs its own error — which would count toward the next spike, which would
 * fire another alert, which would fail again. The cooldown alone bounds the
 * loop; excluding the notifier's own failures prevents it from starting.
 */
const SELF_PREFIXES = ['alert_', 'obs_alerts', 'error_spike']

let windowStartedAt = 0
let windowCount = 0
let windowEvents = new Map<string, number>()
let lastAlertAt = 0
/** Re-entrancy guard: errors logged while an alert is in flight don't count. */
let dispatching = false

type Deliver = (alert: Alert) => Promise<unknown>

/** Test seam — production always takes the dynamic import below. */
let deliverOverride: Deliver | null = null
export function __setDeliverForTests(fn: Deliver | null): void {
  deliverOverride = fn
}

/** Test seam — the module is process-global, so tests must be able to reset it. */
export function __resetErrorSpikeStateForTests(): void {
  windowStartedAt = 0
  windowCount = 0
  windowEvents = new Map()
  lastAlertAt = 0
  dispatching = false
}

/** Diagnostics + deterministic unit tests. */
export function getErrorSpikeState(): { windowCount: number; lastAlertAt: number } {
  return { windowCount, lastAlertAt }
}

async function loadDeliver(): Promise<Deliver> {
  if (deliverOverride) return deliverOverride
  // Dynamic import: alerts.ts imports createLogger from logger.ts, and
  // logger.ts calls into this module. A static import here would close that
  // cycle at module-load time.
  const { deliverAlert } = await import('@/lib/obs/alerts')
  return deliverAlert as Deliver
}

/**
 * Records one error and fires the alert when the window crosses the threshold.
 *
 * Synchronous, allocation-light and NEVER throws — it runs inside the logger,
 * on the hot path of every request that fails. The send itself is
 * fire-and-forget.
 */
export function recordError(eventName: string, now = Date.now()): void {
  try {
    if (dispatching) return
    if (SELF_PREFIXES.some((p) => eventName.startsWith(p))) return

    if (now - windowStartedAt > WINDOW_MS) {
      windowStartedAt = now
      windowCount = 0
      windowEvents = new Map()
    }

    windowCount += 1
    windowEvents.set(eventName, (windowEvents.get(eventName) ?? 0) + 1)

    if (windowCount < SPIKE_THRESHOLD) return
    if (now - lastAlertAt < COOLDOWN_MS) return

    lastAlertAt = now
    const topEvents = [...windowEvents.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_EVENTS)
      .map(([name, count]) => `${name} (${count})`)
    const count = windowCount

    // Closing the window here means the next alert measures a FRESH burst
    // rather than re-reporting the same one the moment the cooldown lapses.
    windowStartedAt = now
    windowCount = 0
    windowEvents = new Map()

    dispatching = true
    void (async () => {
      try {
        const deliver = await loadDeliver()
        await deliver({
          key: `errorspike:${Math.floor(now / COOLDOWN_MS)}`,
          title: 'Error spike',
          severity: 'critical',
          fields: {
            errors: count,
            window: `${Math.round(WINDOW_MS / 60_000)}m`,
            threshold: SPIKE_THRESHOLD,
            top: topEvents.join(', ') || '-',
          },
        })
      } catch {
        /* a failing alert channel must never break the caller */
      } finally {
        dispatching = false
      }
    })()
  } catch {
    /* never let alerting break the logger, which never breaks the request */
  }
}
