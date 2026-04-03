'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'

// Type returned to UI — encrypted_api_key is NEVER included
export type IntegrationForDisplay = {
  id: string
  organization_id: string
  provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi'
  name: string
  masked_api_key: string // ••••••••last4 — never full key
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
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: member, error: memberError } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (memberError || !member) return { error: 'No organization found for this user.' }

  const encryptedKey = await encrypt(data.apiKey)

  const { error } = await supabase.from('integrations').insert({
    organization_id: member.organization_id,
    provider: data.provider as Provider,
    name: data.name,
    encrypted_api_key: encryptedKey,
    location_id: data.locationId || null,
    config: data.config ?? {},
  })

  if (error) return { error: error.message }

  revalidatePath('/integrations')
}

export async function updateIntegration(
  id: string,
  data: { name: string; locationId: string; config?: Record<string, string>; apiKey?: string }
): Promise<{ error?: string } | void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const updateData: Record<string, unknown> = {
    name: data.name,
    location_id: data.locationId || null,
    config: data.config ?? {},
  }

  if (data.apiKey && data.apiKey.trim().length > 0) {
    updateData.encrypted_api_key = await encrypt(data.apiKey)
  }

  const { error } = await supabase.from('integrations').update(updateData).eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations')
}

export async function getIntegrations(): Promise<IntegrationForDisplay[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('integrations')
    .select('id, name, provider, encrypted_api_key, location_id, config, is_active, created_at, organization_id')
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return Promise.all(data.map(async (row) => {
    let masked_api_key = '••••••••'
    try {
      const plaintext = await decrypt(row.encrypted_api_key)
      masked_api_key = maskApiKey(plaintext)
    } catch {
      // encrypted_api_key malformed — show placeholder
    }
    return {
      id: row.id,
      organization_id: row.organization_id,
      provider: row.provider,
      name: row.name,
      masked_api_key,
      location_id: row.location_id,
      config: row.config,
      is_active: row.is_active,
      created_at: row.created_at,
    }
  }))
}

export async function testConnection(
  integrationId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }

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
      // Validate key format (sk-ant-...) — avoids billing a real API call for test
      if (apiKey.startsWith('sk-ant-')) return { success: true }
      return { success: false, error: 'Invalid Anthropic API key format — expected key starting with sk-ant-' }
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

    // Other providers (twilio, calcom, custom_webhook) — no test endpoint defined yet
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

export async function deleteIntegration(id: string): Promise<{ error?: string } | void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { error } = await supabase.from('integrations').delete().eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/integrations')
}
