// tests/twilio-resolve-org-by-number.test.ts
// Multi-tenancy guard for resolveTwilioOrgByToNumber().
//
// The same e164 string can be registered by more than one org
// (twilio_phone_numbers only enforces UNIQUE(organization_id, e164)). A lookup
// by e164 alone is therefore ambiguous and used to route to whichever row the
// DB returned first — leaking inbound calls/SMS across tenants. The inbound
// webhook carries the owning account's AccountSid, which we use to pick the
// correct org. These tests pin that behaviour.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-org Twilio integration blobs, keyed by organization_id.
const ORG_INTEGRATIONS: Record<string, { account_sid: string; auth_token: string }> = {
  'org-A': { account_sid: 'AC_A', auth_token: 'tok-A' },
  'org-B': { account_sid: 'AC_B', auth_token: 'tok-B' },
}

// Candidate twilio_phone_numbers rows returned by the e164 lookup. Set per test.
let candidateRows: Array<{ id: string; organization_id: string; e164: string }> = []

const fromMock = vi.fn((table: string) => {
  if (table === 'twilio_phone_numbers') {
    // Chainable AND thenable: the candidates query awaits the builder directly
    // (array result); resolveTwilioCredentialsForOrg's default-number lookup
    // uses .maybeSingle() (single row).
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { e164: '+19990000000' }, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: candidateRows, error: null }),
    }
  }
  if (table === 'integrations') {
    let capturedOrg: string | null = null
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string, val: string) => {
        if (col === 'organization_id') capturedOrg = val
        return builder
      }),
      limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => {
        const blob = capturedOrg ? ORG_INTEGRATIONS[capturedOrg] : null
        return Promise.resolve({
          data: blob ? { encrypted_api_key: JSON.stringify(blob), config: {} } : null,
          error: null,
        })
      }),
    }
    return builder
  }
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: fromMock })),
}))

// decrypt is the identity here — encrypted_api_key already holds the JSON blob.
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(async (v: string) => v),
}))

import { resolveTwilioOrgByToNumber } from '@/lib/twilio/voice'

beforeEach(() => {
  vi.clearAllMocks()
  candidateRows = []
})

describe('resolveTwilioOrgByToNumber — tenant disambiguation', () => {
  it('routes to the org whose AccountSid matches when two tenants share the e164', async () => {
    candidateRows = [
      { id: 'phone-A', organization_id: 'org-A', e164: '+19990000000' },
      { id: 'phone-B', organization_id: 'org-B', e164: '+19990000000' },
    ]
    const resolved = await resolveTwilioOrgByToNumber('+19990000000', 'AC_B')
    expect(resolved).not.toBeNull()
    expect(resolved!.orgId).toBe('org-B')
    expect(resolved!.phoneNumberId).toBe('phone-B')
    expect(resolved!.creds.accountSid).toBe('AC_B')
  })

  it('refuses to guess (returns null) when the e164 is shared and no AccountSid is given', async () => {
    candidateRows = [
      { id: 'phone-A', organization_id: 'org-A', e164: '+19990000000' },
      { id: 'phone-B', organization_id: 'org-B', e164: '+19990000000' },
    ]
    const resolved = await resolveTwilioOrgByToNumber('+19990000000')
    expect(resolved).toBeNull()
  })

  it('returns null when the shared e164 matches no candidate AccountSid', async () => {
    candidateRows = [
      { id: 'phone-A', organization_id: 'org-A', e164: '+19990000000' },
      { id: 'phone-B', organization_id: 'org-B', e164: '+19990000000' },
    ]
    const resolved = await resolveTwilioOrgByToNumber('+19990000000', 'AC_UNKNOWN')
    expect(resolved).toBeNull()
  })

  it('routes a single-owner number even without an AccountSid (unambiguous)', async () => {
    candidateRows = [{ id: 'phone-A', organization_id: 'org-A', e164: '+19990000000' }]
    const resolved = await resolveTwilioOrgByToNumber('+19990000000')
    expect(resolved).not.toBeNull()
    expect(resolved!.orgId).toBe('org-A')
    expect(resolved!.phoneNumberId).toBe('phone-A')
  })

  it('returns null when no active row matches the e164 at all', async () => {
    candidateRows = []
    const resolved = await resolveTwilioOrgByToNumber('+19990000000', 'AC_A')
    expect(resolved).toBeNull()
  })
})
