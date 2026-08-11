import { describe, expect, it } from 'vitest'
import {
  projectAudienceMember,
  projectAudienceMembers,
  type AudienceSourceEntity,
} from '@/lib/meta/audience-members'

const xcraperMaster = { kind: 'xcraper_master' as const, sourceType: 'xcraper' }

const contact: AudienceSourceEntity = {
  entityType: 'contact',
  entityId: '00000000-0000-4000-8000-000000000001',
  sourceType: 'xcraper',
  lifecycleStage: 'prospect',
  email: ' Owner@Example.COM ',
  phone: '(508) 555-0100',
  phoneE164: '+15085550100',
  emailStatus: 'unknown',
  dndEnabled: false,
  engagementStatus: 'not_contacted',
  identityStatus: 'identified',
  emailSuppressed: false,
  deletedAt: null,
}

const account: AudienceSourceEntity = {
  entityType: 'account',
  entityId: '00000000-0000-4000-8000-000000000002',
  sourceType: 'xcraper',
  lifecycleStage: 'prospect',
  email: null,
  phone: '+19785550100',
  customFields: { email: 'Shop@Example.com', city: 'Hudson' },
  emailStatus: 'ok',
  engagementStatus: 'not_contacted',
  emailSuppressed: false,
  deletedAt: null,
}

describe('Meta audience member projector', () => {
  it.each([
    ['contact', contact, 'unknown'],
    ['account', account, 'ok'],
  ] as const)('projects an eligible Xcraper %s into one hash-only member', async (_kind, entity, emailStatus) => {
    const result = await projectAudienceMember(entity, xcraperMaster)

    expect(result.eligible).toBe(true)
    if (!result.eligible) throw new Error(`unexpected exclusion: ${result.reason}`)
    expect(result.member).toMatchObject({
      entityType: entity.entityType,
      entityId: entity.entityId,
      emailStatus,
    })
    expect(result.member.emailHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.member.phoneHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.member.eligibilityFingerprint).toMatch(/^[0-9a-f]{64}$/)

    const persisted = JSON.stringify(result)
    expect(persisted).not.toContain('owner@example.com')
    expect(persisted).not.toContain('shop@example.com')
    expect(persisted).not.toContain('15085550100')
    expect(persisted).not.toContain('19785550100')
  })

  it('uses accounts.custom_fields.email and contacts.phone_e164 before fallback phone', async () => {
    const contactResult = await projectAudienceMember(contact, xcraperMaster)
    const accountResult = await projectAudienceMember(account, xcraperMaster)
    if (!contactResult.eligible || !accountResult.eligible) throw new Error('expected eligible entities')

    expect(contactResult.member.emailHash).toBe(
      '01bdbda417d3463152ae3a092326c9b826211836348b76a17fc6b45844344d15',
    )
    expect(contactResult.member.phoneHash).toBe(
      '5cb9db4603d9ce4dab5ce615926d28bbf4b4fba4ba092c611979df1a5cf75a28',
    )
    expect(accountResult.member.emailHash).toBe(
      '00215d8a61bdc957dd43b6d8f27915d9c279334cbd02d640c1759ef8c3f879d2',
    )
  })

  it('keeps otherwise eligible scraped emails regardless of verification status', async () => {
    for (const emailStatus of ['ok', 'catch_all', 'unknown', 'invalid', 'bounced']) {
      const result = await projectAudienceMember({ ...contact, emailStatus }, xcraperMaster)
      expect(result.eligible).toBe(true)
      if (result.eligible) expect(result.member.emailStatus).toBe(emailStatus)
    }
  })

  it.each([
    ['source_not_selected', { sourceType: 'manual' }],
    ['dnd', { dndEnabled: true }],
    ['unsubscribed', { engagementStatus: 'unsubscribed' }],
    ['email_suppressed', { emailSuppressed: true }],
    ['archived_duplicate', { identityStatus: 'archived_duplicate' }],
    ['deleted', { deletedAt: '2026-08-10T00:00:00Z' }],
    ['no_identifiers', { email: null, phone: null, phoneE164: null }],
  ])('excludes %s contacts deterministically', async (reason, patch) => {
    const result = await projectAudienceMember({ ...contact, ...patch }, xcraperMaster)
    expect(result).toEqual({
      eligible: false,
      entityType: 'contact',
      entityId: contact.entityId,
      reason,
    })
  })

  it('supports one-key entities and leaves the missing hash null', async () => {
    const emailOnly = await projectAudienceMember(
      { ...contact, phone: null, phoneE164: null },
      xcraperMaster,
    )
    const phoneOnly = await projectAudienceMember(
      { ...account, customFields: {} },
      xcraperMaster,
    )

    if (!emailOnly.eligible || !phoneOnly.eligible) throw new Error('expected eligible entities')
    expect(emailOnly.member.phoneHash).toBeNull()
    expect(phoneOnly.member.emailHash).toBeNull()
  })

  it('collapses normalized duplicate identifiers by stable entity-key ordering', async () => {
    const laterDuplicate: AudienceSourceEntity = {
      ...contact,
      entityId: '00000000-0000-4000-8000-000000000099',
      email: 'owner@example.com',
      phoneE164: '+1 508 555 0100',
    }
    const result = await projectAudienceMembers([laterDuplicate, contact], xcraperMaster)

    expect(result.members).toHaveLength(1)
    expect(result.members[0].entityId).toBe(contact.entityId)
    expect(result.exclusions).toContainEqual({
      eligible: false,
      entityType: 'contact',
      entityId: laterDuplicate.entityId,
      reason: 'duplicate_identifiers',
    })
  })
})
