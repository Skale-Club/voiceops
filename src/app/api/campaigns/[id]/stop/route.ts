// POST /api/campaigns/[id]/stop
// Transitions campaign from in_progress | paused to stopped.
// Contacts still in pending state will not be called.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createClient()

  const { data: member } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()
  if (!member) return Response.json({ error: 'No organization found' }, { status: 403 })

  const { id: campaignId } = await params

  const serviceClient = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data: updated, error } = await serviceClient
    .from('campaigns')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('organization_id', member.organization_id)
    .in('status', ['in_progress', 'paused']) // optimistic lock
    .select('id')
    .single()

  if (error || !updated) {
    return Response.json(
      { error: 'Campaign cannot be stopped (already stopped or completed)' },
      { status: 409 }
    )
  }

  return Response.json({ success: true })
}
