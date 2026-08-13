// MCP tools for the prospecting "back of funnel": list/score-filter prospects and
// enrol them into an Xmail outreach campaign on command (e.g. "email everyone I
// scraped above 50 points"). The user's command IS the approval — but
// `prospects_enroll_in_campaign` is gated by `confirmed:true`, so the agent must
// preview with `prospects_list` and get the human's go-ahead before enrolling.
//
// Sending is owned by XMAIL's outreach engine (verified domains, sequences,
// sending limits, open/click/reply tracking). Xphere only orchestrates: push the
// prospects in as leads and enrol them in a pre-built campaign, then activate it.
// Engagement flows back to Xphere via the /api/integrations/xmail/events webhook.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  isXmailConfigured,
  xmailBulkImportLeads,
  xmailListCampaigns,
  xmailListEmailAccounts,
  xmailAddLeadsToCampaign,
  xmailActivateCampaign,
  type XmailLead,
} from '@/lib/xmail/client'
import { loadWebsiteInsightsForAccounts } from '@/lib/xmail/website-insights'
import { loadSourceRunIdsForEntities } from '@/lib/xmail/source-runs'
import type { WebsiteInsights } from '@/services/website-analyzer/outreach-insights'
import { verifyProspectsBatch, type BatchAggregate, type EmailVerified, type ProspectKind } from '@/lib/email-verification/verify'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

const DEFAULT_MAX = 100
const HARD_MAX = 300

const filterShape = {
  score_min: z.number().int().min(0).max(100).optional().describe('Only prospects with score >= this (lead score: higher = more site problems = hotter lead).'),
  score_max: z.number().int().min(0).max(100).optional(),
  source_type: z.string().max(60).optional().describe("Filter by ingestion source, e.g. 'xcraper' for Google-Maps scrapes."),
  kind: z.enum(['person', 'company', 'all']).optional().describe("'company' (scraped businesses), 'person', or 'all'. Default 'all'."),
  qualification: z.enum(['unqualified', 'needs_review', 'qualified']).optional(),
  engagement: z.string().max(40).optional().describe("e.g. 'not_contacted' to skip anyone already enrolled/contacted."),
}

type Filters = {
  score_min?: number
  score_max?: number
  source_type?: string
  kind?: 'person' | 'company' | 'all'
  qualification?: 'unqualified' | 'needs_review' | 'qualified'
  engagement?: string
}

type ResolvedProspect = {
  kind: 'person' | 'company'
  id: string
  name: string | null
  email: string | null
  score: number
  source_type: string | null
  engagement_status: string
  website: string | null
}

function composeName(r: { first_name?: string | null; last_name?: string | null; name?: string | null }): string | null {
  const composed = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  return composed || r.name?.trim() || null
}

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  if (!name) return { firstName: null, lastName: null }
  const parts = name.trim().split(/\s+/)
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null }
}

/** Companies have no email column; the scraped email (enriched runs only) lives in custom_fields.email. */
export function emailFromCustomFields(cf: unknown): string | null {
  if (!cf || typeof cf !== 'object') return null
  const e = (cf as Record<string, unknown>).email
  return typeof e === 'string' && e.includes('@') ? e.trim() : null
}

/** ResolvedProspect.kind ('person'|'company') -> the verification/resolver vocabulary ('contact'|'account'). */
function verificationKind(kind: 'person' | 'company'): ProspectKind {
  return kind === 'company' ? 'account' : 'contact'
}

export function toXmailLead(
  p: ResolvedProspect,
  verification: EmailVerified,
  websiteInsights?: WebsiteInsights,
  sourceRunId?: string,
): XmailLead {
  // xphere_kind must use the resolver's vocabulary ('contact' | 'account'), not
  // the prospect's own 'person' | 'company' kind — see resolveProspectEntity in
  // src/lib/prospects/events.ts.
  const xphereKind = verificationKind(p.kind)
  // Contract with Xmail: these 4 fields map onto leads.emailVerificationStatus
  // (ok -> verified; catch_all|unknown -> likely; invalid|disposable|bounced -> invalid).
  const customFields = {
    xphere_id: p.id,
    xphere_kind: xphereKind,
    score: p.score,
    source_type: p.source_type,
    email_status: verification.status,
    email_verified_at: verification.verifiedAt,
    email_verification_provider: verification.provider,
    email_risk: verification.risk,
    ...(websiteInsights ? { websiteInsights } : {}),
    // Lets Xmail attribute outcomes for this lead back to the prospecting run
    // that sourced it (see xmailRegisterExternalRun). Omitted entirely — not
    // sent as null — when no run could be resolved.
    ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
  }
  if (p.kind === 'company') {
    return { email: p.email as string, companyName: p.name ?? undefined, website: p.website ?? undefined, customFields }
  }
  const { firstName, lastName } = splitName(p.name)
  return { email: p.email as string, firstName: firstName ?? undefined, lastName: lastName ?? undefined, website: p.website ?? undefined, customFields }
}

