// src/lib/xkedule/credentials.ts
// Loads the per-org Xkedule integration credentials (Settings → Integrations →
// Xkedule). Nothing lives in the environment — every org configures its own:
//   location_id        = tenant base URL
//   encrypted_api_key  = the connection token (a Xphere api_key, xph_…). The
//                        Xkedule tenant stores the same token; the Xphere
//                        platform presents it as X-Xkedule-Key on /api/v1 calls.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import type { XkeduleCredentials } from './client'

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
