// POST /api/campaigns/[id]/start
// Transitions campaign to in_progress and fires first batch of calls.
// Uses service-role client for engine operations.
// Called from UI via fetch() in client component.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient, getUser } from '@/lib/supabase/server'
import { startCampaignBatch } from '@/lib/campaigns/engine'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import type { Database } from '@/types/database'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createClient()

  // Get user's org — scope all campaign operations to it
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

  // Optimistic status transition: draft | paused → in_progress
  // organization_id filter enforces ownership even through service-role client
  const { data: updated, error } = await serviceClient
    .from('campaigns')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('organization_id', member.organization_id)
    .in('status', ['draft', 'scheduled', 'paused'])
    .select('id, organization_id')
    .single()

  if (error || !updated) {
    return Response.json(
      { error: 'Campaign cannot be started (already running, completed, or stopped)' },
      { status: 409 }
    )
  }

  // Fetch Vapi API key from org's integrations — required for outbound calls
  const vapiApiKey = await getProviderKey('vapi', updated.organization_id, serviceClient)
  if (!vapiApiKey) {
    // Roll back status since we cannot fire calls without the key
    const { error: rollbackErr } = await serviceClient
      .from('campaigns')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
    if (rollbackErr) {
      console.error('[start] Rollback failed — campaign may be stuck in_progress:', rollbackErr.message)
    }

    return Response.json(
      { error: 'No Vapi integration configured. Add a Vapi integration in Settings.' },
      { status: 400 }
    )
  }

  // Fire first batch asynchronously — UI polls or uses Realtime for progress
  const result = await startCampaignBatch(campaignId, serviceClient, vapiApiKey)

  return Response.json({ success: true, fired: result.fired, errors: result.errors })
}
