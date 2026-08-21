'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'
import { testResendApiKey } from '@/lib/email/resend'
import { assertSafeBaseUrl, MedusaUnsafeBaseUrlError } from '@/lib/medusa/client'

// Type returned to UI | encrypted_api_key is NEVER included
export type IntegrationForDisplay = {
  id: string
  organization_id: string
  provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram' | 'resend' | 'zernio' | 'xkedule' | 'medusa'
  name: string
  masked_api_key: string // ••••••••last4 | never full key
  location_id: string | null
  config: unknown
  is_active: boolean
  created_at: string
}

type Provider = IntegrationForDisplay['provider']

export async function createIntegration(data: {
  name: string
  provider: string
  apiKey: string
  locationId: string
  config?: Record<string, string>
}): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId, error: orgError } = await supabase.rpc('get_current_org_id')
  if (orgError || !orgId) return { error: 'No active organization found for this user.' }

  const encryptedKey = await encrypt(data.apiKey)

  const { error } = await supabase.from('integrations').insert({
    organization_id: orgId,
    provider: data.provider as Provider,
    name: data.name,
    encrypted_api_key: encryptedKey,
    key_hint: maskApiKey(data.apiKey),
    location_id: data.locationId || null,
    config: data.config ?? {},
  })

  if (error) {
    if (error.code === '23505') {
      return { error: `An integration for ${data.name} already exists in this organization. Edit the existing one instead.` }
    }
    return { error: error.message }
  }

  revalidatePath('/integrations')
}

export async function updateIntegration(
  id: string,
  data: { name: string; locationId: string; config?: Record<string, string>; apiKey?: string }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const updateData: Record<string, unknown> = {
    name: data.name,
    location_id: data.locationId || null,
    config: data.config ?? {},
  }

  if (data.apiKey && data.apiKey.trim().length > 0) {
    updateData.encrypted_api_key = await encrypt(data.apiKey)
    updateData.key_hint = maskApiKey(data.apiKey)
  }

  const { error } = await supabase.from('integrations').update(updateData).eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations')
}

export async function getIntegrations(): Promise<IntegrationForDisplay[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('integrations')
    .select('id, name, provider, key_hint, location_id, config, is_active, created_at, organization_id')
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    provider: row.provider,
    name: row.name,
    masked_api_key: row.key_hint ?? '••••••••',
    location_id: row.location_id,
    config: row.config,
    is_active: row.is_active,
    created_at: row.created_at,
  }))
}

