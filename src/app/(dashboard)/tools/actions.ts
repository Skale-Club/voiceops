'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Json } from '@/types/database'

export type ToolConfigWithIntegration = {
  id: string
  organization_id: string
  integration_id: string
  tool_name: string
  action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook'
  config: unknown
  fallback_message: string
  is_active: boolean
  created_at: string
  integrations: {
    id: string
    name: string
    provider: string
  } | null
}

export async function createToolConfig(data: {
  toolName: string
  actionType: string
  integrationId: string
  fallbackMessage: string
  config?: Record<string, unknown>
}): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: member, error: memberError } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (memberError || !member) return { error: 'No organization found for this user.' }

  const { error } = await supabase.from('tool_configs').insert({
    organization_id: member.organization_id,
    tool_name: data.toolName,
    action_type: data.actionType as 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook',
    integration_id: data.integrationId,
    fallback_message: data.fallbackMessage,
    config: (data.config ?? {}) as Json,
  })

  if (error) {
    if (error.code === '23505') {
      return { error: 'A tool with this name already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/tools')
}

export async function updateToolConfig(
  id: string,
  data: {
    toolName: string
    actionType: string
    integrationId: string
    fallbackMessage: string
    config?: Record<string, unknown>
  }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('tool_configs')
    .update({
      tool_name: data.toolName,
      action_type: data.actionType as 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook',
      integration_id: data.integrationId,
      fallback_message: data.fallbackMessage,
      config: (data.config ?? {}) as Json,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'A tool with this name already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/tools')
}

export async function getToolConfigs(): Promise<ToolConfigWithIntegration[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tool_configs')
    .select('*, integrations(id, name, provider)')
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data as ToolConfigWithIntegration[]
}

export async function deleteToolConfig(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase.from('tool_configs').delete().eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/tools')
}

