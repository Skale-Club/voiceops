// Ad-account resolution for the AI layer (Copilot tools + MCP server).
//
// The old helper took the first row it found and accepted `available` accounts
// — the ones an admin has deliberately NOT opted into showing. In an org with
// several ad accounts that meant the AI could silently answer with a different
// account's numbers than the operator was looking at, with nothing in the reply
// indicating which account it read.
//
// This resolves explicitly: only opted-in (`active`) accounts are eligible, an
// exact id is honoured, and an ambiguous request returns the candidate list so
// the model can ask instead of guessing.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

export type AdsPlatform = 'meta' | 'google'

export type ResolvedAccount = {
  ok: true
  accountId: string
  accountName: string | null
  token: string
}

export type AccountResolutionError = {
  ok: false
  error: 'no_connection' | 'ambiguous_account' | 'account_not_found' | 'connection_error'
  detail: string
  available?: Array<{ ad_account_id: string; ad_account_name: string | null }>
}

export type AccountResolution = ResolvedAccount | AccountResolutionError

type ConnectionRow = {
  ad_account_id: string
  ad_account_name: string | null
  encrypted_access_token: string
  status: string
  connection_error: string | null
}

/**
 * Resolve which ad account an AI tool call should read.
 *
 * `adAccountId` omitted + exactly one active account → that account.
 * `adAccountId` omitted + several                    → ambiguous, list them.
 * `adAccountId` given                                → that one, or not_found.
 */
export async function resolveAdAccount(
  orgId: string,
  platform: AdsPlatform,
  adAccountId?: string,
): Promise<AccountResolution> {
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('ads_connections')
    .select('ad_account_id, ad_account_name, encrypted_access_token, status, connection_error')
    .eq('org_id', orgId)
    .eq('platform', platform)
    // Only accounts the admin opted into AND whose credential is currently
    // healthy. 'available' means connected but deliberately hidden, and a
    // dead credential (health='error') would answer with data the operator
    // isn't looking at, or fail confusingly. `usable` is the generated
    // column that answers exactly this (status='active' AND health='ok') —
    // see docs/integrations/ads-connection-health-plan.md.
    .eq('usable', true)

  if (error) {
    return { ok: false, error: 'no_connection', detail: `Could not read ads connections: ${error.message}` }
  }

  const rows = (data ?? []) as ConnectionRow[]

  if (rows.length === 0) {
    // Distinguish "never connected" from "connected but broken" — they need
    // completely different things from the operator.
    const { data: brokenRows } = await supabase
      .from('ads_connections')
      .select('ad_account_id, ad_account_name, connection_error')
      .eq('org_id', orgId)
      .eq('platform', platform)
      .eq('health', 'error')

    const broken = (brokenRows ?? []) as Array<{ ad_account_id: string; ad_account_name: string | null; connection_error: string | null }>
    if (broken.length > 0) {
      return {
        ok: false,
        error: 'connection_error',
        detail: `The ${platform} connection needs to be re-authorized: ${broken[0].connection_error ?? 'the stored token was rejected'}. Ask the operator to reconnect it in Ads → Settings.`,
        available: broken.map((b) => ({ ad_account_id: b.ad_account_id, ad_account_name: b.ad_account_name })),
      }
    }

    return {
      ok: false,
      error: 'no_connection',
      detail: `No active ${platform} ad account is connected for this organization.`,
    }
  }

  let chosen: ConnectionRow | undefined

  if (adAccountId) {
    chosen = rows.find((r) => r.ad_account_id === adAccountId)
    if (!chosen) {
      return {
        ok: false,
        error: 'account_not_found',
        detail: `No active ${platform} account matches "${adAccountId}".`,
        available: rows.map((r) => ({ ad_account_id: r.ad_account_id, ad_account_name: r.ad_account_name })),
      }
    }
  } else if (rows.length === 1) {
    chosen = rows[0]
  } else {
    return {
      ok: false,
      error: 'ambiguous_account',
      detail: `This organization has ${rows.length} active ${platform} ad accounts. Ask the operator which one to use, then pass ad_account_id.`,
      available: rows.map((r) => ({ ad_account_id: r.ad_account_id, ad_account_name: r.ad_account_name })),
    }
  }

  return {
    ok: true,
    accountId: chosen.ad_account_id,
    accountName: chosen.ad_account_name,
    token: await decrypt(chosen.encrypted_access_token),
  }
}

/** All active accounts for a platform — for tools that list rather than read. */
export async function listActiveAdAccounts(
  orgId: string,
  platform: AdsPlatform,
): Promise<Array<{ ad_account_id: string; ad_account_name: string | null }>> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('ads_connections')
    .select('ad_account_id, ad_account_name')
    .eq('org_id', orgId)
    .eq('platform', platform)
    .eq('usable', true)
    .order('ad_account_name')
  return (data ?? []) as Array<{ ad_account_id: string; ad_account_name: string | null }>
}
