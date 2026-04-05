// GET /api/chat/settings — widget display name and avatar URL for the active org
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  const { data: org, error } = await supabase
    .from('organizations')
    .select('widget_display_name, widget_avatar_url')
    .eq('id', orgId as string)
    .single()

  if (error || !org) {
    return Response.json({ error: 'Organization not found' }, { status: 404 })
  }

  return Response.json({
    displayName: org.widget_display_name ?? 'AI Assistant',
    avatarUrl: org.widget_avatar_url ?? null,
  })
}
