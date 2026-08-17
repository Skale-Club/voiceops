/**
 * Campaign dispatcher for email (Resend, via the tenant's own integration).
 *
 * Modeled closely on src/lib/campaigns/whatsapp-dispatcher.ts — same overall
 * shape (load campaign + template, iterate `status='pending'` recipients in
 * batches, update each row to a terminal status, mark the campaign
 * 'completed' once zero 'pending' remain) so the two dispatchers stay easy
 * to read side by side.
 *
 *   1. Loads the campaign, verifies channel === 'email', resolves the
 *      template id from `template_config->>'email_template_id'`
 *   2. Loads the `email_templates` row — requires status='published' and a
 *      non-null html_snapshot (the same guards send_email_template.ts
 *      applies before it will send)
 *   3. Iterates recipients with status='pending' in small batches
 *   4. Per recipient:
 *      - Skip (status='skipped') when the contact is missing or has no email
 *      - Skip (status='skipped') when the contact has DND active for 'email'
 *        (same inline dnd_enabled/dnd_channels check whatsapp-dispatcher.ts
 *        uses — see src/lib/dnd.ts's checkDnd for the authenticated-client
 *        equivalent used by the action engine)
 *      - Personalize subject/html/text via renderWithVariables, with a
 *        { contact: { ... } } variable scope matching the fields the rest
 *        of the app exposes to templates (src/lib/flows/variables.ts's
 *        CONTACT_GROUP: name, first_name, last_name, email, phone, company,
 *        notes, source, id)
 *      - Send via sendTenantEmail(..., { kind: 'marketing', source: 'campaign' })
 *        — non-negotiable: this is what applies the org's unsubscribe
 *        suppression list, compliance footer, and List-Unsubscribe headers
 *      - Maps the result: { id } → 'sent' (id stored in `result` jsonb),
 *        { error } → 'failed', { skipped: true } → 'unsubscribed' (NOT
 *        'skipped' — the recipient status CHECK has a dedicated value for
 *        "was on the org's unsubscribe list", and that's a materially
 *        different outcome from "never had a usable address")
 *   5. When all recipients are terminal → campaigns.status = 'completed'
 *
 * Rate limiting — deliberately NOT copied from whatsapp-dispatcher.ts:
 * Meta's Cloud API tolerates tens of messages/sec; Resend's default API rate
 * limit is a small, fixed number of requests per second (documented as 2
 * req/s — see https://resend.com/docs/api-reference/introduction#rate-limit),
 * and every send here does real synchronous work beyond the HTTP call itself
 * (suppression-list lookup, org lookup for the compliance footer, signing an
 * unsubscribe token, and an email_sends log insert, all inside
 * sendTenantEmail). Recipients are processed strictly sequentially (never
 * Promise.all'd) and an explicit delay follows every send — not just every
 * batch — so the pace stays well under Resend's limit regardless of how fast
 * an individual send happens to complete.
 *
 * Future optimization NOT taken here: `resend.batch.send` (up to 100
 * emails/call) would cut round trips dramatically, but it can't be used
 * naively for marketing campaign sends — every recipient needs their own
 * unsubscribe token and compliance footer baked into their HTML, which
 * sendTenantEmail computes per-recipient (signUnsubscribeToken + buildFooter
 * inside src/lib/email/resend.ts). Batching would mean either abandoning
 * sendTenantEmail (and reimplementing its compliance path per item) or
 * pre-rendering N personalized HTML bodies before a single batch call — a
 * real optimization, but out of scope for closing the "nothing sends" gap.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { renderWithVariables } from '@/lib/email/merge-tags'
import { sendTenantEmail } from '@/lib/email/resend'

// Conservative and intentionally small — see the rate-limiting note above.
// BATCH_SIZE only governs how many recipient rows we page in from the DB at
// once (for large campaigns to page through inside maxDuration, same reason
// whatsapp-dispatcher.ts batches); it is NOT a concurrency knob — recipients
// within a batch are still sent one at a time.
const BATCH_SIZE = 10
// Applied after every single send (not just every batch). ~700ms keeps
// sustained throughput under ~1.4 req/s, comfortably below Resend's
// documented 2 req/s default even accounting for Resend-side variance.
const SEND_DELAY_MS = 700

export interface DispatchResult {
  ok: boolean
  error?: string
  processed: number
  sent: number
  failed: number
  skipped: number
  /** Recipients on the org's unsubscribe suppression list — a distinct terminal status from 'skipped'. */
  unsubscribed: number
}

