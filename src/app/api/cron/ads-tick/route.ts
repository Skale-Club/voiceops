// src/app/api/cron/ads-tick/route.ts
//
// Nightly maintenance for the Ads module. Two jobs, one tick:
//
// 1. Capture per-campaign daily metrics into ads_insights_daily. Without this
//    the product has no memory of its own: every chart re-queries the platform
//    APIs, disconnecting an account erases its history from the UI, and there
//    is no baseline to compare a week against.
//
// 2. Flag connections whose credential is expiring or already dead. Meta user
//    tokens last ~60 days and nothing used to notice them lapsing — the
//    dashboard, the Copilot and the CAPI fallback token all just started
//    failing with opaque 502s. Marking the row lets the UI ask for a reconnect
//    BEFORE the account goes dark.
//
// Auth: Authorization: Bearer <CRON_SECRET>, mandatory. This endpoint writes,
// and a forged call could mark healthy connections as broken, so it fails
// closed when the secret is unset (same posture as /api/cron/heartbeat).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The snapshot walks every active connection across every org; give it room.
export const maxDuration = 300

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { captureApiError } from '@/lib/api-error'
import { createLogger } from '@/lib/obs/logger'
import { captureDailyInsights } from '@/lib/ads/snapshot-daily'
import { daysUntilExpiry, EXPIRY_WARNING_DAYS } from '@/lib/ads/connection-health'

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

type ConnectionRow = {
  id: string
  org_id: string
  platform: string
  ad_account_id: string
  ad_account_name: string | null
  token_expires_at: string | null
  status: string
}

export async function GET(request: Request): Promise<Response> {
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const log = createLogger({ route: 'api/cron/ads-tick' })
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const url = new URL(request.url)
  const orgId = url.searchParams.get('org_id') ?? undefined
  const skipSnapshot = url.searchParams.get('skip_snapshot') === 'true'

  // ─── 1. Expiry watch ────────────────────────────────────────────────────────
  let expiringSoon = 0
  let expired = 0

  try {
    let q = supabase
      .from('ads_connections')
      .select('id, org_id, platform, ad_account_id, ad_account_name, token_expires_at, status')
      .in('status', ['active', 'available'])
      .not('token_expires_at', 'is', null)
    if (orgId) q = q.eq('org_id', orgId)

    const { data: connections, error } = await q
    if (error) throw new Error(error.message)

    for (const conn of (connections ?? []) as ConnectionRow[]) {
      const days = daysUntilExpiry(conn.token_expires_at)
      if (days === null) continue

      if (days <= 0) {
        expired++
        // Already lapsed: mark it so the dashboard renders a Reconnect prompt
        // instead of letting the next API call fail with a bare 502.
        await supabase
          .from('ads_connections')
          .update({
            status: 'error',
            connection_error: 'The access token expired. Reconnect this account to resume reporting.',
            last_error_at: new Date().toISOString(),
          })
          .eq('id', conn.id)

        log.warn('ads_connection_expired', {
          orgId: conn.org_id,
          platform: conn.platform,
          adAccountId: conn.ad_account_id,
        })
      } else if (days <= EXPIRY_WARNING_DAYS) {
        expiringSoon++
        // Still working — do NOT change status, only record the warning so the
        // UI can show a soft banner while reporting keeps functioning.
        await supabase
          .from('ads_connections')
          .update({
            connection_error: `This access token expires in ${days} day${days === 1 ? '' : 's'}. Reconnect to avoid an interruption.`,
          })
          .eq('id', conn.id)

        log.info('ads_connection_expiring', {
          orgId: conn.org_id,
          platform: conn.platform,
          adAccountId: conn.ad_account_id,
          days,
        })
      }
    }
  } catch (err) {
    log.error('ads_tick_expiry_watch_failed', { error: err })
    captureApiError(err, { route: 'ads-tick', stage: 'expiry-watch' })
  }

  // ─── 2. Daily insight snapshot ──────────────────────────────────────────────
  let snapshotRows = 0
  let snapshotAccounts = 0
  let snapshotErrors = 0

  if (!skipSnapshot) {
    try {
      const results = await captureDailyInsights({ orgId })
      snapshotAccounts = results.length
      for (const r of results) {
        snapshotRows += r.rows
        if (r.error) {
          snapshotErrors++
          log.warn('ads_snapshot_account_failed', {
            orgId: r.orgId,
            platform: r.platform,
            adAccountId: r.adAccountId,
            error: r.error,
          })
        }
      }
    } catch (err) {
      log.error('ads_tick_snapshot_failed', { error: err })
      captureApiError(err, { route: 'ads-tick', stage: 'snapshot' })
      return Response.json({ ok: false, error: 'Snapshot failed', expiringSoon, expired }, { status: 500 })
    }
  }

  log.info('ads_tick_complete', {
    expiringSoon,
    expired,
    snapshotAccounts,
    snapshotRows,
    snapshotErrors,
  })

  return Response.json({
    ok: true,
    expiry: { expiringSoon, expired },
    snapshot: { accounts: snapshotAccounts, rows: snapshotRows, errors: snapshotErrors, skipped: skipSnapshot },
  })
}
