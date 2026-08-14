// MCP tool: prospect_send_message — the reusable "door" for a single, direct
// 1:1 message (email or SMS) to ONE prospect. Distinct from
// prospects_enroll_in_campaign (bulk, sequence-driven, owned by Xmail's
// campaign engine): this tool sends exactly one message right now, e.g.
// dropping an estimate link (built via the skaleclub MCP) into a prospect's
// inbox or phone after a call or follow-up.
//
// Email goes out through Xmail's native info@ inbox
// (xmailSendMessage → POST /api/outreach/send-message), not a campaign.
// SMS goes out through the org's connected Twilio number (src/lib/twilio/send-sms.ts).
//
// SAFETY: gated by confirmed:true exactly like prospects_enroll_in_campaign —
// the agent must call once without confirmed to preview (who, what channel,
// message preview), show the human, and only call again with confirmed:true
// once approved.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { isXmailConfigured, xmailSendMessage } from '@/lib/xmail/client'
import { sendSms } from '@/lib/twilio/send-sms'
import type { ActionContext } from '@/lib/action-engine/execute-action'
import { emailFromCustomFields } from './prospects'
import { verifyProspectEmail, isSendable } from '@/lib/email-verification/verify'
import { isDndBlocked, loadEmailSuppressions, normalizeOutreachEmail } from '@/lib/prospects/outreach-eligibility'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

const DEFAULT_FROM_EMAIL = process.env.XMAIL_ESTIMATE_FROM || 'info@skale.club'

type ProspectKindInput = 'contact' | 'account' | 'person' | 'company'
type EntityKind = 'contact' | 'account'

function normalizeKind(kind: ProspectKindInput): EntityKind {
  if (kind === 'person') return 'contact'
  if (kind === 'company') return 'account'
  return kind
}

type ResolvedTarget = {
  kind: EntityKind
  id: string
  name: string | null
  email: string | null
  phone: string | null
  dndEnabled: boolean
  dndChannels: string[]
}

function composeName(r: { first_name?: string | null; last_name?: string | null; name?: string | null }): string | null {
  const composed = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  return composed || r.name?.trim() || null
}

/** Resolve a single prospect by id + kind (mirrors resolveProspects' extraction rules in prospects.ts). */
async function resolveTarget(orgId: string, kind: EntityKind, id: string): Promise<ResolvedTarget | null> {
  if (kind === 'contact') {
    const { data } = await db()
      .from('contacts')
      .select('id, first_name, last_name, name, email, phone, phone_e164, custom_fields, dnd_enabled, dnd_channels')
      .eq('org_id', orgId)
      .eq('id', id)
      .eq('lifecycle_stage', 'prospect')
      .maybeSingle()
    if (!data) return null
    const email = (data.email as string | null) ?? emailFromCustomFields(data.custom_fields)
    return {
      kind: 'contact',
      id: data.id as string,
      name: composeName(data as { first_name?: string | null; last_name?: string | null; name?: string | null }),
      email,
      phone: (data.phone_e164 as string | null) ?? (data.phone as string | null) ?? null,
      dndEnabled: Boolean(data.dnd_enabled),
      dndChannels: (data.dnd_channels as string[] | null) ?? [],
    }
  }

  // accounts (companies) have no email column — the scraped email lives in custom_fields.email.
  const { data } = await db()
    .from('accounts')
    .select('id, name, phone, custom_fields')
    .eq('org_id', orgId)
    .eq('id', id)
    .eq('lifecycle_stage', 'prospect')
    .maybeSingle()
  if (!data) return null
  return {
    kind: 'account',
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    email: emailFromCustomFields(data.custom_fields),
    phone: (data.phone as string | null) ?? null,
    dndEnabled: false,
    dndChannels: [],
  }
}

