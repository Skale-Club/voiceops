import { describe, expect, it } from 'vitest'
import { buildWebsiteInsights } from '@/services/website-analyzer/outreach-insights'

function expectBriefMultilingual(value: Record<string, string>) {
  expect(Object.keys(value)).toEqual(expect.arrayContaining(['en', 'pt-BR', 'es']))
  for (const insight of Object.values(value)) {
    expect(insight).not.toContain('\n')
    expect(insight.length).toBeLessThan(360)
    expect((insight.match(/[.!?](?:\s|$)/g) ?? []).length).toBeLessThanOrEqual(2)
  }
}

describe('buildWebsiteInsights', () => {
  it('uses detected third-party booking evidence before generic site observations', () => {
    const insights = buildWebsiteInsights({
      url: 'https://barber.example',
      rawEvidence: {
        booking: { mode: 'third_party', primaryProvider: 'Booksy' },
        isMobileResponsive: false,
      },
    })
    expect(insights.en).toContain('Booksy')
    expect(insights.en).toContain('sends clients')
  })

  it('describes a missing dedicated website without pretending Google is the business site', () => {
    const insights = buildWebsiteInsights({
      url: 'https://google.com/maps/place/a-barbershop',
      rawEvidence: { isMobileResponsive: false, hasCTA: true, loadMs: 800 },
    })
    expectBriefMultilingual(insights)
    expect(insights.en).toContain('rather than a dedicated website')
  })

  it('recognizes hosted booking pages before applying generic performance criticism', () => {
    const insights = buildWebsiteInsights({
      url: 'https://flawlesscutzbyfran.booksy.com',
      rawEvidence: { isMobileResponsive: true, hasCTA: true, loadMs: 11_000 },
    })
    expectBriefMultilingual(insights)
    expect(insights.en).toContain('booking platform')
    expect(insights.en).not.toContain('11.0 seconds')
  })

  it('prioritizes a measured booking-path issue and keeps every locale brief', () => {
    const insights = buildWebsiteInsights({
      url: 'https://example-barber.test',
      rawEvidence: { isMobileResponsive: true, hasCTA: false, hasContactInfo: true, loadMs: 900 },
    })
    expectBriefMultilingual(insights)
    expect(insights.en).toContain('booking step')
    expect(insights['pt-BR']).toContain('agendar')
    expect(insights.es).toContain('reservar')
  })
})
