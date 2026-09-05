// src/lib/xkedule/credentials.ts
// Loads the per-org Xkedule integration credentials (Settings → Integrations →
// Xkedule). Nothing lives in the environment — every org configures its own:
//   location_id        = tenant base URL
//   encrypted_api_key  = the connection token (a Xphere api_key, xph_…). The
//                        Xkedule tenant stores the same token; the Xphere
//                        platform presents it as X-Xkedule-Key on /api/v1 calls.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import { memoTtl } from '@/lib/cache/ttl-memo'
import type { XkeduleCredentials } from './client'

// Mirrors the 60s freshness window ttl-memo.ts's own doc comment describes
// for other per-tool-call Supabase round trips (org-by-assistant, routing
// mode, tool config, ...). execute-action.ts's 8 xkedule_* cases each call
// getXkeduleCredentialsForOrgCached once per tool invocation; without this,
// a single voice conversation (get_quote, then check_availability, then
// create_booking) pays 3+ redundant integration-row round trips for
// credentials that cannot change mid-call.
const XKEDULE_CREDENTIALS_CACHE_TTL_MS = 60_000

export async function getXkeduleCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<XkeduleCredentials | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id')
    .eq('organization_id', orgId)
    .eq('provider', 'xkedule')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data || !data.location_id || !data.encrypted_api_key) return null

  const apiKey = await decrypt(data.encrypted_api_key as string)
  // orgId is already a parameter here, so this costs nothing extra — it's
  // what lets availability-cache.ts scope its cache keys and prefetch by org
  // (see src/lib/xkedule/availability-cache.ts).
  return { tenantBaseUrl: data.location_id as string, apiKey, organizationId: orgId }
}

/**
 * Memoised wrapper around getXkeduleCredentialsForOrg (60s per org — see
 * XKEDULE_CREDENTIALS_CACHE_TTL_MS above). Every xkedule_* case in
 * execute-action.ts should call this instead of the raw lookup: the raw
 * function already stamps `organizationId` on the credentials it returns, so
 * the only thing missing for those cases was avoiding a fresh DB round trip
 * on every single tool call in a conversation.
 *
 * Never memoises a null result: a `null` here almost always means "not
 * configured yet", and caching that would make a newly-connected Xkedule
 * integration invisible to the rest of the call for up to
 * XKEDULE_CREDENTIALS_CACHE_TTL_MS. memoTtl only caches a *resolved* value,
 * so the null case is routed through a throw/catch to keep it out of the
 * cache entirely (mirrors memoTtl's own "a rejected fn caches nothing"
 * guarantee).
 */
export async function getXkeduleCredentialsForOrgCached(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<XkeduleCredentials | null> {
  try {
    return await memoTtl(`xk-creds:${orgId}`, XKEDULE_CREDENTIALS_CACHE_TTL_MS, async () => {
      const creds = await getXkeduleCredentialsForOrg(orgId, supabase)
      if (!creds) throw new Error('xkedule integration not configured')
      return creds
    })
  } catch {
    return null
  }
}
