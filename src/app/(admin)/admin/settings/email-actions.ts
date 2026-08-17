'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'
import { testResendApiKey, sendPlatformEmail } from '@/lib/email/resend'
import {
  invalidateWebhookSecretsCache,
  isValidResendWebhookSecretFormat,
} from '@/lib/email/webhook-secrets'
import type { PlatformEmailSettingsRow } from '@/types/database'

async function assertPlatformAdmin() {
  const user = await getUser()
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL
  if (!user || !adminEmail || user.email !== adminEmail) {
    throw new Error('Unauthorized')
  }
  return user
}

// ─── Getter ───────────────────────────────────────────────────────────────

export async function getPlatformEmailSettings(): Promise<{
  settings:
    | (Omit<PlatformEmailSettingsRow, 'api_key_encrypted' | 'webhook_secret_encrypted'> & {
        key_hint?: string
        webhook_secret_hint?: string
      })
    | null
  error?: string
}> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { settings: null, error: 'Unauthorized' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data: dataRaw } = await supabase
    .from('platform_email_settings')
    .select('id, default_from_name, default_from_email, default_reply_to, provider, is_active, last_tested_at, created_at, updated_at, api_key_encrypted, webhook_secret_encrypted')
    .single()

  const data = dataRaw as PlatformEmailSettingsRow | null
  if (!data) return { settings: null }

  // Don't expose the encrypted key/secret — compute hints from them
  let keyHint: string | undefined
  if (data.api_key_encrypted) {
    try {
      const raw = await decrypt(data.api_key_encrypted)
      keyHint = maskApiKey(raw)
    } catch {
      keyHint = '••••••••????'
    }
  }

  let webhookSecretHint: string | undefined
  if (data.webhook_secret_encrypted) {
    try {
      const raw = await decrypt(data.webhook_secret_encrypted)
      webhookSecretHint = maskApiKey(raw)
    } catch {
      webhookSecretHint = '••••••••????'
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_key_encrypted: _k, webhook_secret_encrypted: _w, ...rest } = data
  return { settings: { ...rest, key_hint: keyHint, webhook_secret_hint: webhookSecretHint } }
}

// ─── Save ─────────────────────────────────────────────────────────────────

export async function savePlatformEmailSettings(input: {
  apiKey?: string
  webhookSecret?: string
  defaultFromName: string
  defaultFromEmail: string
  defaultReplyTo: string
  isActive: boolean
}): Promise<{ error?: string }> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { error: 'Unauthorized' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any

  const { data: existingRaw } = await supabase
    .from('platform_email_settings')
    .select('id, api_key_encrypted')
    .single()

  const existing = existingRaw as { id: string; api_key_encrypted: string | null } | null

  let apiKeyEncrypted: string | undefined
  if (input.apiKey?.trim()) {
    apiKeyEncrypted = await encrypt(input.apiKey.trim())
  }

  // Same convention as the API key: blank input leaves the stored secret
  // untouched, and the plaintext is never returned to the client.
  let webhookSecretEncrypted: string | undefined
  if (input.webhookSecret?.trim()) {
    const webhookSecret = input.webhookSecret.trim()
    if (!isValidResendWebhookSecretFormat(webhookSecret)) {
      return { error: 'Invalid Resend webhook signing secret. It must start with whsec_.' }
    }
    webhookSecretEncrypted = await encrypt(webhookSecret)
  }

  const basePayload = {
    default_from_name: input.defaultFromName || null,
    default_from_email: input.defaultFromEmail || null,
    default_reply_to: input.defaultReplyTo || null,
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const updatePayload: Record<string, unknown> = { ...basePayload }
    if (apiKeyEncrypted) updatePayload.api_key_encrypted = apiKeyEncrypted
    if (webhookSecretEncrypted) updatePayload.webhook_secret_encrypted = webhookSecretEncrypted

    const { error } = await supabase
      .from('platform_email_settings')
      .update(updatePayload)
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('platform_email_settings').insert({
      ...basePayload,
      api_key_encrypted: apiKeyEncrypted ?? null,
      webhook_secret_encrypted: webhookSecretEncrypted ?? null,
      provider: 'resend',
    })

    if (error) return { error: error.message }
  }

  // The webhook validator memoizes the secret list (including an empty one),
  // so a freshly saved secret would otherwise sit unused until the TTL expired.
  if (webhookSecretEncrypted) invalidateWebhookSecretsCache()

  revalidatePath('/admin/settings')
  return {}
}

// ─── Test ─────────────────────────────────────────────────────────────────

export async function testPlatformEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data: settingsRaw } = await supabase
    .from('platform_email_settings')
    .select('id, api_key_encrypted')
    .single()

  const settings = settingsRaw as { id: string; api_key_encrypted: string | null } | null

  if (!settings?.api_key_encrypted) {
    return { ok: false, error: 'No API key configured. Save settings first.' }
  }

  let apiKey: string
  try {
    apiKey = await decrypt(settings.api_key_encrypted)
  } catch {
    return { ok: false, error: 'Failed to decrypt API key' }
  }

  const result = await testResendApiKey(apiKey)

  await supabase
    .from('platform_email_settings')
    .update({ last_tested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', settings.id)

  revalidatePath('/admin/settings')
  return result
}

// ─── Send test platform email ─────────────────────────────────────────────

export async function sendTestPlatformEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertPlatformAdmin()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  const result = await sendPlatformEmail(
    to,
    'Xphere Platform Email Test',
    '<p>This is a test email from the Xphere platform email system. Configuration is working correctly.</p>'
  )

  return { ok: !result.error, error: result.error }
}
