// tests/xmail-lead-source-run.test.ts
//
// Unit coverage for toXmailLead's optional sourceRunId parameter
// (src/lib/mcp/tools/prospects.ts) — customFields.source_run_id must be
// present when a run was resolved and absent entirely (not null) otherwise,
// so Xmail can attribute outreach outcomes back to what it cost to source
// the lead without ever persisting a null key.

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured: vi.fn(() => false),
  xmailBulkImportLeads: vi.fn(),
  xmailListCampaigns: vi.fn(),
  xmailListEmailAccounts: vi.fn(),
  xmailAddLeadsToCampaign: vi.fn(),
  xmailActivateCampaign: vi.fn(),
}))
vi.mock('@/lib/xmail/website-insights', () => ({
  loadWebsiteInsightsForAccounts: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/xmail/source-runs', () => ({
  loadSourceRunIdsForEntities: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/email-verification/verify', () => ({
  verifyProspectsBatch: vi.fn(),
}))

const verification = {
  status: 'ok' as const,
  risk: 'low' as const,
  provider: 'millionverifier' as const,
  verifiedAt: '2026-08-13T00:00:00.000Z',
  cached: false,
}

const person = {
  kind: 'person' as const,
  id: 'contact-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  score: 80,
  source_type: 'xcraper',
  engagement_status: 'not_contacted',
  website: null,
  phone: '+16175550123',
  address: '123 Main St, Cambridge, MA 02139',
  location: '123 Main St, Cambridge, MA 02139',
  city: 'Cambridge',
}

describe('toXmailLead', () => {
  it('includes source_run_id in customFields when a run id is provided', async () => {
    const { toXmailLead } = await import('@/lib/mcp/tools/prospects')
    const lead = toXmailLead(person, verification, undefined, 'run-42')
    expect(lead.customFields?.source_run_id).toBe('run-42')
  })

  it('omits the source_run_id key entirely when no run id is provided', async () => {
    const { toXmailLead } = await import('@/lib/mcp/tools/prospects')
    const lead = toXmailLead(person, verification)
    expect(lead.customFields).toBeDefined()
    expect('source_run_id' in (lead.customFields as object)).toBe(false)
  })

  it('carries phone and location into Xmail instead of losing non-email reachability', async () => {
    const { toXmailLead } = await import('@/lib/mcp/tools/prospects')
    const lead = toXmailLead(person, verification)
    expect(lead).toMatchObject({
      phone: '+16175550123',
      location: '123 Main St, Cambridge, MA 02139',
    })
  })
})
