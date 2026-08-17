'use server'

import { revalidatePath } from 'next/cache'
import { getUser, createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'
import { testResendApiKey, sendTenantEmail } from '@/lib/email/resend'
import {
  invalidateWebhookSecretsCache,
  isValidResendWebhookSecretFormat,
} from '@/lib/email/webhook-secrets'
import type { TenantEmailIntegrationRow } from '@/types/database'

// ─── Getters ──────────────────────────────────────────────────────────────

export async function getTenantEmailIntegration(): Promise<{
  integration:
    | (Omit<TenantEmailIntegrationRow, 'api_key_encrypted' | 'webhook_secret_encrypted'> & {
        key_hint: string | null
        webhook_secret_hint: string | null
      })
    | null
  error?: string
}> {
  const user = await getUser()
  if (!user) return { integration: null, error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { integration: null, error: 'No active org' }

  const { data } = await supabase
    .from('tenant_email_integrations')
    .select(
      'id, org_id, key_hint, webhook_secret_encrypted, default_from_name, default_from_email, default_reply_to, provider, status, last_tested_at, last_error, created_at, updated_at'
    )
    .eq('org_id', orgId as string)
    .single()

  if (!data) return { integration: null }

  const row = data as unknown as TenantEmailIntegrationRow

  // No dedicated hint column for the webhook secret — compute it on read the
  // same way the platform settings getter does for its API key.
  let webhookSecretHint: string | null = null
  if (row.webhook_secret_encrypted) {
    try {
      webhookSecretHint = maskApiKey(await decrypt(row.webhook_secret_encrypted))
    } catch {
      webhookSecretHint = '••••••••????'
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { webhook_secret_encrypted: _w, ...rest } = row
  return { integration: { ...rest, webhook_secret_hint: webhookSecretHint } }
}

// ─── Save / Upsert ────────────────────────────────────────────────────────

export async function saveTenantEmailIntegration(input: {
  apiKey?: string
  webhookSecret?: string
  defaultFromName: string
  defaultFromEmail: string
  defaultReplyTo: string
}): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active org' }

  const serviceSupabase = createServiceRoleClient()

  let apiKeyEncrypted: string | undefined
  let keyHint: string | undefined

  if (input.apiKey?.trim()) {
    apiKeyEncrypted = await encrypt(input.apiKey.trim())
    keyHint = maskApiKey(input.apiKey.trim())
  }

  // Same convention as the API key: blank input leaves the stored secret
  // untouched (never wiped by editing the other fields), and the plaintext
  // is never returned to the client.
  let webhookSecretEncrypted: string | undefined
  if (input.webhookSecret?.trim()) {
    const webhookSecret = input.webhookSecret.trim()
    if (!isValidResendWebhookSecretFormat(webhookSecret)) {
      return { error: 'Invalid Resend webhook signing secret. It must start with whsec_.' }
    }
    webhookSecretEncrypted = await encrypt(webhookSecret)
  }

  const { data: existing } = await supabase
    .from('tenant_email_integrations')
    .select('id, api_key_encrypted')
    .eq('org_id', orgId as string)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = serviceSupabase as any

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      default_from_name: input.defaultFromName || null,
      default_from_email: input.defaultFromEmail || null,
      default_reply_to: input.defaultReplyTo || null,
      updated_at: new Date().toISOString(),
    }
    if (apiKeyEncrypted) {
      updatePayload.api_key_encrypted = apiKeyEncrypted
      updatePayload.key_hint = keyHint
      updatePayload.status = 'disconnected' // reset status when key changes
    }
    if (webhookSecretEncrypted) {
      updatePayload.webhook_secret_encrypted = webhookSecretEncrypted
    }

    const existingTyped = existing as { id: string }
    const { error } = await svc
      .from('tenant_email_integrations')
      .update(updatePayload)
      .eq('id', existingTyped.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await svc.from('tenant_email_integrations').insert({
      org_id: orgId as string,
      api_key_encrypted: apiKeyEncrypted ?? null,
      key_hint: keyHint ?? null,
      webhook_secret_encrypted: webhookSecretEncrypted ?? null,
      default_from_name: input.defaultFromName || null,
      default_from_email: input.defaultFromEmail || null,
      default_reply_to: input.defaultReplyTo || null,
      provider: 'resend',
      status: 'disconnected',
    })

    if (error) return { error: error.message }
  }

  // The webhook validator memoizes the secret list (including an empty one),
  // so a freshly saved secret would otherwise sit unused until the TTL expired.
  if (webhookSecretEncrypted) invalidateWebhookSecretsCache()

  revalidatePath('/settings/email')
  return {}
}

// ─── Test connection ──────────────────────────────────────────────────────

export async function testTenantEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active org' }

  const serviceSupabase = createServiceRoleClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testSvc = serviceSupabase as any

  const { data: integrationRaw } = await testSvc
    .from('tenant_email_integrations')
    .select('id, api_key_encrypted')
    .eq('org_id', orgId as string)
    .single()

  const integration = integrationRaw as { id: string; api_key_encrypted: string | null } | null

  if (!integration?.api_key_encrypted) {
    return { ok: false, error: 'No API key saved. Save your settings first.' }
  }

  let apiKey: string
  try {
    apiKey = await decrypt(integration.api_key_encrypted)
  } catch {
    return { ok: false, error: 'Failed to decrypt API key' }
  }

  const result = await testResendApiKey(apiKey)

  // Update status and last_tested_at
  await testSvc
    .from('tenant_email_integrations')
    .update({
      status: result.ok ? 'connected' : 'error',
      last_tested_at: new Date().toISOString(),
      last_error: result.ok ? null : (result.error ?? 'Unknown error'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', integration.id)

  revalidatePath('/settings/email')
  return result
}

// ─── Send test email ──────────────────────────────────────────────────────

export async function sendTestTenantEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active org' }

  const result = await sendTenantEmail(
    orgId as string,
    to,
    'Xphere Email Test',
    '<p>This is a test email from Xphere. Your Resend integration is working correctly.</p>'
  )

  return { ok: !result.error, error: result.error }
}