/** Shape the enroll/dry-run response's verification breakdown from a batch aggregate. */
function summarizeAggregate(aggregate: BatchAggregate) {
  return {
    verified_ok: aggregate.ok,
    catch_all: aggregate.catch_all,
    unknown: aggregate.unknown,
    blocked_invalid: aggregate.invalid + aggregate.disposable + aggregate.bounced,
    blocked_no_credits: aggregate.blocked,
  }
}

async function resolveProspects(
  orgId: string,
  f: Filters,
  opts: { requireEmail?: boolean; cap?: number } = {},
): Promise<ResolvedProspect[]> {
  const cap = opts.cap ?? 1000
  const kind = f.kind ?? 'all'
  const wantPeople = kind === 'all' || kind === 'person'
  const wantCompanies = kind === 'all' || kind === 'company'
  const out: ResolvedProspect[] = []

  if (wantPeople) {
    let q = db()
      .from('contacts')
      .select('id, first_name, last_name, name, email, score, source_type, engagement_status')
      .eq('org_id', orgId)
      .eq('lifecycle_stage', 'prospect')
      .limit(cap)
    if (f.score_min != null) q = q.gte('score', f.score_min)
    if (f.score_max != null) q = q.lte('score', f.score_max)
    if (f.source_type) q = q.eq('source_type', f.source_type)
    if (f.qualification) q = q.eq('qualification_status', f.qualification)
    if (f.engagement) q = q.eq('engagement_status', f.engagement)
    if (opts.requireEmail) q = q.not('email', 'is', null)
    const { data } = await q
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        kind: 'person',
        id: r.id as string,
        name: composeName(r as { first_name?: string | null; last_name?: string | null; name?: string | null }),
        email: (r.email as string | null) ?? null,
        score: (r.score as number | null) ?? 0,
        source_type: (r.source_type as string | null) ?? null,
        engagement_status: r.engagement_status as string,
        website: null,
      })
    }
  }

  if (wantCompanies) {
    let q = db()
      .from('accounts')
      .select('id, name, domain, website, score, source_type, engagement_status, custom_fields')
      .eq('org_id', orgId)
      .eq('lifecycle_stage', 'prospect')
      .limit(cap)
    if (f.score_min != null) q = q.gte('score', f.score_min)
    if (f.score_max != null) q = q.lte('score', f.score_max)
    if (f.source_type) q = q.eq('source_type', f.source_type)
    if (f.qualification) q = q.eq('qualification_status', f.qualification)
    if (f.engagement) q = q.eq('engagement_status', f.engagement)
    const { data } = await q
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const email = emailFromCustomFields(r.custom_fields)
      if (opts.requireEmail && !email) continue
      out.push({
        kind: 'company',
        id: r.id as string,
        name: (r.name as string | null) ?? null,
        email,
        score: (r.score as number | null) ?? 0,
        source_type: (r.source_type as string | null) ?? null,
        engagement_status: r.engagement_status as string,
        website: (r.domain as string | null) ?? (r.website as string | null) ?? null,
      })
    }
  }

  out.sort((a, b) => b.score - a.score)
  return out
}

/** Mark enrolled prospects as contacted + log a timeline event (bulk). */
async function markEnrolled(orgId: string, recipients: ResolvedProspect[], campaignId: string): Promise<void> {
  const nowIso = new Date().toISOString()
  const contactIds = recipients.filter((p) => p.kind === 'person').map((p) => p.id)
  const accountIds = recipients.filter((p) => p.kind === 'company').map((p) => p.id)
  if (contactIds.length) {
    await db().from('contacts').update({ engagement_status: 'contacted', last_contacted_at: nowIso, updated_at: nowIso }).in('id', contactIds)
  }
  if (accountIds.length) {
    await db().from('accounts').update({ engagement_status: 'contacted', last_contacted_at: nowIso, updated_at: nowIso }).in('id', accountIds)
  }
  await db()
    .from('prospect_engagement_events')
    .insert(
      recipients.map((p) => ({
        org_id: orgId,
        entity_type: p.kind === 'person' ? 'contact' : 'account',
        entity_id: p.id,
        event_type: 'contacted',
        source_platform: 'xmail',
        payload: { xmail_campaign: campaignId, action: 'enrolled' },
      })),
    )
}

