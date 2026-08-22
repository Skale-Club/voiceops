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
        status: 'error',
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
 * that are actually in the error state, so a healthy `available` account is
 * never silently promoted to `active`.
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
        status: 'active',
        connection_error: null,
        last_error_at: null,
        last_verified_at: new Date().toISOString(),
      })
      .eq('org_id', params.orgId)
      .eq('platform', params.platform)
      .eq('ad_account_id', params.adAccountId)
      .eq('status', 'error')
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

/** Days until a stored token expires, or null when there is no expiry on file. */
export function daysUntilExpiry(tokenExpiresAt: string | null, now = new Date()): number | null {
  if (!tokenExpiresAt) return null
  const expiry = new Date(tokenExpiresAt)
  if (Number.isNaN(expiry.getTime())) return null
  return Math.floor((expiry.getTime() - now.getTime()) / 86_400_000)
}

/** Connections within this window are surfaced to the operator as "expiring". */
export const EXPIRY_WARNING_DAYS = 7