/** Mark the prospect contacted + log a 'sent' timeline event (mirrors markEnrolled in prospects.ts). */
async function markContacted(
  orgId: string,
  target: ResolvedTarget,
  channel: 'email' | 'sms',
  payload: Record<string, unknown>,
): Promise<void> {
  const nowIso = new Date().toISOString()
  const table = target.kind === 'contact' ? 'contacts' : 'accounts'
  await db().from(table).update({ engagement_status: 'contacted', last_contacted_at: nowIso, updated_at: nowIso }).eq('id', target.id)
  await db()
    .from('prospect_engagement_events')
    .insert({
      org_id: orgId,
      entity_type: target.kind,
      entity_id: target.id,
      event_type: 'sent',
      channel,
      source_platform: 'hermes',
      payload,
    })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap a plain-text body to minimal HTML when the caller didn't supply body_html. */
function toHtml(body: string): string {
  return `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`
}

export const prospectSendMessageTools: McpToolDef[] = [
  {
    name: 'prospect_send_message',
    title: 'Send a 1:1 message to a prospect',
    description:
      'Send a single, direct message (email or SMS) to ONE prospect — the reusable "door" for things like sending an estimate link after a call or follow-up. This is NOT the bulk campaign tool (use prospects_enroll_in_campaign for sequences to many prospects) — this sends exactly one message right now. Estimate links (built via the skaleclub MCP) go in `body`. SAFETY: always call WITHOUT confirmed first to preview who/what/channel, show the human that preview, and only call again with confirmed:true once they approve — nothing is sent until then.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        prospect_id: z.string().min(1).describe('The contact/account id, from prospects_list.'),
        prospect_kind: z.enum(['contact', 'account', 'person', 'company']).describe("The prospect's kind from prospects_list ('person'/'company' are normalized to 'contact'/'account')."),
        channel: z.enum(['email', 'sms']),
        subject: z.string().max(300).optional().describe('Email subject. Required for channel=email; ignored for sms.'),
        body: z
          .string()
          .min(1)
          .max(20000)
          .describe('The message text. For email, this is auto-wrapped into minimal HTML unless body_html is given. Put estimate links or other URLs directly in here.'),
        body_html: z.string().max(40000).optional().describe('Optional rich HTML body for email — overrides the auto-wrapped `body`.'),
        from_email: z
          .string()
          .email()
          .optional()
          .describe(`Sending inbox for the email channel. Defaults to XMAIL_ESTIMATE_FROM or '${DEFAULT_FROM_EMAIL}'.`),
        confirmed: z.boolean().optional().describe('Must be true to actually send. Leave false/absent for a dry-run preview.'),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const { prospect_id, prospect_kind, channel, subject, body, body_html, from_email, confirmed } = input
      const orgId = auth.orgId
      const kind = normalizeKind(prospect_kind)

      const target = await resolveTarget(orgId, kind, prospect_id)
      if (!target) {
        return {
          error: 'not_found',
          detail: `No prospect found for prospect_id=${prospect_id} prospect_kind=${prospect_kind} in this org (or it is no longer lifecycle_stage='prospect').`,
        }
      }

      if (isDndBlocked(target.dndEnabled, target.dndChannels, channel)) {
        return {
          error: 'dnd_blocked',
          detail: `Prospect ${target.name ?? target.id} has ${channel} blocked in Xphere.`,
        }
      }

      if (channel === 'email') {
        if (!subject) {
          return { error: 'missing_subject', detail: 'channel=email requires a subject.' }
        }
        if (!target.email) {
          return {
            error: 'no_email',
            detail: `Prospect ${target.name ?? target.id} has no resolvable email address. Try channel=sms if a phone number is available, or re-scrape/enrich the record.`,
          }
        }
      } else {
        if (!target.phone) {
          return {
            error: 'no_phone',
            detail: `Prospect ${target.name ?? target.id} has no resolvable phone number. Try channel=email if an email address is available.`,
          }
        }
      }

      const to = channel === 'email' ? (target.email as string) : (target.phone as string)
      const fromEmail = from_email || DEFAULT_FROM_EMAIL

      if (channel === 'email') {
        const suppressed = await loadEmailSuppressions(db(), orgId, [to])
        const normalized = normalizeOutreachEmail(to)
        if (normalized && suppressed.has(normalized)) {
          return {
            error: 'email_suppressed',
            detail: `Prospect ${target.name ?? target.id} has unsubscribed from email outreach.`,
          }
        }
      }

      // Email is verified (cache-first) before it is ever previewed as sendable
      // or actually sent — this is the prospect's source of truth, checked once
      // and reused across every channel/campaign for 90 days.
      let emailStatus: string | undefined
      if (channel === 'email') {
        const verification = await verifyProspectEmail(orgId, kind, target.id, to)
        if ('blocked' in verification) {
          return {
            error: 'verification_unavailable',
            verification_unavailable: true,
            detail: `Email verification is unavailable right now (no verification credits) for ${to} — refusing to send unverified. ${verification.detail ?? ''}`.trim(),
          }
        }
        if (!isSendable(verification.status)) {
          return {
            error: 'email_not_sendable',
            detail: `Prospect ${target.name ?? target.id}'s email (${to}) verified as '${verification.status}' — not safe to send to.`,
            email_status: verification.status,
          }
        }
        emailStatus = verification.status
      }

      if (!confirmed) {
        return {
          dry_run: true,
          channel,
          to,
          subject: channel === 'email' ? subject : undefined,
          body_preview: body.slice(0, 200),
          from_email: channel === 'email' ? fromEmail : undefined,
          email_status: emailStatus,
          message: 'Nothing was sent (confirmed was not true). Show the human this preview, then call again with confirmed:true to send.',
        }
      }

      if (channel === 'email') {
        if (!isXmailConfigured()) {
          return { error: 'xmail_not_configured', detail: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID / XMAIL_SERVICE_KEY not set).' }
        }
        const html = body_html || toHtml(body)
        const result = await xmailSendMessage({ from: fromEmail, to, subject: subject as string, html, text: body })
        if (!result.ok) {
          return { sent: false, channel, to, error: result.error }
        }
        await markContacted(orgId, target, 'email', { subject, message_id: result.messageId, email_status: emailStatus })
        return { sent: true, channel, to, message_id: result.messageId, email_status: emailStatus }
      }

      // channel === 'sms'
      try {
        const supabase = createServiceRoleClient()
        const ctx: ActionContext = { organizationId: orgId, supabase }
        const result = await sendSms({ to, body }, ctx)
        await markContacted(orgId, target, 'sms', { message: result })
        return { sent: true, channel, to, message_id: result }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return {
          sent: false,
          channel,
          to,
          error: detail.toLowerCase().includes('twilio not connected')
            ? 'SMS not configured (connect Twilio for this org in Settings > Integrations).'
            : detail,
        }
      }
    },
  },
]
