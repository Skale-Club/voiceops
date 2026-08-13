// Xmail outreach client.
//
// Xmail (skaleclub-mail) owns the email outreach engine. Per the integration
// contract, Xphere is the orchestrator: it pushes prospect-stage records into
// Xmail as outreach leads and ENROLLS them in a campaign; Xmail runs the sending
// (its own verified domains, sequences, sending limits, tracking). Engagement
// flows back to Xphere via the webhook receiver at /api/integrations/xmail/events.
//
// Config is environment-driven (no hardcoded domains):
//   XMAIL_API_URL     base URL of the Xmail backend
//   XMAIL_USER_ID     the Xmail user id Xphere acts as (x-user-id header)
//   XMAIL_ORG_ID      the Xmail organization id that owns the outreach data
//   XMAIL_SERVICE_KEY machine-to-machine credential Xmail requires on all
//                      /api/outreach/ routes (x-service-key header). Xmail's
//                      global middleware otherwise demands a Supabase JWT.
//
// Auth contract: every request sends x-user-id (acting identity) AND
// x-service-key (service credential). Inbound engagement events flow back via
// a separate mechanism — Xmail's events receiver authenticates with an Xphere
// API key, not a shared webhook secret.

const XMAIL_API_URL = (process.env.XMAIL_API_URL || '').replace(/\/$/, '')
const XMAIL_USER_ID = process.env.XMAIL_USER_ID || ''
const XMAIL_ORG_ID = process.env.XMAIL_ORG_ID || ''
const XMAIL_SERVICE_KEY = process.env.XMAIL_SERVICE_KEY || ''

export function isXmailConfigured(): boolean {
  return Boolean(XMAIL_API_URL && XMAIL_USER_ID && XMAIL_ORG_ID && XMAIL_SERVICE_KEY)
}

