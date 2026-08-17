// src/app/api/resend/events/route.ts
// Receives Resend delivery event webhooks (delivered, bounced, complained,
// failed, opened, clicked).
// - Updates email_delivery_status on the matching conversation_messages row
//   (inbox replies only — additive, unchanged from before).
// - Updates the matching email_sends row by provider_message_id (all sends —
//   workflow/campaign/invite/calendar/inbox — via the send log from
//   src/lib/email/resend.ts).
// Always returns HTTP 200.

export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { captureApiError } from '@/lib/api-error'
import {
  canResendWebhookSignerAccessOrg,
  validateResendWebhookSignature,
} from '@/lib/email/webhook-secrets'

// Map Resend event types to our conversation_messages delivery status values
// (inbox replies only — unchanged from before email_sends existed).
const EVENT_TO_STATUS: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.delivery_delayed': 'failed',
}

// Map Resend event types to the email_sends status + timestamp column to
// set. 'email.opened'/'email.clicked' are included here even though they're
// excluded from EVENT_TO_STATUS above (conversation_messages has no
// opened/clicked concept) — email_sends does, per its opened_at/clicked_at
// columns (migration 1277). allowedCurrentStatuses keeps late/out-of-order
// events from downgrading clicked → opened or opened/clicked → delivered,
// while bounce/complaint/failure remain terminal overrides.
const EMAIL_SENDS_UPDATE: Record<
  string,
  { status: string; timestampColumn?: string; allowedCurrentStatuses?: string[] }
> = {
  'email.delivered': {
    status: 'delivered',
    timestampColumn: 'delivered_at',
    allowedCurrentStatuses: ['sent', 'delivered'],
  },
  'email.bounced': { status: 'bounced', timestampColumn: 'bounced_at' },
  'email.complained': { status: 'complained', timestampColumn: 'complained_at' },
  'email.failed': { status: 'failed' },
  'email.delivery_delayed': { status: 'failed' },
  'email.opened': {
    status: 'opened',
    timestampColumn: 'opened_at',
    allowedCurrentStatuses: ['sent', 'delivered', 'opened'],
  },
  'email.clicked': {
    status: 'clicked',
    timestampColumn: 'clicked_at',
    allowedCurrentStatuses: ['sent', 'delivered', 'opened', 'clicked'],
  },
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    const signer = await validateResendWebhookSignature(rawBody, request.headers)
    if (!signer) {
      console.warn('[resend/events] Invalid webhook signature')
      return Response.json({ ok: true })
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const eventType = String(payload.type ?? '')
    const data = (payload.data ?? {}) as Record<string, unknown>
    const emailId = String(data.email_id ?? data.id ?? '')

    if (!emailId) {
      console.warn('[resend/events] No email_id in event payload')
      return Response.json({ ok: true })
    }

    const supabase = createServiceRoleClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    // conversation_messages: inbox-reply delivery status. Resolve each
    // message's conversation org first so a tenant-signed event can only
    // mutate that same tenant, even if it supplies another account's
    // provider message id.
    const conversationStatus = EVENT_TO_STATUS[eventType]
    if (conversationStatus) {
      const { data: messageRows, error: messageLookupError } = await db
        .from('conversation_messages')
        .select('id, conversation_id')
        .eq('email_message_id', emailId)

      if (messageLookupError) {
        console.error('[resend/events] Failed to resolve conversation_messages:', messageLookupError.message)
      } else if (messageRows?.length) {
        const conversationIds = [
          ...new Set(
            (messageRows as Array<{ id: string; conversation_id: string }>)
              .map((row) => row.conversation_id)
              .filter(Boolean),
          ),
        ]
        const { data: conversationRows, error: conversationLookupError } = await db
          .from('conversations')
          .select('id, org_id')
          .in('id', conversationIds)

        if (conversationLookupError) {
          console.error('[resend/events] Failed to resolve conversation orgs:', conversationLookupError.message)
        } else {
          const orgByConversation = new Map(
            ((conversationRows ?? []) as Array<{ id: string; org_id: string }>).map((row) => [
              row.id,
              row.org_id,
            ]),
          )
          const authorizedMessageIds = (
            messageRows as Array<{ id: string; conversation_id: string }>
          )
            .filter((row) =>
              canResendWebhookSignerAccessOrg(
                signer,
                orgByConversation.get(row.conversation_id) ?? null,
              ),
            )
            .map((row) => row.id)

          if (authorizedMessageIds.length > 0) {
            const { error } = await db
              .from('conversation_messages')
              .update({ email_delivery_status: conversationStatus })
              .in('id', authorizedMessageIds)

            if (error) {
              console.error(
                '[resend/events] Failed to update conversation_messages delivery status:',
                error.message,
              )
            }
          }
        }
      }
    }

    // email_sends: send log for every outbound email (workflow/campaign/
    // invite/calendar/inbox — anything sent via src/lib/email/resend.ts).
    const sendUpdate = EMAIL_SENDS_UPDATE[eventType]
    if (sendUpdate) {
      const { data: sendRows, error: sendLookupError } = await db
        .from('email_sends')
        .select('id, org_id')
        .eq('provider_message_id', emailId)

      if (sendLookupError) {
        console.error('[resend/events] Failed to resolve email_sends:', sendLookupError.message)
      } else {
        const authorizedSendIds = (
          (sendRows ?? []) as Array<{ id: string; org_id: string | null }>
        )
          .filter((row) => canResendWebhookSignerAccessOrg(signer, row.org_id))
          .map((row) => row.id)

        if (authorizedSendIds.length > 0) {
          const updatePayload: Record<string, string> = { status: sendUpdate.status }
          if (sendUpdate.timestampColumn) {
            updatePayload[sendUpdate.timestampColumn] = new Date().toISOString()
          }

          let query = db.from('email_sends').update(updatePayload).in('id', authorizedSendIds)
          if (sendUpdate.allowedCurrentStatuses) {
            query = query.in('status', sendUpdate.allowedCurrentStatuses)
          }

          const { error } = await query

          if (error) {
            console.error('[resend/events] Failed to update email_sends:', error.message)
          }
        }
      }
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[resend/events] Error processing event:', err)
    captureApiError(err)
    return Response.json({ ok: true })
  }
}
