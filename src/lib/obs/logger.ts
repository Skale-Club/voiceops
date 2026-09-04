// src/lib/obs/logger.ts
// Structured JSON logger with bound context (correlation ids like trace_id / org_id).
// Zero-dependency, Edge- and Node-safe. Emits one JSON object per line to stdout/stderr
// so logs become queryable once shipped (Coolify stdout -> log store).
//
// Usage:
//   import { createLogger } from '@/lib/obs/logger'
//   const log = createLogger({ traceId, orgId, route: '/api/vapi/tools' })
//   log.info('agent_turn_start', { agentId })
//   log.error('tool_failed', { tool, error: err })
//   const child = log.child({ agentId }) // adds / overrides context for downstream logs
//
// Output shape (one line):
//   {"level":"info","event":"agent_turn_start","time":"2026-...Z","traceId":"...","orgId":"...","agentId":"..."}

import { recordError } from '@/lib/obs/error-spike'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

export interface Logger {
  debug(event: string, fields?: LogContext): void
  info(event: string, fields?: LogContext): void
  warn(event: string, fields?: LogContext): void
  error(event: string, fields?: LogContext): void
  /** Returns a new logger with `context` merged on top of the current context. */
  child(context: LogContext): Logger
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function thresholdLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  return LEVELS[raw as LogLevel] ?? LEVELS.info
}

// Make arbitrary values JSON-safe: unwrap Errors, drop `undefined`, guard cycles.
function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((v) => normalize(v, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = normalize(v, seen)
  }
  return out
}

function emit(level: LogLevel, base: LogContext, event: string, fields?: LogContext): void {
  if (LEVELS[level] < thresholdLevel()) return
  const record = { level, event, time: new Date().toISOString(), ...base, ...(fields ?? {}) }
  let line: string
  try {
    line = JSON.stringify(normalize(record, new WeakSet()))
  } catch {
    line = JSON.stringify({ level, event, time: new Date().toISOString(), logError: 'serialize_failed' })
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  // Three-layer model: error-level logs are also persisted to the durable
  // event_logs table (surfaced in /admin/logs) with the shared correlation id,
  // to Sentry for error tracking, and counted by the error-spike detector,
  // which alerts on a jump in the RATE rather than on any single error.
  // Fire-and-forget; dynamic imports keep this module lean for non-error paths.
  if (level === 'error') {
    forwardErrorToEventLogs(base, event, fields)
    forwardErrorToSentry(base, event, fields)
    // Synchronous by design (see error-spike.ts): it only bumps an in-memory
    // counter, and the send it may trigger is itself fire-and-forget. The
    // module has no runtime imports of its own, so this stays Edge-safe.
    recordError(event)
  }
}

function forwardErrorToSentry(base: LogContext, event: string, fields?: LogContext): void {
  try {
    const rawErr = fields?.error
    void import('@sentry/nextjs')
      .then((Sentry) => {
        const context = { tags: { event }, extra: { ...base, ...(fields ?? {}) } }
        if (rawErr instanceof Error) {
          Sentry.captureException(rawErr, context)
        } else {
          Sentry.captureMessage(`${event}${rawErr != null ? `: ${String(rawErr)}` : ''}`, {
            level: 'error',
            ...context,
          })
        }
      })
      .catch(() => {})
  } catch {
    /* never let logging break the caller */
  }
}

function forwardErrorToEventLogs(base: LogContext, event: string, fields?: LogContext): void {
  try {
    const f = { ...(fields ?? {}) }
    const rawErr = f.error
    const errorMessage =
      rawErr instanceof Error ? rawErr.message : rawErr != null ? String(rawErr) : undefined
    delete f.error // keep the durable payload JSON-safe (Error objects don't serialize)
    void import('@/lib/logger')
      .then(({ log }) =>
        log(
          {
            event_type: event,
            source: typeof base.route === 'string' ? base.route : 'app',
            severity: 'error',
            status: 'failed',
            correlation_id: typeof base.traceId === 'string' ? base.traceId : undefined,
            org_id: typeof base.orgId === 'string' ? base.orgId : undefined,
            error_message: errorMessage,
            payload: { ...base, ...f } as Record<string, unknown>,
          },
          // emit() above already forwarded to Sentry and counted this error
          // toward the spike window; log() must not do either again.
          { skipErrorFanout: true },
        ),
      )
      .catch(() => {})
  } catch {
    /* never let logging break the caller */
  }
}

/** Create a structured logger with optional bound context (e.g. correlation ids). */
export function createLogger(context: LogContext = {}): Logger {
  return {
    debug: (event, fields) => emit('debug', context, event, fields),
    info: (event, fields) => emit('info', context, event, fields),
    warn: (event, fields) => emit('warn', context, event, fields),
    error: (event, fields) => emit('error', context, event, fields),
    child: (extra) => createLogger({ ...context, ...extra }),
  }
}