/** Low-level fetch against the Xmail outreach API with the service identity header. */
async function xmailFetch(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  if (!isXmailConfigured()) {
    return {
      ok: false,
      error: 'Xmail integration is not configured (set XMAIL_API_URL + XMAIL_USER_ID + XMAIL_ORG_ID + XMAIL_SERVICE_KEY).',
    }
  }
  const url = new URL(`${XMAIL_API_URL}${path}`)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
  try {
    const res = await fetch(url.toString(), {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': XMAIL_USER_ID,
        'x-service-key': XMAIL_SERVICE_KEY,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return { ok: false, error: (data.error as string) || `Xmail returned HTTP ${res.status}` }
    }
    return { ok: true, data }
  } catch (err) {
    console.error(`[xmail] request failed (${path}):`, err)
    return { ok: false, error: 'Could not reach Xmail.' }
  }
}

export interface XmailLead {
  email: string
  firstName?: string | null
  lastName?: string | null
  companyName?: string | null
  phone?: string | null
  website?: string | null
  customFields?: Record<string, unknown>
}

export type XmailCampaign = { id: string; name: string; status: string }
export type XmailEmailAccount = { id: string; email: string; displayName: string | null }

/**
 * Bulk-import outreach leads into Xmail (idempotent: upserts by org + email).
 * Returns the resolved Xmail lead ids for every submitted email (newly inserted
 * + pre-existing), so the caller can enroll the full set in a campaign.
 */
export async function xmailBulkImportLeads(
  leads: XmailLead[],
): Promise<{ ok: true; imported: number; leadIds: string[] } | { ok: false; error: string }> {
  if (leads.length === 0) return { ok: true, imported: 0, leadIds: [] }
  const res = await xmailFetch('/api/outreach/leads/bulk-import', {
    method: 'POST',
    query: { organizationId: XMAIL_ORG_ID },
    body: { leads },
  })
  if (!res.ok) return res
  const leadIds = Array.isArray(res.data.leadIds) ? (res.data.leadIds as string[]) : []
  const imported = (res.data.imported as number) ?? 0
  return { ok: true, imported, leadIds }
}

/** List the org's outreach campaigns (id, name, status). */
export async function xmailListCampaigns(): Promise<
  { ok: true; campaigns: XmailCampaign[] } | { ok: false; error: string }
> {
  const res = await xmailFetch('/api/outreach/campaigns', { query: { organizationId: XMAIL_ORG_ID } })
  if (!res.ok) return res
  const raw = Array.isArray(res.data.campaigns) ? (res.data.campaigns as Array<Record<string, unknown>>) : []
  return {
    ok: true,
    campaigns: raw.map((c) => ({ id: c.id as string, name: (c.name as string) ?? '', status: (c.status as string) ?? 'draft' })),
  }
}

/** List the org's verified sending inboxes (email accounts). */
export async function xmailListEmailAccounts(): Promise<
  { ok: true; accounts: XmailEmailAccount[] } | { ok: false; error: string }
> {
  const res = await xmailFetch('/api/outreach/email-accounts', { query: { organizationId: XMAIL_ORG_ID } })
  if (!res.ok) return res
  const raw = Array.isArray(res.data.emailAccounts)
    ? (res.data.emailAccounts as Array<Record<string, unknown>>)
    : Array.isArray(res.data.accounts)
      ? (res.data.accounts as Array<Record<string, unknown>>)
      : []
  return {
    ok: true,
    accounts: raw.map((a) => ({ id: a.id as string, email: (a.email as string) ?? '', displayName: (a.displayName as string | null) ?? null })),
  }
}

/** Enroll leads into a campaign, assigning a sending inbox. */
export async function xmailAddLeadsToCampaign(
  campaignId: string,
  leadIds: string[],
  emailAccountId?: string,
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  if (leadIds.length === 0) return { ok: true, added: 0 }
  const res = await xmailFetch(`/api/outreach/campaigns/${campaignId}/leads`, {
    method: 'POST',
    body: { leadIds, ...(emailAccountId ? { emailAccountId } : {}) },
  })
  if (!res.ok) return res
  const added = (res.data.added as number) ?? (Array.isArray(res.data.campaignLeads) ? res.data.campaignLeads.length : leadIds.length)
  return { ok: true, added }
}

/** Set a campaign to 'active' so the Xmail engine starts sending. */
export async function xmailActivateCampaign(
  campaignId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await xmailFetch(`/api/outreach/campaigns/${campaignId}`, {
    method: 'PUT',
    body: { status: 'active' },
  })
  if (!res.ok) return res
  return { ok: true }
}

export interface XmailRegisterExternalRunParams {
  /** Only value that has ever shipped a lead in production — see xmail's externalRunSchema. */
  provider: 'xcraper'
  externalRunId: string
  label?: string
  query?: string
  location?: string
  resultCount?: number
  importedCount?: number
  /** The ACTUAL total cost the provider (Apify) reported for this run, in USD. */
  costUsd?: number
  actorId?: string
  template?: string
}

/**
 * Register an external prospecting run (e.g. an xcraper/Apify scrape) with
 * Xmail so it can attribute outreach outcomes back to what it cost to source
 * them. Idempotent on externalRunId — Xmail upserts by
 * (organizationId, provider, externalRunId) and never bills the same run
 * twice, so this is safe to call more than once (e.g. after a retry).
 */
export async function xmailRegisterExternalRun(
  input: XmailRegisterExternalRunParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await xmailFetch('/api/outreach/prospecting/external-runs', {
    method: 'POST',
    query: { organizationId: XMAIL_ORG_ID },
    body: input,
  })
  if (!res.ok) return res
  return { ok: true }
}

export interface XmailSendMessageParams {
  from: string
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Send a single 1:1 message through Xmail's native info@ inbox (not a
 * campaign/sequence) — used for one-off outbound like "here's your estimate".
 */
export async function xmailSendMessage(
  params: XmailSendMessageParams,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const res = await xmailFetch('/api/outreach/send-message', {
    method: 'POST',
    query: { organizationId: XMAIL_ORG_ID },
    body: params,
  })
  if (!res.ok) return res
  if (res.data.success !== true) {
    return { ok: false, error: (res.data.error as string) || 'Xmail send-message did not report success.' }
  }
  return { ok: true, messageId: (res.data.messageId as string) ?? '' }
}
