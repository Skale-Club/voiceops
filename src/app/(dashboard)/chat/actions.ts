'use server'

import { createClient, getUser } from '@/lib/supabase/server'

export interface PlaygroundConfig {
  widgetToken: string
  displayName: string
  avatarUrl: string | null
}

export async function getPlaygroundConfig(): Promise<PlaygroundConfig | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data: org, error } = await supabase
    .from('organizations')
    .select('widget_token, widget_display_name, widget_avatar_url')
    .eq('id', orgId as string)
    .single()

  if (error || !org) return null

  return {
    widgetToken: org.widget_token,
    displayName: org.widget_display_name ?? 'AI Assistant',
    avatarUrl: org.widget_avatar_url ?? null,
  }
}
