// src/lib/vapi/sync-assistants.ts
// Mirrors the org's Vapi account into the assistant_mappings registry so the
// user never has to register assistant IDs by hand. The registry stays the
// fast, multi-tenant index used by the webhook hot path (resolve-org.ts) — we
// just keep it populated automatically instead of through manual entry.
//
// Called automatically when the Vapi key is saved, and on demand from the
// "Sync from Vapi" button on the Connected Assistants page.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { decrypt } from '@/lib/crypto'

interface VapiAssistant {
  id: string
  name?: string | null
}

export interface SyncVapiAssistantsResult {
  ok: boolean
  imported?: number
  /** Assistants left alone because another org already routes through them. */
  skipped?: number
  error?: string
}

export async function syncVapiAssistants(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<SyncVapiAssistantsResult> {
  // 1. Load + decrypt the org's Vapi API key.
  const { data: integration } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', organizationId)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.encrypted_api_key) {
    return { ok: false, error: 'Vapi integration not connected.' }
  }

  let apiKey: string
  try {
    apiKey = await decrypt(integration.encrypted_api_key)
  } catch {
    return { ok: false, error: 'Could not read the saved Vapi API key.' }
  }

  // 2. Fetch every assistant on the account.
  let assistants: VapiAssistant[]
  try {
    const res = await fetch('https://api.vapi.ai/assistant', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      return { ok: false, error: `Vapi returned ${res.status}.` }
    }
    const data = await res.json()
    assistants = Array.isArray(data) ? (data as VapiAssistant[]) : []
  } catch {
    return { ok: false, error: 'Failed to reach Vapi.' }
  }

  const rows = assistants
    .filter((a) => a?.id)
    .map((a) => ({
      organization_id: organizationId,
      vapi_assistant_id: a.id,
      name: a.name?.trim() || a.id,
    }))

  if (rows.length === 0) {
    return { ok: true, imported: 0 }
  }

  // 3. Never take an assistant that another org already claims.
  //
  // One Vapi account can serve several Xphere orgs — a platform-owned account
  // hosting an assistant that books into a client's tenant, say. The mapping is
  // not a label saying who owns the assistant; it is the routing table that
  // decides WHOSE credentials fire when a tool runs. A blind upsert on
  // vapi_assistant_id rewrote organization_id, so pressing "Sync from Vapi" on
  // the account's home org silently repointed the other org's assistant at
  // itself. Nothing errors: the next caller just reaches an org with no
  // matching integration and hears the tool's fallback message.
  const { data: claimed, error: claimError } = await supabase
    .from('assistant_mappings')
    .select('vapi_assistant_id, organization_id')
    .in('vapi_assistant_id', rows.map((r) => r.vapi_assistant_id))

  if (claimError) {
    return { ok: false, error: claimError.message }
  }

  const claimedByOthers = new Set(
    (claimed ?? [])
      .filter((m) => m.organization_id !== organizationId)
      .map((m) => m.vapi_assistant_id),
  )
  const importable = rows.filter((r) => !claimedByOthers.has(r.vapi_assistant_id))

  if (importable.length === 0) {
    return { ok: true, imported: 0, skipped: claimedByOthers.size }
  }

  // 4. Upsert into the registry. onConflict keeps each row's is_active intact
  //    (so a manual disable survives a re-sync) and only refreshes the name.
  const { error } = await supabase
    .from('assistant_mappings')
    .upsert(importable, { onConflict: 'vapi_assistant_id' })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, imported: importable.length, skipped: claimedByOthers.size }
}
