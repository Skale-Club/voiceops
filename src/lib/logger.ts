// src/lib/logger.ts
// AI Logs and Observability — structured event ingestion helper.
//
// Uses the Supabase service-role client so it bypasses RLS and can be called
// from any server-side context (route handlers, server actions, background
// workers, webhook receivers).
//
// Design goals:
//   - Fire-and-forget: never throws, never rejects, never blocks the caller
//   - Zero dependencies beyond @supabase/supabase-js (already a project dep)
//   - Safe to call in webhook hot paths

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { recordError } from '@/lib/obs/error-spike'

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogStatus = 'ok' | 'failed' | 'retried' | 'skipped'

export interface LogOptions {
  /**
   * Skip the Sentry + error-spike fan-out below.
   *
   * Set by src/lib/obs/logger.ts, whose emit() already performed both when it
   * routed an error here for durable storage. Without this, every
   * createLogger().error() would be counted twice by the spike detector and
   * sent to Sentry twice.
   */
  skipErrorFanout?: boolean
}

export interface LogEntry {
  /** Dot-namespaced event name, e.g. 'action.executed', 'webhook.received' */
  event_type: string
  /** Origin subsystem, e.g. 'action-engine', 'vapi-webhook', 'meta-webhook', 'cron' */
  source: string
  severity?: LogSeverity
  status?: LogStatus
  /** Org this event belongs to — omit for platform-level events */
  org_id?: string
  /** UUID correlating related events within one request or run */
  correlation_id?: string
  /** 'system' | 'user' | 'agent' | 'webhook' */
  actor_type?: string
  actor_id?: string
  payload?: Record<string, unknown>
  error_message?: string
  duration_ms?: number
}

/**
 * Reports a durable error row to Sentry. Mirrors the forward in
 * src/lib/obs/logger.ts: dynamic import so non-error paths never pull the SDK,
 * and never throws — a failing error tracker must not break the caller.
 */
function forwardToSentry(entry: LogEntry): void {
  try {
    void import('@sentry/nextjs')
      .then((Sentry) => {
        Sentry.captureMessage(
          entry.error_message ? `${entry.event_type}: ${entry.error_message}` : entry.event_type,
          {
            level: entry.severity === 'fatal' ? 'fatal' : 'error',
            tags: { event: entry.event_type, source: entry.source },
            extra: {
              org_id: entry.org_id,
              correlation_id: entry.correlation_id,
              duration_ms: entry.duration_ms,
              ...(entry.payload ?? {}),
            },
          },
        )
      })
      .catch(() => {})
  } catch {
    /* never let logging break the caller */
  }
}

// Lazily instantiated so the service-role key is not required at import time
// (e.g. in unit tests that don't exercise the DB path).
let _client: ReturnType<typeof createClient<Database>> | null = null

function getServiceClient(): ReturnType<typeof createClient<Database>> {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      // Return a dummy that will silently fail on any operation
      // (allows tests without real credentials to import this module).
      return createClient<Database>('http://localhost', 'dummy', {
        auth: { persistSession: false },
      })
    }
    _client = createClient<Database>(url, key, {
      auth: { persistSession: false },
    })
  }
  return _client
}

/**
 * Append a structured event to the event_logs table.
 *
 * Never throws — all errors are swallowed so the caller's hot path is not
 * disrupted by logging failures.
 */
export async function log(entry: LogEntry, opts?: LogOptions): Promise<void> {
  // An error written straight to event_logs used to stop there: it never
  // reached Sentry and never counted toward an alert. That was not a
  // theoretical gap — over the 30 days to 2026-08-30, 143 of these rows were
  // written (130 of them `action.failed`, mostly Twilio rejecting SMS to an
  // unenabled region) while Sentry recorded zero events for the project and
  // nothing ever alerted. Fanning out here rather than at the five call sites
  // means the Stripe webhook, the Vapi call handler, the action engine, the
  // GHL re-engagement runner and the credits ledger are all covered, and a
  // sixth caller added later is covered by default.
  if ((entry.severity === 'error' || entry.severity === 'fatal') && !opts?.skipErrorFanout) {
    forwardToSentry(entry)
    // Synchronous counter bump; the send it may trigger is fire-and-forget.
    recordError(entry.event_type)
  }
  try {
    const supabase = getServiceClient()
    const { error } = await supabase.from('event_logs').insert({
      event_type: entry.event_type,
      source: entry.source,
      severity: entry.severity ?? 'info',
      status: entry.status ?? 'ok',
      org_id: entry.org_id ?? null,
      correlation_id: entry.correlation_id ?? null,
      actor_type: entry.actor_type ?? null,
      actor_id: entry.actor_id ?? null,
      payload: (entry.payload as Database['public']['Tables']['event_logs']['Insert']['payload']) ?? {},
      error_message: entry.error_message ?? null,
      duration_ms: entry.duration_ms ?? null,
    })
    if (error) {
      // Emit to stderr so ops tooling can surface DB write failures without
      // propagating them to the caller.
      console.error('[logger] event_logs insert failed:', error.message)
    }
  } catch (err) {
    // Absolute safety net — swallow everything
    console.error('[logger] unexpected error in log():', err)
  }
}
