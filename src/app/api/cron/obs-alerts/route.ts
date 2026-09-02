// O3: observability alerting cron.
// Invoked by .github/workflows/obs-alerts.yml (hourly). Checks existing signals
// cross-org and posts deduped alerts:
//   1. Agent cost near the daily cap (>= 80%)
//   2. Google Reviews scrape failures (error / quota_exceeded)
//   3. High agent error rate in the last hour. NOTE: dormant as of 2026-08-30.
//      agent_invocations saw 9 rows in 30 days (all successful) and peaks at 4
//      per hour, while errorRateBreached() needs >= 20 in one hour before it
//      will look at the ratio at all — so this signal cannot currently fire.
//      Left in place because it is correct and costs nothing; it starts working
//      on its own if agent traffic grows. Signal 5 is what actually covers
//      failures at today's volumes.
//   4. Stale cron heartbeats (a scheduled job stopped ticking, e.g. the VPS
//      cron container died silently). `cron_heartbeats` is fed by jobs from
//      several apps that share this ops hub (xphere, xkedule, skaleclub,
//      xtimator, ...), not just xphere, so this signal is delivered to an
//      ops-wide Telegram destination (TELEGRAM_BOT_TOKEN_OPS /
//      TELEGRAM_ALERT_CHAT_ID_OPS) when configured, falling back to this
//      app's own bot/chat otherwise - see src/lib/obs/alerts.ts.
//   5. Workflow runs failing, grouped by cause (last 24h)
//
// Delivery: each candidate alert is dispatched via deliverAlert() (src/lib/obs/alerts.ts),
// which tries Telegram first when a destination is configured, then always
// falls through to email (PLATFORM_ADMIN_EMAIL via sendPlatformEmail) - email
// is the always-available floor, since it needs no human setup, unlike a
// Telegram bot/chat. The route only skips entirely when *no* channel at all
// is configured (anyAlertChannelConfigured() below). As of 2026-08-30 both
// channels exist in production: TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID
// point at @xphereoppsbot, so Telegram carries the alerts and email is now
// only the fallback for when Telegram itself fails. The JSON response reports
// which channels were armed for this run (`channels`) so that's verifiable
// from a plain curl.
//
// Caller sends CRON_SECRET as `Authorization: Bearer`. No-ops cleanly when no
// alert channel is configured at all, so it is safe to schedule before either
// channel's secrets are configured.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createLogger } from '@/lib/obs/logger'
import {
  type Alert,
  alertEmailConfigured,
  alreadyAlerted,
  anyAlertChannelConfigured,
  costBreached,
  costSeverity,
  deliverAlert,
  errorRateBreached,
  opsTelegramConfigured,
  recordAlert,
  resolveOpsTelegramDestination,
} from '@/lib/obs/alerts'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_DAILY_CAP_USD = parseFloat(process.env.AGENT_DAILY_COST_CAP_USD ?? '50')

