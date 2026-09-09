// Connection health for ad-platform accounts.
//
// Meta user tokens are long-lived but not permanent — they expire ~60 days
// after the grant, and Meta also invalidates them when the user changes their
// password, revokes the app, or the account's business permissions change.
// Nothing used to notice: `token_expires_at` was written at connect time and
// never read again, and a 190 from the Graph API surfaced as a generic 502.
// The dashboard, the Copilot and the CAPI worker just started failing.
//
// This module is the one place that decides "this connection is broken", so
// every caller (routes, AI tools, the expiry cron) marks it the same way and
// the UI has a single signal to render a Reconnect prompt from.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { MetaAdsError } from './meta-api'
import { GoogleAdsError } from './google-api'

export type AdsPlatform = 'meta' | 'google'

export type ConnectionStatus = 'active' | 'available'
export type ConnectionHealthState = 'ok' | 'error'

/**
 * TypeScript mirror of the `usable` generated column added by migration 1300
 * (`status = 'active' AND health = 'ok'`). The generated column itself can
 * only be exercised against a live database, so this pure function is what
 * every non-DB test (and any code that needs the rule before a row round
 * -trips through Postgres) checks against instead. Keep this in sync with
 * the migration if the rule ever changes.
 */
export function computeUsable(status: string, health: string): boolean {
  return status === 'active' && health === 'ok'
}

/** Meta error codes that mean "the token is no longer usable". */
const META_AUTH_CODES = new Set([102, 190, 463, 467])

/** Meta subcodes under code 190 that specifically indicate expiry/revocation. */
const META_AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 466, 467, 492])

/** Does this error mean the stored credential is dead (vs. a transient fault)? */
export function isAuthError(error: unknown): boolean {
  if (error instanceof MetaAdsError) {
    if (error.code != null && META_AUTH_CODES.has(error.code)) return true
    if (error.subcode != null && META_AUTH_SUBCODES.has(error.subcode)) return true
    return false
  }
  if (error instanceof GoogleAdsError) {
    if (error.code === 'UNAUTHENTICATED' || error.code === 'PERMISSION_DENIED') return true
    return /invalid_grant|invalid_client|unauthorized|token has been expired or revoked/i.test(error.message)
  }
  if (error instanceof Error) {
    return /invalid_grant|token has been expired or revoked|did not return a refresh_token/i.test(error.message)
  }
  return false
}

/** Human-readable reason stored on the connection so the UI can explain itself. */
function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 500)
  return 'The stored credential was rejected by the platform.'
}

/**
 * Mark a connection as needing reconnection. Idempotent and non-throwing —
 * callers invoke it from catch blocks and must not fail because of it.
 *
 * Uses the service-role client because it is also called from cron and worker
 * contexts that have no authenticated user; the org_id filter keeps the write
 * scoped to exactly the row that failed.
 *
 * Writes `health` only. `status` is the admin's active/available selection —
 * this function must never touch it, or a broken credential silently hides
 * (or a hidden account silently reappears) the way it used to when the two
 * were the same column. See docs/integrations/ads-connection-health-plan.md.
 */
export async function markConnectionError(params: {
  orgId: string
  platform: AdsPlatform
  adAccountId: string
  error: unknown
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    await supabase
      .from('ads_connections')
      .update({
        health: 'error',
        connection_error: describe(params.error),
        last_error_at: new Date().toISOString(),
      })
      .eq('org_id', params.orgId)
      .eq('platform', params.platform)
      .eq('ad_account_id', params.adAccountId)
  } catch {
    /* health bookkeeping must never break the caller's error path */
  }
}

/**
 * Clear a previously-recorded error after a successful call. Only touches rows
 * that are actually unhealthy, so an already-healthy row's last_verified_at
 * isn't churned on every call.
 *
 * Writes `health` only — never `status`. Recovering from an error must not
 * force a hidden ('available') account back to 'active'; the admin's
 * selection is untouched either way. See markConnectionError above.
 */
export async function markConnectionHealthy(params: {
  orgId: string
  platform: AdsPlatform
  adAccountId: string
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    await supabase
      .from('ads_connections')
      .update({
        health: 'ok',
        connection_error: null,
        last_error_at: null,
        last_verified_at: new Date().toISOString(),
      })
      .eq('org_id', params.orgId)
      .eq('platform', params.platform)
      .eq('ad_account_id', params.adAccountId)
      .eq('health', 'error')
  } catch {
    /* best-effort */
  }
}

/**
 * Run `operation`, marking the connection unhealthy when the platform rejects
 * the credential and healthy again when a previously-failing account recovers.
 * Non-auth errors (rate limits, upstream 500s) pass through untouched — those
 * are transient and must not trigger a Reconnect prompt.
 */
export async function withConnectionHealth<T>(
  params: { orgId: string; platform: AdsPlatform; adAccountId: string },
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation()
    void markConnectionHealthy(params)
    return result
  } catch (error) {
    if (isAuthError(error)) {
      await markConnectionError({ ...params, error })
    }
    throw error
  }
}

/**
 * Convenience wrapper around `withConnectionHealth` for Meta call sites.
 * `meta-api.ts` functions take `(adAccountId, accessToken)` and don't know
 * the org, so every caller has to hand-assemble `{ orgId, platform: 'meta',
 * adAccountId }` itself. Phase 4 needed this at four call sites (two each in
 * `lib/copilot/tools/ads.ts` and `lib/mcp/tools/ads.ts`, which mirror each
 * other function-for-function) — hand-rolling the object literal four times
 * is exactly the kind of repetition that drifts (e.g. a copy-paste that
 * keeps the wrong platform), so it is factored here once instead. Route
 * handlers that already have their own `{ orgId, platform, adAccountId }`
 * value in scope (api/ads/meta/campaigns, api/ads/meta/reports) keep calling
 * `withConnectionHealth` directly — there is nothing to save there.
 */
export function withMetaConnection<T>(
  orgId: string,
  adAccountId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withConnectionHealth({ orgId, platform: 'meta', adAccountId }, operation)
}

/** Days until a stored token expires, or null when there is no expiry on file. */
export function daysUntilExpiry(tokenExpiresAt: string | null, now = new Date()): number | null {
  if (!tokenExpiresAt) return null
  const expiry = new Date(tokenExpiresAt)
  if (Number.isNaN(expiry.getTime())) return null
  return Math.floor((expiry.getTime() - now.getTime()) / 86_400_000)
}

/** Connections within this window are surfaced to the operator as "expiring". */
export const EXPIRY_WARNING_DAYS = 7