export const prospectsTools: McpToolDef[] = [
  {
    name: 'prospects_list',
    title: 'List / preview prospects',
    description:
      "List prospects (lifecycle_stage='prospect') with score/source filters, sorted by score (hottest first). Use this to PREVIEW an outreach audience before enrolling — it reports how many match and how many have a usable email. Always run this first and show the human the count before calling prospects_enroll_in_campaign.",
    area: 'general_xphere',
    inputSchema: z
      .object({
        ...filterShape,
        has_email: z.boolean().optional().describe('Only count/return prospects that have a usable email address.'),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const all = await resolveProspects(auth.orgId, input)
      const withEmail = all.filter((p) => p.email)
      const pool = input.has_email ? withEmail : all
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      return {
        total: all.length,
        with_email: withEmail.length,
        emailable_note:
          withEmail.length === 0 && all.length > 0
            ? 'None of these have an email — they were scraped "standard" (no email extraction). Re-scrape with scrapeType "enriched" to get emails before outreach.'
            : undefined,
        prospects: pool.slice(offset, offset + limit),
        limit,
        offset,
      }
    },
  },
  {
    name: 'xmail_outreach_status',
    title: 'List Xmail campaigns + sending inboxes',
    description:
      'List the Xmail outreach campaigns (id, name, status) and verified sending inboxes (email accounts) available to enrol prospects into. Use this to pick a campaign_id (and optionally an email_account_id) before calling prospects_enroll_in_campaign. If it returns no campaigns or no inboxes, the human still has to set those up in Xmail.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async () => {
      if (!isXmailConfigured()) {
        return { error: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID not set).' }
      }
      const [camps, accts] = await Promise.all([xmailListCampaigns(), xmailListEmailAccounts()])
      return {
        campaigns: camps.ok ? camps.campaigns : [],
        campaigns_error: camps.ok ? undefined : camps.error,
        email_accounts: accts.ok ? accts.accounts : [],
        email_accounts_error: accts.ok ? undefined : accts.error,
        note:
          (camps.ok && camps.campaigns.length === 0 ? 'No campaigns yet — create one in Xmail (with a sequence). ' : '') +
          (accts.ok && accts.accounts.length === 0 ? 'No sending inbox yet — add a verified email account in Xmail.' : '') || undefined,
      }
    },
  },
  {
    name: 'prospects_enroll_in_campaign',
    title: 'Enrol matching prospects into an Xmail campaign',
    description:
      "Enrol every prospect matching the filters (that has an email) into an existing Xmail outreach campaign, and activate it so Xmail starts sending. SAFETY: only runs when confirmed:true — first call prospects_list to preview the count and xmail_outreach_status to pick the campaign, tell the human, and only set confirmed:true after they approve. Xmail handles the actual sending, sequences, suppression and tracking. Caps at " + HARD_MAX + ' prospects per call.',
    area: 'general_xphere',
    annotations: { destructiveHint: true, idempotentHint: false },
    inputSchema: z
      .object({
        ...filterShape,
        campaign_id: z.string().uuid().describe('The Xmail campaign id to enrol into (from xmail_outreach_status).'),
        email_account_id: z.string().uuid().optional().describe('Sending inbox id. If omitted, the first available inbox is used.'),
        max: z.number().int().positive().max(HARD_MAX).optional().describe(`Hard cap on prospects (default ${DEFAULT_MAX}).`),
        confirmed: z.boolean().optional().describe('Must be true to actually enrol + activate. Leave false/absent for a dry run.'),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const { campaign_id, email_account_id, max, confirmed, ...filters } = input
      // Outreach is intentionally one-way: callers may narrow the selection,
      // but they cannot re-enrol a prospect whose CRM engagement has already
      // advanced beyond the initial not_contacted state.
      const outreachFilters = { ...filters, engagement: 'not_contacted' as const }

      if (!confirmed) {
        const preview = await resolveProspects(auth.orgId, outreachFilters, { requireEmail: true })
        const capped = preview.slice(0, max ?? DEFAULT_MAX)
        const batch = await verifyProspectsBatch(
          auth.orgId,
          capped.map((p) => ({ kind: verificationKind(p.kind), id: p.id, email: p.email as string })),
        )
        const verification = summarizeAggregate(batch.aggregate)
        const wouldEnroll = verification.verified_ok + verification.catch_all + verification.unknown
        return {
          dry_run: true,
          would_enroll: wouldEnroll,
          matched_with_email: preview.length,
          verification: { total_checked: capped.length, ...verification },
          verification_unavailable: verification.blocked_no_credits > 0 ? true : undefined,
          message:
            verification.blocked_no_credits > 0
              ? `WARNING: email verification is unavailable (no verification credits) for ${verification.blocked_no_credits} of ${capped.length} matching prospect(s) — they will be skipped, not sent unverified. Nothing was enrolled (confirmed was not true).`
              : 'Nothing was enrolled (confirmed was not true). Show the human the count and which campaign, then call again with confirmed:true.',
          sample: preview.slice(0, 5).map((p) => ({ name: p.name, email: p.email, score: p.score })),
        }
      }

      if (!isXmailConfigured()) {
        return { error: 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID not set).' }
      }

      const cap = Math.min(max ?? DEFAULT_MAX, HARD_MAX)
      const allWithEmail = await resolveProspects(auth.orgId, outreachFilters, { requireEmail: true })
      const candidates = allWithEmail.slice(0, cap)
      if (candidates.length === 0) {
        return { enrolled: 0, message: 'No matching uncontacted prospects have an email to enrol.' }
      }

      // Verify every candidate's email before it ever reaches Xmail — this is
      // the prospect's source of truth, checked (and cached) once here.
      const batch = await verifyProspectsBatch(
        auth.orgId,
        candidates.map((p) => ({ kind: verificationKind(p.kind), id: p.id, email: p.email as string })),
      )
      const verification = summarizeAggregate(batch.aggregate)
      const recipients: Array<{ prospect: ResolvedProspect; verified: EmailVerified }> = []
      candidates.forEach((p, i) => {
        const r = batch.results[i]
        if (r.sendable) recipients.push({ prospect: p, verified: r.result as EmailVerified })
      })

      if (recipients.length === 0) {
        return {
          enrolled: 0,
          verification: { total_checked: candidates.length, ...verification },
          verification_unavailable: verification.blocked_no_credits > 0 ? true : undefined,
          message:
            verification.blocked_no_credits > 0
              ? `No prospects were enrolled: email verification is unavailable (no verification credits) for ${verification.blocked_no_credits} of ${candidates.length} matching prospect(s), and none of the remainder verified as sendable.`
              : 'No matching prospects passed email verification as sendable (all invalid/disposable/bounced).',
        }
      }

      // Resolve a sending inbox if none was provided (Xmail requires one to activate).
      let inboxId = email_account_id
      if (!inboxId) {
        const accts = await xmailListEmailAccounts()
        if (accts.ok && accts.accounts.length > 0) inboxId = accts.accounts[0].id
      }

      const service = db()
      const websiteInsights = await loadWebsiteInsightsForAccounts(
        service,
        auth.orgId,
        recipients.filter(r => r.prospect.kind === 'company').map(r => r.prospect.id),
      )
      const sourceRunIds = await loadSourceRunIdsForEntities(
        service,
        auth.orgId,
        recipients.map(r => r.prospect.id),
      )
      const imp = await xmailBulkImportLeads(recipients.map((r) =>
        toXmailLead(r.prospect, r.verified, websiteInsights.get(r.prospect.id), sourceRunIds.get(r.prospect.id))))
      if (!imp.ok) return { error: `Xmail lead import failed: ${imp.error}` }

      const add = await xmailAddLeadsToCampaign(campaign_id, imp.leadIds, inboxId)
      if (!add.ok) return { error: `Enrolment failed: ${add.error}`, imported: imp.imported }

      const act = await xmailActivateCampaign(campaign_id)
      if (act.ok) await markEnrolled(auth.orgId, recipients.map((r) => r.prospect), campaign_id)

      return {
        matched: recipients.length,
        imported: imp.imported,
        enrolled: add.added,
        campaign_activated: act.ok,
        activation_note: act.ok
          ? undefined
          : `Leads enrolled, but the campaign could not be activated: ${act.error}. Fix it in Xmail (needs a sequence + a sending inbox per lead), then activate.`,
        verification: { total_checked: candidates.length, ...verification },
        verification_unavailable: verification.blocked_no_credits > 0 ? true : undefined,
        capped:
          allWithEmail.length > cap
            ? { total_matched: allWithEmail.length, cap, remaining: allWithEmail.length - cap }
            : undefined,
        message:
          `Enrolled ${add.added} prospect(s) into the campaign${act.ok ? ' and activated it — Xmail will start sending.' : ' (activation pending — see activation_note).'}` +
          (verification.blocked_no_credits > 0
            ? ` WARNING: ${verification.blocked_no_credits} matching prospect(s) were skipped — email verification is unavailable (no verification credits).`
            : ''),
      }
    },
  },
]
