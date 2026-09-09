'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/crypto'
import { sendCapiEvents, buildUserData } from '@/lib/meta/capi'
import type { Database } from '@/types/database'

type CapiConfigInsert = Database['public']['Tables']['meta_capi_config']['Insert']

const configSchema = z.object({
  meta_ad_account_id: z.string().trim().max(64).optional().nullable(),
  dataset_id: z.string().trim().max(64).optional().nullable(),
  pixel_id: z.string().trim().max(64).optional().nullable(),
  capi_token: z.string().trim().optional().nullable(), // plaintext; encrypted before store
  test_event_code: z.string().trim().max(64).optional().nullable(),
  enabled: z.boolean(),
  browser_pixel_enabled: z.boolean(),
  default_currency: z.string().trim().min(3).max(3),
  event_map: z.object({
    lead: z.object({ enabled: z.boolean() }),
    qualified: z.object({ enabled: z.boolean(), stage_name: z.string().trim().max(80) }),
    purchase: z.object({ enabled: z.boolean(), value_source: z.string().trim().max(40) }),
  }),
})

export type CapiConfigInput = z.infer<typeof configSchema>

export async function saveCapiConfig(
  input: CapiConfigInput,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const parsed = configSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid configuration' }
  const cfg = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization' }

  // Encrypt the token only when a new value was provided; an empty string means
  // "leave existing token unchanged".
  const row: CapiConfigInsert = {
    org_id: orgId as string,
    meta_ad_account_id: cfg.meta_ad_account_id || null,
    dataset_id: cfg.dataset_id || null,
    pixel_id: cfg.pixel_id || null,
    test_event_code: cfg.test_event_code || null,
    enabled: cfg.enabled,
    browser_pixel_enabled: cfg.browser_pixel_enabled,
    default_currency: cfg.default_currency.toUpperCase(),
    event_map: cfg.event_map,
  }
  if (cfg.capi_token) {
    row.encrypted_capi_token = await encrypt(cfg.capi_token)
  }

  const { error } = await supabase
    .from('meta_capi_config')
    .upsert(row, { onConflict: 'org_id' })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/ads/capi')
  return { ok: true }
}

/**
 * Fire a single test Lead event to the configured dataset using the
 * test_event_code so it shows up in Events Manager → Test Events without
 * affecting optimization. Returns the fbtrace_id for confirmation.
 */
export async function sendTestEvent(): Promise<{ ok: boolean; fbtrace_id?: string | null; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const supabase = await createClient()
  const { data: config } = await supabase
    .from('meta_capi_config')
    .select('dataset_id, encrypted_capi_token, test_event_code')
    .maybeSingle()

  if (!config?.dataset_id) return { ok: false, error: 'Configure a dataset id first' }
  if (!config.test_event_code) return { ok: false, error: 'Set a test_event_code to send a test event' }

  let token: string | null = null
  if (config.encrypted_capi_token) {
    try { token = await decrypt(config.encrypted_capi_token) } catch { /* ignore */ }
  }
  if (!token) {
    const { data: conn } = await supabase
      .from('ads_connections')
      .select('encrypted_access_token')
      .eq('platform', 'meta')
      .eq('usable', true)
      .maybeSingle()
    if (conn?.encrypted_access_token) {
      try { token = await decrypt(conn.encrypted_access_token) } catch { /* ignore */ }
    }
  }
  if (!token) return { ok: false, error: 'No usable Meta token (set a CAPI token or connect a Meta account)' }

  try {
    const userData = await buildUserData({ email: 'test@xphere.app' })
    const result = await sendCapiEvents(
      config.dataset_id,
      token,
      [{
        event_name: 'Lead',
        event_id: `test_${user.id}`,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system_generated',
        user_data: userData,
      }],
      { testEventCode: config.test_event_code },
    )
    return { ok: true, fbtrace_id: result.fbtrace_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' }
  }
}