export async function startEmailCampaign(campaignId: string): Promise<DispatchResult> {
  const supabase = createServiceRoleClient()

  const emptyResult = (error: string): DispatchResult => ({
    ok: false,
    error,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    unsubscribed: 0,
  })

  // 1. Load campaign + resolve + load template
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, organization_id, channel, template_config, status')
    .eq('id', campaignId)
    .maybeSingle()

  if (campErr || !campaign) return emptyResult('Campaign not found')
  if (campaign.channel !== 'email') return emptyResult('Campaign is not an email campaign')

  const templateConfig = (campaign.template_config ?? {}) as Record<string, unknown>
  const templateId = typeof templateConfig.email_template_id === 'string' ? templateConfig.email_template_id : ''
  if (!templateId) return emptyResult('Campaign has no email template selected')

  // Service role bypasses RLS — filter by org_id explicitly, same as
  // send-email-template.ts does for the action-engine executor.
  const { data: template, error: templateErr } = await supabase
    .from('email_templates')
    .select('id, subject_line, html_snapshot, plain_text_snapshot, status')
    .eq('id', templateId)
    .eq('org_id', campaign.organization_id)
    .maybeSingle()

  if (templateErr) return emptyResult(`Failed to load email template: ${templateErr.message}`)
  if (!template) return emptyResult('Email template not found')
  if (template.status !== 'published') {
    return emptyResult(`Email template is not published (status: ${template.status}) — publish it before launching`)
  }
  if (!template.html_snapshot) {
    return emptyResult('Email template has no html_snapshot — save/publish it first')
  }
  const subjectTemplate = (template.subject_line ?? '').trim()
  if (!subjectTemplate) {
    return emptyResult('Email template has no subject line — set one before launching')
  }

  // The API route claims the campaign before scheduling this dispatcher. Keep
  // direct callers safe too: only one caller may transition an idle campaign
  // to running, while an already-running campaign is accepted as the route's
  // claimed execution.
  if (campaign.status !== 'running') {
    const { data: claimed, error: claimError } = await supabase
      .from('campaigns')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', campaignId)
      .in('status', ['draft', 'scheduled', 'paused'])
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) return emptyResult('Campaign could not be claimed for dispatch')
  }

  // 2. Process recipients in batches
  let processed = 0
  let sent = 0
  let failed = 0
  let skipped = 0
  let unsubscribed = 0
  const failedResult = (error: string): DispatchResult => ({
    ok: false,
    error,
    processed,
    sent,
    failed,
    skipped,
    unsubscribed,
  })

  while (true) {
    // Pause/stop is cooperative: finish at most the current batch, then
    // leave remaining rows pending for a later resume.
    const { data: state, error: stateError } = await supabase
      .from('campaigns')
      .select('status')
      .eq('id', campaignId)
      .maybeSingle()
    if (stateError) return failedResult(`Failed to read campaign state: ${stateError.message}`)
    if (state?.status !== 'running') break

    const { data: batch, error: batchError } = await supabase
      .from('campaign_recipients')
      .select('id, contact_id, status')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .limit(BATCH_SIZE)

    if (batchError) return failedResult(`Failed to load recipients: ${batchError.message}`)
    if (!batch || batch.length === 0) break

    const contactIds = batch.map((r) => r.contact_id).filter((id): id is string => Boolean(id))
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name, email, phone, company, notes, source, dnd_enabled, dnd_channels')
      .in('id', contactIds.length > 0 ? contactIds : ['00000000-0000-0000-0000-000000000000'])
    if (contactsError) return failedResult(`Failed to load recipient contacts: ${contactsError.message}`)

    const contactMap = new Map((contacts ?? []).map((c) => [c.id, c]))

    for (const recipient of batch) {
      processed += 1
      const contact = recipient.contact_id ? contactMap.get(recipient.contact_id) : null

      if (!contact || !contact.email) {
        const updateError = await markSkipped(recipient.id, 'Contact missing or no email address')
        if (updateError) return failedResult(updateError)
        skipped += 1
        continue
      }

      // DND — inline check, same fields/semantics as whatsapp-dispatcher.ts
      // (contact.dnd_enabled + dnd_channels includes 'email' or 'all').
      if (contact.dnd_enabled && Array.isArray(contact.dnd_channels) && (contact.dnd_channels.includes('email') || contact.dnd_channels.includes('all'))) {
        const updateError = await markSkipped(recipient.id, 'Contact opted out (DND)')
        if (updateError) return failedResult(updateError)
        skipped += 1
        continue
      }

      const vars = {
        contact: {
          id: contact.id,
          name: contact.name ?? null,
          first_name: contact.first_name ?? null,
          last_name: contact.last_name ?? null,
          email: contact.email,
          phone: contact.phone ?? null,
          company: contact.company ?? null,
          notes: contact.notes ?? null,
          source: contact.source ?? null,
        },
      }

      const subject = renderWithVariables(subjectTemplate, vars)
      const html = renderWithVariables(template.html_snapshot, vars)
      const text = template.plain_text_snapshot ? renderWithVariables(template.plain_text_snapshot, vars) : undefined

      const result = await sendTenantEmail(campaign.organization_id, contact.email, subject, html, undefined, {
        kind: 'marketing',
        source: 'campaign',
        text,
      })

      if (result.skipped) {
        // Recipient is on the org's unsubscribe suppression list — a
        // distinct, dedicated terminal status (not 'skipped', which here
        // means "never had a usable address / DND").
        const { error: updateError } = await supabase
          .from('campaign_recipients')
          .update({ status: 'unsubscribed', error_message: 'Recipient unsubscribed (org suppression list)', updated_at: new Date().toISOString() })
          .eq('id', recipient.id)
        if (updateError) {
          return failedResult(`Failed to persist unsubscribed recipient: ${updateError.message}`)
        }
        unsubscribed += 1
      } else if (result.error) {
        const updateError = await markFailed(recipient.id, result.error)
        if (updateError) return failedResult(updateError)
        failed += 1
      } else {
        const { error: updateError } = await supabase
          .from('campaign_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            result: { message_id: result.id ?? null },
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipient.id)
        if (updateError) return failedResult(`Failed to persist sent recipient: ${updateError.message}`)
        sent += 1
      }

      // Throttle — see the rate-limiting note in the file header.
      await sleep(SEND_DELAY_MS)
    }
  }

  // 3. Mark campaign completed if no pending remain
  const { count: pendingLeft, error: pendingError } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
  if (pendingError) return failedResult(`Failed to count pending recipients: ${pendingError.message}`)

  if ((pendingLeft ?? 0) === 0) {
    const { error: completionError } = await supabase
      .from('campaigns')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', campaignId)
      .in('status', ['running', 'paused'])
    if (completionError) {
      return failedResult(`Failed to mark campaign completed: ${completionError.message}`)
    }
  }

  return { ok: true, processed, sent, failed, skipped, unsubscribed }

  // ── helpers ──
  async function markSkipped(id: string, reason: string): Promise<string | null> {
    const { error } = await supabase
      .from('campaign_recipients')
      .update({ status: 'skipped', error_message: reason, updated_at: new Date().toISOString() })
      .eq('id', id)
    return error ? `Failed to persist skipped recipient: ${error.message}` : null
  }
  async function markFailed(id: string, reason: string): Promise<string | null> {
    const { error } = await supabase
      .from('campaign_recipients')
      .update({ status: 'failed', error_message: reason, updated_at: new Date().toISOString() })
      .eq('id', id)
    return error ? `Failed to persist failed recipient: ${error.message}` : null
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
