// tests/xmail-external-run-registration.test.ts
//
// Unit coverage for the pure metadata -> xmailRegisterExternalRun mapping
// (src/lib/xmail/external-run-mapping.ts) used by POST /api/v1/prospects.
// source.metadata is an open z.record(z.string(), z.unknown()) — xcraper
// puts cost_usd, result_count, actor_id, template in it alongside
// query/location — so this pins that wrong-typed values are DROPPED, never
// coerced.

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/xmail/client', () => ({
  isXmailConfigured: vi.fn(() => false),
  xmailRegisterExternalRun: vi.fn(async () => ({ ok: true })),
}))

describe('buildExternalRunRegistration', () => {
  it('maps every field from source + source.metadata for an xcraper run', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration(
      {
        label: 'Miami roofers',
        metadata: {
          query: 'roofing contractors',
          location: 'Miami, FL',
          cost_usd: 4.2,
          result_count: 87,
          enriched_count: 61,
          actor_id: 'actor-123',
          template: 'gmaps',
          hypothesis: {
            premise: 'Barbershops need better online booking',
            expected: { discovered: '>=20', reply_rate: 0.03 },
            basis: 'First run in this segment',
          },
          web_presence: {
            by_type: { owned_website: 20, booking_platform: 31, none: 36 },
            booking_platforms: { Booksy: 18, TheCut: 13 },
          },
        },
      },
      'xcraper',
      'run-1',
      50,
      42,
    )
    expect(result).toEqual({
      provider: 'xcraper',
      externalRunId: 'run-1',
      label: 'Miami roofers',
      query: 'roofing contractors',
      location: 'Miami, FL',
      resultCount: 87,
      importedCount: 42,
      enrichedCount: 61,
      costUsd: 4.2,
      actorId: 'actor-123',
      template: 'gmaps',
      hypothesis: {
        premise: 'Barbershops need better online booking',
        expected: { discovered: '>=20', reply_rate: 0.03 },
        basis: 'First run in this segment',
      },
      coverage: {
        byWebPresence: { owned_website: 20, booking_platform: 31, none: 36 },
        byBookingPlatform: { Booksy: 18, TheCut: 13 },
        unclassified: undefined,
      },
    })
  })

  it('falls back resultCount to the batch length when metadata has no result_count', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration(
      { metadata: {} },
      'xcraper',
      'run-2',
      /* prospectCount */ 63,
      /* importedCount */ 60,
    )
    expect(result?.resultCount).toBe(63)
  })

  it('drops a non-numeric cost_usd instead of coercing it', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration(
      { metadata: { cost_usd: '4.20' } },
      'xcraper',
      'run-3',
      10,
      10,
    )
    expect(result?.costUsd).toBeUndefined()
  })

  it('drops malformed enrichment and coverage counts instead of sending an invalid Xmail payload', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration(
      {
        metadata: {
          enriched_count: -1,
          web_presence: {
            by_type: { owned_website: 3, none: -2, booking_platform: 1.5, bad: '4' },
            booking_platforms: ['Booksy'],
            unclassified: -1,
          },
        },
      },
      'xcraper',
      'run-invalid-counts',
      3,
      3,
    )

    expect(result?.enrichedCount).toBeUndefined()
    expect(result?.coverage).toEqual({
      byWebPresence: { owned_website: 3 },
      byBookingPlatform: undefined,
      unclassified: undefined,
    })
  })

  it('drops non-string query/location/actorId/template values instead of coercing them', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration(
      { metadata: { query: 123, location: null, actor_id: { nested: true }, template: ['gmaps'] } },
      'xcraper',
      'run-4',
      5,
      5,
    )
    expect(result?.query).toBeUndefined()
    expect(result?.location).toBeUndefined()
    expect(result?.actorId).toBeUndefined()
    expect(result?.template).toBeUndefined()
  })

  it('returns null when the source is not xcraper', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration({ metadata: { cost_usd: 1 } }, 'api', 'run-5', 10, 10)
    expect(result).toBeNull()
  })

  it('returns null when there is no external_run_id', async () => {
    const { buildExternalRunRegistration } = await import('@/lib/xmail/external-run-mapping')
    const result = buildExternalRunRegistration({ metadata: { cost_usd: 1 } }, 'xcraper', null, 10, 10)
    expect(result).toBeNull()
  })
})
