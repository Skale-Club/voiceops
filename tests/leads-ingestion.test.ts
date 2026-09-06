import { describe, expect, it } from 'vitest'
import { leadIngestionSchema, hashLeadPayload, type LeadIngestionPayload } from '@/lib/leads/ingestion-schema'
import { verifyApiKey } from '@/lib/api-keys/verify'

const validPayload: LeadIngestionPayload = {
  schema_version: '1.0',
  event_id: 'websites:mvp:1e8dbf17-cda8-46a1-b279-e1e643d2979c',
  occurred_at: '2026-06-20T15:04:05.000Z',
  source: {
    product: 'skaleclub_websites',
    tenant_ref: 'mvp',
    site_domain: 'mvpbuildergroup.com',
    form: 'primary_lead_form',
  },
  contact: { name: 'Jane Smith', email: 'jane@example.com', phone: '+13055550199' },
  lead: {
    status: 'new',
    score: 18,
    classification: 'HOT',
    page_url: 'https://mvpbuildergroup.com/contact',
    answers: { project: 'Kitchen Remodel' },
  },
  attribution: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'kitchen' },
}

function apiKeyClient(data: { id: string; org_id: string; scopes: string[] } | null) {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () => ({ data }),
  }
  return { from: () => query }
}

describe('lead ingestion contract', () => {
  it('accepts the versioned Websites envelope', () => {
    expect(leadIngestionSchema.parse(validPayload)).toEqual(validPayload)
  })

  it('accepts the Skale Club marketing-site product with its own tenant_ref', () => {
    const skaleclubPayload = {
      ...validPayload,
      event_id: 'skaleclub:barbershop-leads:1e8dbf17-cda8-46a1-b279-e1e643d2979c',
      source: { product: 'skaleclub' as const, tenant_ref: 'skaleclub', site_domain: 'skale.club', form: 'barbershop-leads' },
    }
    expect(leadIngestionSchema.parse(skaleclubPayload)).toEqual(skaleclubPayload)
  })

  it('rejects an unregistered source product', () => {
    expect(() =>
      leadIngestionSchema.parse({ ...validPayload, source: { ...validPayload.source, product: 'xtimator' } }),
    ).toThrow()
  })

  it('rejects producer-controlled organization identity and unknown fields', () => {
    expect(() => leadIngestionSchema.parse({ ...validPayload, org_id: 'attacker-org' })).toThrow()
  })

  it('rejects an excessive dynamic-answer set', () => {
    const answers = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`q${index}`, 'answer']))
    expect(() => leadIngestionSchema.parse({ ...validPayload, lead: { ...validPayload.lead, answers } })).toThrow()
  })

  it('produces the same payload hash regardless of object key order', () => {
    const reordered = {
      ...validPayload,
      lead: {
        answers: validPayload.lead.answers,
        status: 'new' as const,
        score: 18,
        classification: 'HOT' as const,
        page_url: validPayload.lead.page_url,
      },
    }
    expect(hashLeadPayload(reordered)).toBe(hashLeadPayload(validPayload))
  })
})

describe('public API key verification', () => {
  it('derives the organization from a key with the required scope', async () => {
    const result = await verifyApiKey(
      new Request('https://xphere.app/api/v1/leads', { headers: { authorization: 'Bearer xph_test' } }),
      apiKeyClient({ id: 'key-1', org_id: 'org-1', scopes: ['leads:write'] }) as never,
      'leads:write',
    )
    expect(result).toEqual({ ok: true, key: { keyId: 'key-1', orgId: 'org-1', scopes: ['leads:write'] } })
  })

  it('rejects a valid key without the required scope', async () => {
    const result = await verifyApiKey(
      new Request('https://xphere.app/api/v1/leads', { headers: { authorization: 'Bearer xph_test' } }),
      apiKeyClient({ id: 'key-1', org_id: 'org-1', scopes: ['contacts:write'] }) as never,
      'leads:write',
    )
    expect(result).toMatchObject({ ok: false, status: 403, code: 'insufficient_scope' })
  })

  it('rejects unknown keys', async () => {
    const result = await verifyApiKey(
      new Request('https://xphere.app/api/v1/leads', { headers: { authorization: 'Bearer xph_unknown' } }),
      apiKeyClient(null) as never,
      'leads:write',
    )
    expect(result).toMatchObject({ ok: false, status: 401, code: 'invalid_api_key' })
  })
})
