'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getCurrentOrgId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.rpc('get_current_org_id')
  return data as string | null
}

function normalizeAssistantName(name?: string) {
  const normalized = name?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

export async function createAssistantMapping(data: { vapi_assistant_id: string; name?: string }) {
  if (!data.vapi_assistant_id || data.vapi_assistant_id.trim() === '') {
    return { error: 'Vapi assistant ID is required.' }
  }
  const name = normalizeAssistantName(data.name)
  if (!name) return { error: 'Assistant name is required.' }
  const supabase = await createClient()
  const organization_id = await getCurrentOrgId(supabase)
  if (!organization_id) return { error: 'No organization found for current user.' }

  const { error } = await supabase
    .from('assistant_mappings')
    .insert({ vapi_assistant_id: data.vapi_assistant_id.trim(), name, organization_id })
  if (error) {
    if (error.code === '23505') return { error: 'This assistant ID is already mapped to an organization.' }
    return { error: error.message }
  }
  revalidatePath('/calls')
}

export async function updateAssistantMapping(id: string, data: { vapi_assistant_id: string; name?: string }) {
  const name = normalizeAssistantName(data.name)
  if (!name) return { error: 'Assistant name is required.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('assistant_mappings')
    .update({ vapi_assistant_id: data.vapi_assistant_id.trim(), name })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') return { error: 'This assistant ID is already mapped to an organization.' }
    return { error: error.message }
  }
  revalidatePath('/calls')
}

export async function toggleAssistantMappingStatus(id: string, is_active: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('assistant_mappings')
    .update({ is_active })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/calls')
}

export async function deleteAssistantMapping(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('assistant_mappings')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/calls')
}

export async function syncVapiAssistantsAction(): Promise<{
  ok: boolean
  imported?: number
  /** Assistants another org already routes through — left untouched. */
  skipped?: number
  error?: string
}> {
  const supabase = await createClient()
  const organization_id = await getCurrentOrgId(supabase)
  if (!organization_id) return { ok: false, error: 'No organization found for current user.' }

  const { syncVapiAssistants } = await import('@/lib/vapi/sync-assistants')
  const result = await syncVapiAssistants(supabase, organization_id)
  if (result.ok) revalidatePath('/calls')
  return result
}