export async function testConnection(
  integrationId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: integration, error: fetchError } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id, provider')
    .eq('id', integrationId)
    .single()

  if (fetchError || !integration) return { success: false, error: 'Integration not found.' }

  let apiKey: string
  try {
    apiKey = await decrypt(integration.encrypted_api_key)
  } catch {
    return { success: false, error: 'Failed to decrypt credentials.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const provider = integration.provider as Provider

    if (provider === 'gohighlevel') {
      const locationId = integration.location_id ?? ''
      const response = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Version: '2021-07-28',
          },
          signal: controller.signal,
        }
      )

      if (response.ok || response.status === 200 || response.status === 201) {
        return { success: true }
      }
      return { success: false, error: `GHL returned status ${response.status}` }
    }

    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (response.ok) return { success: true }
      return { success: false, error: `OpenAI returned status ${response.status}` }
    }

    if (provider === 'anthropic') {
      // Validate key format (sk-ant-...) | avoids billing a real API call for test
      if (apiKey.startsWith('sk-ant-')) return { success: true }
      return { success: false, error: 'Invalid Anthropic API key format | expected key starting with sk-ant-' }
    }

    if (provider === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (response.ok) return { success: true }
      return { success: false, error: `OpenRouter returned status ${response.status}` }
    }

    if (provider === 'vapi') {
      const response = await fetch('https://api.vapi.ai/assistant', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (response.ok) return { success: true }
      return { success: false, error: `Vapi returned status ${response.status}` }
    }

    if (provider === 'resend') {
      const result = await testResendApiKey(apiKey)
      if (result.ok) return { success: true }
      return { success: false, error: result.error ?? 'Resend connection failed.' }
    }

    // Other providers (twilio, calcom, custom_webhook) | no test endpoint defined yet
    return { success: false, error: `Test not supported for provider: ${provider}` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Connection timed out after 5 seconds.' }
    }
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SEED-042 | Registry-driven helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Test arbitrary credentials BEFORE they are persisted. Used by the unified
 * /integrations panel to gate the Save button. Returns ok=true when a minimal
 * API ping succeeds for the provider.
 */
export async function testIntegrationConnection(
  provider: string,
  credentials: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const apiKey = credentials.api_key ?? ''
  if (!apiKey) return { ok: false, error: 'API key is required.' }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    if (provider === 'gohighlevel') {
      const locationId = credentials.location_id ?? ''
      if (!locationId) return { ok: false, error: 'Location ID is required.' }
      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Version: '2021-07-28',
          },
          signal: controller.signal,
        },
      )
      if (res.ok) return { ok: true }
      return { ok: false, error: `GoHighLevel returned ${res.status}` }
    }

    if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (res.ok) return { ok: true }
      return { ok: false, error: `OpenRouter returned ${res.status}` }
    }

    if (provider === 'vapi') {
      const res = await fetch('https://api.vapi.ai/assistant', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (res.ok) return { ok: true }
      return { ok: false, error: `Vapi returned ${res.status}` }
    }

    if (provider === 'calcom') {
      const res = await fetch(
        `https://api.cal.com/v1/me?apiKey=${encodeURIComponent(apiKey)}`,
        { signal: controller.signal },
      )
      if (res.ok) return { ok: true }
      return { ok: false, error: `Cal.com returned ${res.status}` }
    }

    if (provider === 'manychat') {
      const res = await fetch('https://api.manychat.com/fb/page/getInfo', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (res.ok) return { ok: true }
      return { ok: false, error: `ManyChat returned ${res.status}` }
    }

    if (provider === 'twilio') {
      const accountSid = credentials.account_sid ?? apiKey
      const authToken = credentials.auth_token ?? credentials.api_key ?? ''
      if (!accountSid || !authToken) {
        return { ok: false, error: 'Account SID and Auth Token are required.' }
      }
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
        {
          headers: { Authorization: `Basic ${auth}` },
          signal: controller.signal,
        },
      )
      if (res.ok) return { ok: true }
      return { ok: false, error: `Twilio returned ${res.status}` }
    }

    if (provider === 'resend') {
      return testResendApiKey(apiKey)
    }

    if (provider === 'zernio') {
      const { testZernioApiKey } = await import('@/lib/zernio/client')
      return testZernioApiKey(apiKey)
    }

    // No test path defined | assume callers will handle the unconfigured case.
    return { ok: false, error: `No test endpoint defined for ${provider}` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out after 5 seconds.' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Save (insert or update) credentials for a provider. The api_key column is
 * encrypted at rest; the other fields land on `config` JSONB or `location_id`.
 * Does NOT toggle is_active | use toggleIntegrationActive separately.
 */
export async function saveIntegrationCredentials(
  provider: string,
  credentials: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId, error: orgError } = await supabase.rpc('get_current_org_id')
  if (orgError || !orgId) return { ok: false, error: 'No active organization.' }

  const apiKey = (credentials.api_key ?? '').trim()
  const locationId = credentials.location_id ?? null
  const config: Record<string, string> = { ...credentials }
  delete config.api_key
  delete config.location_id

  if (provider === 'resend' && !config.default_from_email?.trim()) {
    return { ok: false, error: 'Default From Email is required.' }
  }

  // MIR-08 (2026-07 audit): the Xkedule connection token IS a Xphere API key
  // (paste-the-same-token-both-ways design, src/lib/integrations/registry.ts)
  // -- reject an obviously-wrong value server-side too, not just in the
  // client panel (ApiKeyPanel), so a direct/programmatic call can't bypass it.
  if (provider === 'xkedule' && apiKey && !/^xph_.{8,}/.test(apiKey)) {
    return { ok: false, error: 'Connection Token must be a Xphere API key starting with "xph_".' }
  }

  // X10 (SSRF hardening): the Medusa "Server URL" field becomes
  // MedusaCredentials.baseUrl (src/lib/medusa/client.ts), which this server
  // then sends signed/keyed requests to on every commerce tool call. Reject
  // an unsafe value (non-https, or a private/link-local/metadata IP) at save
  // time too, not just at fetch time, so a bad URL never gets persisted.
  if (provider === 'medusa' && locationId) {
    try {
      assertSafeBaseUrl(locationId)
    } catch (err) {
      if (err instanceof MedusaUnsafeBaseUrlError) return { ok: false, error: err.message }
      throw err
    }
  }

  // Find an existing row for this provider/org
  const { data: existing } = await supabase
    .from('integrations')
    .select('id, config, encrypted_api_key')
    .eq('organization_id', orgId)
    .eq('provider', provider as Provider)
    .limit(1)
    .maybeSingle()

  if (!existing?.id && !apiKey) {
    return { ok: false, error: 'API key is required.' }
  }

  const existingConfig = (existing?.config as Record<string, string> | null) ?? {}
  const savedConfig = existing?.id ? { ...existingConfig, ...config } : config
  const encryptedKey = apiKey ? await encrypt(apiKey) : null
  const keyHint = apiKey ? maskApiKey(apiKey) : null
  const payload = {
    organization_id: orgId,
    provider: provider as Provider,
    name: provider,
    encrypted_api_key: encryptedKey ?? '',
    key_hint: keyHint,
    location_id: locationId,
    config: savedConfig,
  }

  if (existing?.id) {
    const updateData: Record<string, unknown> = {
      location_id: locationId,
      config: savedConfig,
    }
    if (encryptedKey) {
      updateData.encrypted_api_key = encryptedKey
      updateData.key_hint = keyHint
    }

    const { error } = await supabase
      .from('integrations')
      .update(updateData)
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('integrations').insert(payload)
    if (error) return { ok: false, error: error.message }
  }

  if (provider === 'resend') {
    const syncResult = await syncResendTenantEmailIntegration({
      orgId,
      encryptedKey,
      keyHint,
      config,
      markConnected: !!apiKey,
    })
    if (!syncResult.ok) return syncResult
    revalidatePath('/settings/email')
  }

  if (provider === 'vapi') {
    // Mirror the account's assistants into the registry so the user doesn't
    // register each one by hand. Best-effort: a sync failure must not fail the
    // credential save — the manual "Sync from Vapi" button can retry.
    try {
      const { syncVapiAssistants } = await import('@/lib/vapi/sync-assistants')
      await syncVapiAssistants(supabase, orgId)
    } catch {
      // ignored — credentials are saved; user can retry the sync manually
    }
    revalidatePath('/calls')
  }

  if (provider === 'zernio') {
    let webhookApiKey = apiKey
    if (!webhookApiKey && existing?.encrypted_api_key) {
      try {
        webhookApiKey = await decrypt(existing.encrypted_api_key)
      } catch {
        return { ok: false, error: 'Could not read the saved Zernio API key. Re-enter it and save again.' }
      }
    }

    if (!webhookApiKey) {
      return { ok: false, error: 'Zernio API key is required to register the webhook.' }
    }

    try {
      const { randomBytes, randomUUID } = await import('node:crypto')
      const webhookToken = existingConfig.webhook_token || randomUUID()
      const webhookSecret = existingConfig.webhook_secret || randomBytes(32).toString('hex')
      const existingWebhookId = existingConfig.webhook_id || undefined
      const webhookUrl = `https://xphere.app/api/zernio/webhook?t=${webhookToken}`

      const { registerZernioWebhook } = await import('@/lib/zernio/register-webhook')
      const { webhookId, missingEvents } = await registerZernioWebhook(
        webhookApiKey,
        webhookUrl,
        webhookSecret,
        existingWebhookId,
      )
      if (missingEvents.length > 0) {
        console.error(
          `[saveIntegrationCredentials] Zernio webhook ${webhookId} did not persist events: ${missingEvents.join(', ')}`,
        )
      }

      const { error } = await supabase
        .from('integrations')
        .update({
          config: {
            ...savedConfig,
            webhook_token: webhookToken,
            webhook_secret: webhookSecret,
            webhook_id: webhookId,
            webhook_url: webhookUrl,
          },
          health_status: 'connected',
          is_active: true,
        })
        .eq('organization_id', orgId)
        .eq('provider', 'zernio' as Provider)
      if (error) return { ok: false, error: error.message }
    } catch (err) {
      console.error('[saveIntegrationCredentials] Zernio webhook registration failed:', err)
      // Surface failure to the UI so "Active" only means credentials plus webhook.
      await supabase
        .from('integrations')
        .update({
          config: savedConfig,
          health_status: 'degraded',
          is_active: false,
        })
        .eq('organization_id', orgId)
        .eq('provider', 'zernio' as Provider)

      const message = err instanceof Error ? err.message : 'Unknown error.'
      return { ok: false, error: `Zernio API key saved, but webhook registration failed: ${message}` }
    }
  }

  revalidatePath('/integrations')
  return { ok: true }
}

async function syncResendTenantEmailIntegration({
  orgId,
  encryptedKey,
  keyHint,
  config,
  markConnected,
}: {
  orgId: string
  encryptedKey: string | null
  keyHint: string | null
  config: Record<string, string>
  markConnected: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const serviceSupabase = createServiceRoleClient()
  const { data: existing, error: fetchError } = await serviceSupabase
    .from('tenant_email_integrations')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (fetchError) return { ok: false, error: fetchError.message }

  const payload: Record<string, unknown> = {
    provider: 'resend',
    default_from_name: config.default_from_name || 'Xphere',
    default_from_email: config.default_from_email,
    default_reply_to: config.default_reply_to || null,
    updated_at: new Date().toISOString(),
  }

  if (encryptedKey) {
    payload.api_key_encrypted = encryptedKey
    payload.key_hint = keyHint
  }

  if (markConnected) {
    payload.status = 'connected'
    payload.last_tested_at = new Date().toISOString()
    payload.last_error = null
  }

  if (existing?.id) {
    const { error } = await serviceSupabase
      .from('tenant_email_integrations')
      .update(payload)
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  if (!encryptedKey) {
    return { ok: false, error: 'API key is required.' }
  }

  const { error } = await serviceSupabase.from('tenant_email_integrations').insert({
    ...payload,
    org_id: orgId,
    api_key_encrypted: encryptedKey,
    key_hint: keyHint,
    status: markConnected ? 'connected' : 'disconnected',
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Flip the is_active flag for an integration. Idempotent.
 */
export async function toggleIntegrationActive(
  provider: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const { error } = await supabase
    .from('integrations')
    .update({ is_active: active })
    .eq('organization_id', orgId)
    .eq('provider', provider as Provider)

  if (error) return { ok: false, error: error.message }
  if (provider === 'resend') {
    const serviceSupabase = createServiceRoleClient()
    const { error: emailError } = await serviceSupabase
      .from('tenant_email_integrations')
      .update({ status: active ? 'connected' : 'disconnected' })
      .eq('org_id', orgId)

    if (emailError) return { ok: false, error: emailError.message }
    revalidatePath('/settings/email')
  }

  revalidatePath('/integrations')
  return { ok: true }
}

/**
 * UI-friendly fetch used by the new integration list. Same shape as
 * getIntegrations(), exposed under the SEED-042 naming so the page reads
 * intentionally.
 */
export async function getIntegrationsForDisplay(): Promise<IntegrationForDisplay[]> {
  return getIntegrations()
}

export async function deleteIntegration(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase.from('integrations').delete().eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations')
}
