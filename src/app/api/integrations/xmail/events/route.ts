// POST /api/integrations/xmail/events
// Inbound webhook receiver for Xmail engagement events.
//
// Xmail is configured (per Xphere workspace) to POST engagement events here with
// the workspace's Xphere API key as the Bearer token. Events are mapped onto the
// matching prospect's timeline and engagement_status. Replies update engagement —
// they never auto-promote lifecycle_stage (deliberate, per the Prospects spec).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveApiKey } from '@/lib/api-keys/verify'
import { resolveProspectEntity } from '@/lib/prospects/events'
import type { CrmEngagementStatus, ProspectEventType } from '@/types/database'

export const runtime = 'nodejs'

type Mapped = {
  eventType: ProspectEventType
  engagement?: CrmEngagementStatus
  channel: string
  stampReplied?: boolean
}

function mapXmailEvent(name: string): Mapped | null {
  const n = (name || '').toLowerCase()
  if (n.includes('repl')) return { eventType: 'replied', engagement: 'replied', channel: 'email', stampReplied: true }
  if (n.includes('click')) return { eventType: 'clicked', engagement: 'clicked', channel: 'email' }
  if (n.includes('open')) return { eventType: 'opened', engagement: 'opened', channel: 'email' }
  if (n.includes('unsub')) return { eventType: 'unsubscribed', engagement: 'unsubscribed', channel: 'email' }
  if (n.includes('bounce')) return { eventType: 'bounced', channel: 'email' }
  if (n.includes('deliver')) return { eventType: 'delivered', channel: 'email' }
  if (n.includes('sent') || n.includes('send')) return { eventType: 'sent', engagement: 'contacted', channel: 'email' }
  return null
}

export async function POST(request: Request): Promise<Response> {
  const supabase = createServiceRoleClient()

  const key = await resolveApiKey(request, supabase)
  if (!key) return Response.json({ error: 'Invalid or missing API key' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventName = (body.event as string) || (body.type as string) || ''
  const mapped = mapXmailEvent(eventName)
  if (!mapped) return Response.json({ ok: true, ignored: 'unmapped_event' })

  const data = (body.data as Record<string, unknown>) ?? body
  const xphereId =
    (data.xphere_id as string) ?? ((data.customFields as Record<string, unknown>)?.xphere_id as string) ?? null
  const xphereKind =
    (data.xphere_kind as string) ?? ((data.customFields as Record<string, unknown>)?.xphere_kind as string) ?? null
  const email = (data.email as string) ?? (data.leadEmail as string) ?? null

  const ref = await resolveProspectEntity(supabase, key.orgId, { xphereId, xphereKind, email })
  if (!ref) return Response.json({ ok: true, ignored: 'no_match' })

  const now = new Date().toISOString()

  // Timeline event.
  await supabase.from('prospect_engagement_events').insert({
    org_id: key.orgId,
    entity_type: ref.entityType,
    entity_id: ref.entityId,
    event_type: mapped.eventType,
    channel: mapped.channel,
    source_platform: 'xmail',
    occurred_at: now,
    payload: { event: eventName },
  })

  // Engagement summary on the record (never touches lifecycle_stage).
  if (mapped.engagement) {
    const table = ref.entityType === 'account' ? 'accounts' : 'contacts'
    const patch: Record<string, unknown> = { engagement_status: mapped.engagement, updated_at: now }
    if (mapped.stampReplied) patch.last_replied_at = now
    await supabase.from(table).update(patch).eq('id', ref.entityId).eq('org_id', key.orgId)
  }

  // A real bounce is the strongest deliverability signal there is — permanently
  // mark the address non-sendable across every channel/campaign, not just this
  // one. See src/lib/email-verification (email_status is the prospect's source
  // of truth, cache-first) and riskForStatus/isSendable in verify.ts.
  if (mapped.eventType === 'bounced') {
    const table = ref.entityType === 'account' ? 'accounts' : 'contacts'
    await supabase
      .from(table)
      .update({
        email_status: 'bounced',
        email_risk: 'high',
        email_verified_at: now,
        email_verification_provider: 'bounce',
        updated_at: now,
      })
      .eq('id', ref.entityId)
      .eq('org_id', key.orgId)
  }

  return Response.json({ ok: true })
}