export async function GET(request: Request): Promise<Response> {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const log = createLogger({ route: 'api/cron/obs-alerts' })
  // Only skip entirely when there is truly nowhere to send an alert. Email
  // (alertEmailConfigured()) is the always-available floor - it needs no
  // human setup - so this route now actually evaluates all four signals
  // whenever *any* channel exists, even with no TELEGRAM_* vars set.
  const channels = { telegram: opsTelegramConfigured(), email: alertEmailConfigured() }
  if (!anyAlertChannelConfigured()) {
    return Response.json({
      ok: true,
      skipped:
        'No alert channel configured (TELEGRAM_BOT_TOKEN/TELEGRAM_ALERT_CHAT_ID, TELEGRAM_BOT_TOKEN_OPS/TELEGRAM_ALERT_CHAT_ID_OPS, or PLATFORM_ADMIN_EMAIL)',
      channels,
    })
  }

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const dedupe = supabase as unknown as SupabaseClient
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const hourBucket = new Date(now).toISOString().slice(0, 13)
  const candidates: Alert[] = []

  // 1. Cost near daily cap (24h, per org) ────────────────────────────────────
  const since24h = new Date(now - 24 * 3_600_000).toISOString()
  const { data: costRows } = await supabase
    .from('agent_invocations')
    .select('organization_id, cost_usd')
    .gte('created_at', since24h)
    .not('cost_usd', 'is', null)

  const costByOrg = new Map<string, number>()
  for (const r of costRows ?? []) {
    costByOrg.set(r.organization_id, (costByOrg.get(r.organization_id) ?? 0) + Number(r.cost_usd ?? 0))
  }

  if (costByOrg.size > 0) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name, daily_cost_cap_usd_override')
      .in('id', [...costByOrg.keys()])
    const orgMeta = new Map((orgs ?? []).map((o) => [o.id, o]))

    for (const [orgId, cost] of costByOrg) {
      const meta = orgMeta.get(orgId)
      const cap = meta?.daily_cost_cap_usd_override != null
        ? Number(meta.daily_cost_cap_usd_override)
        : DEFAULT_DAILY_CAP_USD
      if (!costBreached(cost, cap)) continue
      const pct = Math.round((cost / cap) * 100)
      candidates.push({
        key: `cost:${orgId}:${today}`,
        title: 'Agent cost near daily cap',
        severity: costSeverity(pct),
        fields: {
          org: meta?.name ?? orgId,
          spent: `$${cost.toFixed(2)}`,
          cap: `$${cap.toFixed(2)}`,
          used: `${pct}%`,
        },
      })
    }
  }

  // 2. Google Reviews scrape failures (last 25h) ─────────────────────────────
  const since25h = new Date(now - 25 * 3_600_000).toISOString()
  const { data: scrapeFails } = await supabase
    .from('google_business_profiles')
    .select('id, business_name, last_scrape_status, last_scrape_error, last_scraped_at')
    .in('last_scrape_status', ['error', 'quota_exceeded'])
    .gte('last_scraped_at', since25h)

  for (const p of scrapeFails ?? []) {
    candidates.push({
      key: `scrape:${p.id}:${p.last_scraped_at}`,
      title: 'Google Reviews scrape failed',
      severity: p.last_scrape_status === 'quota_exceeded' ? 'warning' : 'critical',
      fields: {
        business: p.business_name ?? p.id,
        status: p.last_scrape_status ?? 'unknown',
        error: (p.last_scrape_error ?? '').slice(0, 140) || '-',
      },
    })
  }

  // 3. Agent error rate (last hour) ──────────────────────────────────────────
  const since1h = new Date(now - 3_600_000).toISOString()
  const { data: invs } = await supabase
    .from('agent_invocations')
    .select('status')
    .gte('created_at', since1h)
    .neq('status', 'running')

  const total = invs?.length ?? 0
  const errors = (invs ?? []).filter((i) => i.status === 'error' || i.status === 'aborted').length
  if (errorRateBreached(total, errors)) {
    candidates.push({
      key: `errorrate:${hourBucket}`,
      title: 'High agent error rate (last hour)',
      severity: 'critical',
      fields: { errors, total, rate: `${Math.round((errors / total) * 100)}%` },
    })
  }

  // 4. Cron heartbeat staleness (external cron runner on the Hetzner VPS) ────
  // `cron_heartbeats` is written by src/app/api/cron/heartbeat/route.ts (owned
  // by a concurrent change) and isn't in the generated Database types yet, so
  // this goes through the untyped `dedupe` client, same as obs_alert_log.
  interface CronHeartbeatRow {
    job_name: string
    last_run_at: string
    last_ok_at: string | null
    last_status: number | null
    last_duration_ms: number | null
    last_error: string | null
    expected_interval_seconds: number
    consecutive_failures: number
    updated_at: string
  }

  const { data: heartbeats } = await dedupe
    .from('cron_heartbeats')
    .select(
      'job_name, last_run_at, last_ok_at, last_status, last_duration_ms, last_error, expected_interval_seconds, consecutive_failures, updated_at',
    )

  for (const h of (heartbeats ?? []) as CronHeartbeatRow[]) {
    const intervalSeconds = h.expected_interval_seconds ?? 300
    // A job is stale once it's gone 3x its expected interval without a
    // successful run - the multiplier absorbs normal scheduling jitter (a
    // tick that's a little late isn't an outage). Never alert under ~10
    // minutes so high-frequency jobs don't fire on a single slow tick.
    const staleThresholdSeconds = Math.max(intervalSeconds * 3, 600)
    const criticalThresholdSeconds = intervalSeconds * 6

    const lastOkMs = h.last_ok_at ? new Date(h.last_ok_at).getTime() : null
    const staleForSeconds = lastOkMs != null ? (now - lastOkMs) / 1000 : Infinity
    if (staleForSeconds < staleThresholdSeconds) continue

    const minutesSinceOk = lastOkMs != null ? Math.round((now - lastOkMs) / 60_000) : null
    // Bucketed to 3h (not the 1h `hourBucket` used elsewhere) so the key
    // itself stays stable across the 180-minute re-alert window below - if it
    // changed every hour like `hourBucket`, alreadyAlerted() would never see
    // a repeat and this would page every hour instead of every 3h.
    const staleBucket = Math.floor(now / (180 * 60_000))
    candidates.push({
      key: `cronstale:${h.job_name}:${staleBucket}`,
      // job_name carries the reporting job's own app/project prefix (this
      // table is fed by several apps sharing this ops hub) - put it in the
      // title, not just `fields`, so it's obvious at a glance in Telegram
      // which app is actually broken.
      title: `Cron heartbeat stale: ${h.job_name}`,
      severity:
        staleForSeconds > criticalThresholdSeconds || h.consecutive_failures >= 5 ? 'critical' : 'warning',
      fields: {
        job: h.job_name,
        since_last_ok: minutesSinceOk != null ? `${minutesSinceOk}m ago` : 'never',
        last_status: h.last_status ?? 'unknown',
        consecutive_failures: h.consecutive_failures,
        last_error: (h.last_error ?? '').slice(0, 140) || '-',
      },
    })
  }

  // 5. Failed workflow runs (last 24h, grouped by cause) ─────────────────────
  // The gap this closes: over the 30 days to 2026-08-30, 98 of 110 workflow
  // runs failed — a steady 3/day, every day — and nothing alerted, because no
  // signal here looked at this table at all. 90 of those were Twilio rejecting
  // SMS (21408 unenabled region, 21211 invalid number); the rest were an
  // expired Google token and a missing Telegram bot. All of them silent.
  //
  // Since 2026-09-02 those two Twilio codes no longer reach this signal at
  // all: send-sms.ts classifies permanent destination rejections as
  // SmsUndeliverableError and the action engine records a structured skip
  // instead of failing the run (an account-level cause such as 21408 is
  // surfaced as `degraded` on the Twilio integration). The calendar-tick
  // scanner also stopped re-firing the same time-based trigger every night.
  // What is left here is what a retry or a human can actually fix.
  //
  // Deliberately NOT a rate: this table sees ~0.15 runs/hour, so an
  // errorRateBreached()-style ratio can never accumulate enough volume to fire
  // (the same reason signal 3 above is currently dormant). What works at this
  // volume is a COUNT grouped by cause, alerted once per distinct cause per
  // day. A chronic failure then pages once daily while it is genuinely broken
  // and goes silent the moment it is fixed, instead of either flooding or
  // saying nothing.
  interface WorkflowRunRow {
    error: string | null
    workflow_id: string | null
  }

  const { data: failedRuns } = await dedupe
    .from('workflow_runs')
    .select('error, workflow_id')
    .eq('status', 'failed')
    .gte('created_at', new Date(now - 24 * 3_600_000).toISOString())
    .limit(1000)

  // Collapse the variable parts so one broken integration is one cause, not one
  // per phone number: digits become '#' and the message is capped. Without this
  // each rejected number would look like a distinct failure and alert
  // separately — 90 alerts a month instead of one a day.
  const causeOf = (raw: string | null): string =>
    (raw ?? 'unknown error').replace(/\d/g, '#').slice(0, 80)

  const runsByCause = new Map<string, { count: number; sample: string }>()
  for (const r of (failedRuns ?? []) as WorkflowRunRow[]) {
    const cause = causeOf(r.error)
    const prev = runsByCause.get(cause)
    runsByCause.set(cause, {
      count: (prev?.count ?? 0) + 1,
      sample: prev?.sample ?? (r.error ?? 'unknown error').slice(0, 180),
    })
  }

  for (const [cause, { count, sample }] of runsByCause) {
    // The cause is already digit-masked and length-capped, so it is a stable
    // dedupe key across the day without needing a hash.
    candidates.push({
      key: `wfrun:${cause}:${today}`,
      title: 'Workflow runs failing',
      severity: count >= 10 ? 'critical' : 'warning',
      fields: {
        failures_24h: count,
        error: sample,
      },
    })
  }

  // Dedupe + deliver ─────────────────────────────────────────────────────────
  // Window: cost re-alerts at most every 6h; scrape per failure once/24h;
  // error rate once per hour bucket; cron staleness every 3h (long enough
  // not to spam hourly, short enough to keep reminding on-call).
  //
  // `cronstale:` alerts go to the ops-wide Telegram destination (falls back
  // to this app's own bot/chat when TELEGRAM_*_OPS is unset) since the job
  // that went stale may belong to any app on this ops hub, not just xphere.
  // Signals 1-3 keep using deliverAlert(alert) with no destination override,
  // i.e. exactly their prior Telegram-targeting behaviour, now also falling
  // through to email. Every candidate is delivered via deliverAlert() rather
  // than sendTelegramAlert() directly, so email is always tried too.
  const opsDestination = resolveOpsTelegramDestination() ?? undefined
  let sent = 0
  for (const alert of candidates) {
    const windowMinutes = alert.key.startsWith('cost:')
      ? 360
      : alert.key.startsWith('scrape:') || alert.key.startsWith('wfrun:')
        ? 1440
        : alert.key.startsWith('cronstale:')
          ? 180
          : 60
    if (await alreadyAlerted(dedupe, alert.key, windowMinutes)) continue
    const telegramDestination = alert.key.startsWith('cronstale:') ? opsDestination : undefined
    if (await deliverAlert(alert, { telegramDestination })) {
      await recordAlert(dedupe, alert.key)
      sent++
    }
  }

  log.info('obs_alerts_run', { candidates: candidates.length, sent, channels })
  return Response.json({ ok: true, candidates: candidates.length, sent, channels })
}
