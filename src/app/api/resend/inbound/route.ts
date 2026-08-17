// src/app/api/resend/inbound/route.ts
// Receives inbound email events from Resend via webhook.
// Validates signature → routes to org → finds/creates contact → finds/creates conversation → saves message.
// Always returns HTTP 200 per webhook reliability convention.

export const runtime = 'nodejs'

import crypto from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { captureApiError } from '@/lib/api-error'
import {
  canResendWebhookSignerAccessOrg,
  validateResendWebhookSignature,
} from '@/lib/email/webhook-secrets'

// Resend uses Svix for webhook delivery. Signature validation is shared with
// /api/resend/events via src/lib/email/webhook-secrets.ts, which tries every
// configured signing secret (platform + all tenants — see migration 1278).

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    const signer = await validateResendWebhookSignature(rawBody, request.headers)
    if (!signer) {
      console.warn('[resend/inbound] Invalid webhook signature')
      // Still return 200 to avoid Resend retrying indefinitely for bad-sig events
      return Response.json({ ok: true })
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>

    // Resend inbound email payload shape
    const emailData = (payload.data ?? payload) as Record<string, unknown>
    const from = String(emailData.from ?? '')
    const toRaw = emailData.to
    const to = Array.isArray(toRaw) ? String(toRaw[0] ?? '') : String(toRaw ?? '')
    const subject = String(emailData.subject ?? '(no subject)')
    const html = String(emailData.html ?? emailData.text ?? '')
    const messageId = String(emailData.email_id ?? emailData.id ?? crypto.randomUUID())

    if (!from || !to) {
      console.warn('[resend/inbound] Missing from/to in payload')
      return Response.json({ ok: true })
    }

    const supabase = createServiceRoleClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    // 1. Find org from inbound_email_routes by `to` address
    const toNormalized = to.toLowerCase().trim()
    const { data: routeRaw } = await db
      .from('inbound_email_routes')
      .select('org_id')
      .eq('route_address', toNormalized)
      .eq('is_active', true)
      .single()

    const route = routeRaw as { org_id: string } | null

    if (!route) {
      // No route registered for this address — ignore silently
      return Response.json({ ok: true })
    }

    const orgId = route.org_id
    if (!canResendWebhookSignerAccessOrg(signer, orgId)) {
      // A valid tenant webhook secret only authorizes that tenant's route.
      // Keep the webhook always-200 contract while refusing the cross-tenant
      // payload.
      console.warn('[resend/inbound] Valid signature is not authorized for resolved route org')
      return Response.json({ ok: true })
    }

    // 2. Find or create contact by `from` email
    const fromEmail = from.replace(/^.*<(.+)>$/, '$1').toLowerCase().trim()
    let contactId: string | null = null

    const { data: existingContactRaw } = await db
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', fromEmail)
      .single()

    const existingContact = existingContactRaw as { id: string } | null

    if (existingContact) {
      contactId = existingContact.id
    } else {
      // Create a minimal contact from the from address
      const fromName = from.includes('<') ? from.replace(/<.*>/, '').trim() : fromEmail
      const { data: newContactRaw } = await db
        .from('contacts')
        .insert({
          org_id: orgId,
          email: from,
          email_normalized: fromEmail,
          name: fromName || null,
          source: 'manual',
        })
        .select('id')
        .single()

      contactId = (newContactRaw as { id: string } | null)?.id ?? null
    }

    // Without a resolved contact we can't dedup the thread by contact_id, and
    // passing '' to a uuid column would error. Skip gracefully (still 200).
    if (!contactId) {
      console.warn('[resend/inbound] No contact resolved for', fromEmail, '| skipping')
      return Response.json({ ok: true })
    }

    // 3+4. Find-or-create the email thread + insert the inbound message via the
    // shared normalizer (dedup by org + channel='email' + contact_id, newest
    // open thread). last_message is bumped in step 5 below, so updatePayload is
    // empty (no touch on the existing thread here).
    const norm = await normalizeInbound({
      supabase,
      orgId,
      channel: 'email',
      match: { by: 'contact_open', contactId },
      updatePayload: {},
      createPayload: {
        widget_token: crypto.randomUUID(), // required field
        contact_id: contactId,
        visitor_email: fromEmail,
        status: 'open',
        last_active_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        last_message: subject,
        channel_metadata: { inbound_address: toNormalized },
      },
      message: {
        role: 'user',
        content: html,
        channel: 'email',
        message_type: 'email',
        email_subject: subject,
        email_from: from,
        email_to: to,
        email_message_id: messageId,
        email_delivery_status: 'delivered',
      },
    })

    if (norm.error) {
      console.error('[resend/inbound] Failed to persist inbound email for org', orgId, norm.error)
      return Response.json({ ok: true })
    }
    const conversationId = norm.conversationId

    // 5. Update conversation last_message
    await db
      .from('conversations')
      .update({
        last_message: subject,
        last_message_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[resend/inbound] Error processing webhook:', err)
    captureApiError(err)
    return Response.json({ ok: true })
  }
}
