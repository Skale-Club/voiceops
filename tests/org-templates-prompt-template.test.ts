// Phase 139 Plan 02 (TMPL-02): the pure rendering mechanism that turns a
// prompt template's tenant-fact tokens into concrete text for one target
// organization, plus the fact-resolver that supplies those values.
//
// This suite mocks @/lib/xkedule/credentials and @/lib/xkedule/client — it
// never calls a real Xkedule tenant or a real database.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getXkeduleCredentialsForOrg = vi.fn()
const xkeduleFetchJson = vi.fn()

vi.mock('@/lib/xkedule/credentials', () => ({
  getXkeduleCredentialsForOrg: (...args: unknown[]) => getXkeduleCredentialsForOrg(...args),
}))

vi.mock('@/lib/xkedule/client', () => ({
  xkeduleFetchJson: (...args: unknown[]) => xkeduleFetchJson(...args),
}))

import { renderPromptTemplate, resolveTenantFacts } from '../src/lib/org-templates/prompt-template'

// ─────────────────────────────────────────────────────────────────────────
// Minimal fake Supabase admin client — supports exactly
// .from('organizations').select(cols).eq('id', orgId).maybeSingle(), and
// records every write-shaped call so Test 7 can assert none occurred.
// ─────────────────────────────────────────────────────────────────────────

function buildFakeAdmin(orgRow: Record<string, unknown> | null) {
  const writeCalls: string[] = []
  const client = {
    from(_table: string) {
      return {
        select(_cols?: string) {
          return this
        },
        eq(_col: string, _val: unknown) {
          return this
        },
        async maybeSingle() {
          return { data: orgRow, error: null }
        },
        insert(..._args: unknown[]) {
          writeCalls.push('insert')
          return this
        },
        update(..._args: unknown[]) {
          writeCalls.push('update')
          return this
        },
        upsert(..._args: unknown[]) {
          writeCalls.push('upsert')
          return this
        },
      }
    },
  }
  return { client, writeCalls }
}

describe('TMPL-02: renderPromptTemplate', () => {
  it('substitutes {{business_location}} with "name, address"', () => {
    const result = renderPromptTemplate('You are the front desk at {{business_location}}.', {
      businessName: 'Acme Cuts',
      businessAddress: '9 Main St, Springfield',
    })
    expect(result).toBe('You are the front desk at Acme Cuts, 9 Main St, Springfield.')
  })

  it('falls back to just the name when businessAddress is null -- no dangling comma, no literal "null"', () => {
    const result = renderPromptTemplate('You are the front desk at {{business_location}}.', {
      businessName: 'Acme Cuts',
      businessAddress: null,
    })
    expect(result).toBe('You are the front desk at Acme Cuts.')
    expect(result).not.toContain('null')
    expect(result).not.toContain(', .')
  })

  it('substitutes only {{business_name}}; a template with no tokens round-trips unchanged', () => {
    const facts = { businessName: 'Acme Cuts', businessAddress: '9 Main St' }
    expect(renderPromptTemplate('You are the Booking specialist for {{business_name}}.', facts)).toBe(
      'You are the Booking specialist for Acme Cuts.'
    )
    const untouched = 'You never invent a price.'
    expect(renderPromptTemplate(untouched, facts)).toBe(untouched)
  })
})

describe('TMPL-02: resolveTenantFacts', () => {
  beforeEach(() => {
    getXkeduleCredentialsForOrg.mockReset()
    xkeduleFetchJson.mockReset()
  })

  it('falls back to the organizations row when no active xkedule integration exists', async () => {
    getXkeduleCredentialsForOrg.mockResolvedValue(null)
    const { client } = buildFakeAdmin({
      name: 'Acme Cuts',
      address_line1: '9 Main St',
      address_line2: null,
      address_city: 'Springfield',
      address_state: 'IL',
      address_postal_code: '62701',
      address_country: 'US',
    })
    const facts = await resolveTenantFacts(client as never, 'org-1')
    expect(facts.businessName).toBe('Acme Cuts')
    expect(facts.businessAddress).toBe('9 Main St, Springfield, IL, 62701')
  })

  it('returns null businessAddress when every address column is empty', async () => {
    getXkeduleCredentialsForOrg.mockResolvedValue(null)
    const { client } = buildFakeAdmin({
      name: 'Fresh Org',
      address_line1: null,
      address_line2: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
      address_country: null,
    })
    const facts = await resolveTenantFacts(client as never, 'org-2')
    expect(facts).toEqual({ businessName: 'Fresh Org', businessAddress: null })
  })

  it('prefers live Xkedule business-info over the organizations row when credentials resolve', async () => {
    getXkeduleCredentialsForOrg.mockResolvedValue({ tenantBaseUrl: 'https://t.example', apiKey: 'k' })
    xkeduleFetchJson.mockResolvedValue({ businessName: 'Real Name', address: 'Real Address' })
    const { client } = buildFakeAdmin({
      name: 'Stale Org Name',
      address_line1: 'Stale Address',
      address_line2: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
      address_country: null,
    })
    const facts = await resolveTenantFacts(client as never, 'org-3')
    expect(facts).toEqual({ businessName: 'Real Name', businessAddress: 'Real Address' })
  })

  it('swallows a thrown/rejected Xkedule fetch and still resolves via the organizations-row fallback', async () => {
    getXkeduleCredentialsForOrg.mockResolvedValue({ tenantBaseUrl: 'https://t.example', apiKey: 'k' })
    xkeduleFetchJson.mockRejectedValue(new Error('network error'))
    const { client } = buildFakeAdmin({
      name: 'Acme Cuts',
      address_line1: '9 Main St',
      address_line2: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
      address_country: null,
    })
    await expect(resolveTenantFacts(client as never, 'org-4')).resolves.toEqual({
      businessName: 'Acme Cuts',
      businessAddress: '9 Main St',
    })
  })

  it('is read-only -- never inserts, updates, or upserts any row', async () => {
    getXkeduleCredentialsForOrg.mockResolvedValue(null)
    const { client, writeCalls } = buildFakeAdmin({
      name: 'Acme Cuts',
      address_line1: null,
      address_line2: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
      address_country: null,
    })
    await resolveTenantFacts(client as never, 'org-5')
    expect(writeCalls).toEqual([])
  })
})
