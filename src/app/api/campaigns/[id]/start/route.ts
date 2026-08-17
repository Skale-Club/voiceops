// POST /api/campaigns/[id]/start
// Transitions campaign to in_progress and fires first batch of calls.
// Uses service-role client for engine operations.
// Called from UI via fetch() in client component.

import { after } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient, getUser } from '@/lib/supabase/server'
import { isDemoSession } from '@/lib/demo/guard'
import { startCampaignBatch } from '@/lib/campaigns/engine'
import { startWhatsAppCampaign } from '@/lib/campaigns/whatsapp-dispatcher'
import { startEmailCampaign } from '@/lib/campaigns/email-dispatcher'
import { enrollCampaignRecipients } from '@/lib/campaigns/enroll-recipients'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import type { Database } from '@/types/database'
import { captureApiError } from '@/lib/api-error'

// Extend Vercel function timeout so the WhatsApp dispatcher has room to
// process larger campaign batches inside `after()`. Pro: max 300s.
// For very large campaigns (>4k recipients) the dispatcher will leave
// remaining rows as 'pending' and a re-invocation picks them up.
export const maxDuration = 300

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (await isDemoSession()) {
    return Response.json({ error: 'Demo mode is read-only.' }, { status: 403 })
  }
  const supabase = await createClient()

  // Get user's org | scope all campaign operations to it
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

  // Branch by channel — WhatsApp Cloud campaigns use a different engine
  const { data: campaignRow } = await serviceClient
    .from('campaigns')
    .select('id, channel, status, organization_id')
    .eq('id', campaignId)
    .eq('organization_id', member.organization_id)
    .single()
  if (!campaignRow) {
    return Response.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (campaignRow.channel === 'whatsapp') {
    if (!['draft', 'scheduled', 'paused'].includes(campaignRow.status)) {
      return Response.json(
        { error: 'Campaign cannot be started (already running, completed, or stopped)' },
        { status: 409 }
      )
    }
    const enrollResult = await enrollCampaignRecipients(campaignId)
    if (!enrollResult.ok) {
      return Response.json(
        { error: `Could not enroll recipients: ${enrollResult.error ?? 'unknown error'}` },
        { status: 400 }
      )
    }
    if (enrollResult.enrolled === 0) {
      const { count: pendingCount } = await serviceClient
        .from('campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
      if ((pendingCount ?? 0) === 0) {
        return Response.json(
          { error: 'No recipients match this campaign’s audience — nothing to send. Check the audience filter and try again.' },
          { status: 400 }
        )
      }
    }

    // Claim the campaign atomically before registering background work. This
    // closes the double-click race where two requests could both select the
    // same pending rows and send duplicate messages.
    const { data: claimed } = await serviceClient
      .from('campaigns')
      .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('organization_id', member.organization_id)
      .in('status', ['draft', 'scheduled', 'paused'])
      .select('id')
      .maybeSingle()
    if (!claimed) {
      return Response.json(
        { error: 'Campaign cannot be started (already running, completed, or stopped)' },
        { status: 409 }
      )
    }

    // Kick off in the background so the response returns immediately.
    after(async () => {
      try {
        const result = await startWhatsAppCampaign(campaignId)
        if (!result.ok) {
          console.error('[campaigns/start] whatsapp dispatcher rejected campaign:', result.error)
          await serviceClient
            .from('campaigns')
            .update({ status: 'paused', updated_at: new Date().toISOString() })
            .eq('id', campaignId)
            .eq('status', 'running')
        }
      } catch (err) {
        console.error('[campaigns/start] whatsapp dispatcher error:', err)
        captureApiError(err)
        await serviceClient
          .from('campaigns')
          .update({ status: 'paused', updated_at: new Date().toISOString() })
          .eq('id', campaignId)
          .eq('status', 'running')
      }
    })
    return Response.json({ success: true, channel: 'whatsapp', enrolled: enrollResult.enrolled })
  }

  if (campaignRow.channel === 'email') {
    if (!['draft', 'scheduled', 'paused'].includes(campaignRow.status)) {
      return Response.json(
        { error: 'Campaign cannot be started (already running, completed, or stopped)' },
        { status: 409 }
      )
    }

    // Materialize the audience_filter into campaign_recipients BEFORE
    // dispatching — nothing else in the app writes to that table (see
    // src/lib/campaigns/enroll-recipients.ts). Idempotent, so a retried
    // launch never double-enrolls.
    const enrollResult = await enrollCampaignRecipients(campaignId)
    if (!enrollResult.ok) {
      return Response.json(
        { error: `Could not enroll recipients: ${enrollResult.error ?? 'unknown error'}` },
        { status: 400 }
      )
    }
    if (enrollResult.enrolled === 0) {
      // Zero-recipient check: a campaign with pre-existing pending rows from
      // an earlier partial run should still be allowed to resume, so only
      // block the launch when there are truly no pending recipients at all
      // (fresh audience match found nobody AND nothing was left over).
      const { count: pendingCount } = await serviceClient
        .from('campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
      if ((pendingCount ?? 0) === 0) {
        return Response.json(
          { error: 'No recipients match this campaign’s audience — nothing to send. Check the audience filter and try again.' },
          { status: 400 }
        )
      }
    }

    const { data: claimed } = await serviceClient
      .from('campaigns')
      .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('organization_id', member.organization_id)
      .in('status', ['draft', 'scheduled', 'paused'])
      .select('id')
      .maybeSingle()
    if (!claimed) {
      return Response.json(
        { error: 'Campaign cannot be started (already running, completed, or stopped)' },
        { status: 409 }
      )
    }

    // Kick off in the background so the response returns immediately.
    after(async () => {
      try {
        const result = await startEmailCampaign(campaignId)
        if (!result.ok) {
          console.error('[campaigns/start] email dispatcher rejected campaign:', result.error)
          await serviceClient
            .from('campaigns')
            .update({ status: 'paused', updated_at: new Date().toISOString() })
            .eq('id', campaignId)
            .eq('status', 'running')
        }
      } catch (err) {
        console.error('[campaigns/start] email dispatcher error:', err)
        captureApiError(err)
        await serviceClient
          .from('campaigns')
          .update({ status: 'paused', updated_at: new Date().toISOString() })
          .eq('id', campaignId)
          .eq('status', 'running')
      }
    })
    return Response.json({ success: true, channel: 'email', enrolled: enrollResult.enrolled })
  }

  if (campaignRow.channel === 'sms') {
    // No dispatcher exists yet for this channel. Fail loudly and leave the
    // campaign status untouched — never let the UI imply something was sent
    // when nothing was queued.
    return Response.json(
      { error: 'SMS campaigns cannot be launched yet — this channel has no dispatcher configured.' },
      { status: 400 }
    )
  }

  if (campaignRow.channel !== 'calls') {
    return Response.json(
      { error: `Unsupported campaign channel "${campaignRow.channel}" — cannot launch.` },
      { status: 400 }
    )
  }

  // Voice campaigns: existing path
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

  // Fetch Vapi API key from org's integrations | required for outbound calls
  const vapiApiKey = await getProviderKey('vapi', updated.organization_id, serviceClient)
  if (!vapiApiKey) {
    // Roll back status since we cannot fire calls without the key
    const { error: rollbackErr } = await serviceClient
      .from('campaigns')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
    if (rollbackErr) {
      console.error('[start] Rollback failed | campaign may be stuck in_progress:', rollbackErr.message)
    }

    return Response.json(
      { error: 'No Vapi integration configured. Add a Vapi integration in Settings.' },
      { status: 400 }
    )
  }

  // Fire first batch asynchronously | UI polls or uses Realtime for progress
  const result = await startCampaignBatch(campaignId, serviceClient, vapiApiKey)

  return Response.json({ success: true, fired: result.fired, errors: result.errors })
}
