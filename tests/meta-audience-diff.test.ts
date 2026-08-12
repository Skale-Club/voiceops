import { describe, expect, it } from 'vitest'
import { diffAudienceMemberships, type StoredAudienceMembership } from '@/lib/meta/audience-diff'
import type { ProjectedAudienceMember } from '@/lib/meta/audience-members'

const oldMembership: StoredAudienceMembership = {
  entityType: 'account',
  entityId: '00000000-0000-4000-8000-000000000001',
  submittedEmailHash: 'a'.repeat(64),
  submittedPhoneHash: 'b'.repeat(64),
  eligibilityFingerprint: 'c'.repeat(64),
}

const unchanged: ProjectedAudienceMember = {
  entityType: oldMembership.entityType,
  entityId: oldMembership.entityId,
  emailHash: oldMembership.submittedEmailHash,
  phoneHash: oldMembership.submittedPhoneHash,
  eligibilityFingerprint: oldMembership.eligibilityFingerprint,
  emailStatus: 'ok',
}

describe('Meta audience membership diff', () => {
  it('returns no remote operations for an unchanged snapshot', () => {
    expect(diffAudienceMemberships([unchanged], [oldMembership])).toEqual({
      add: [],
      remove: [],
      unchanged: ['account:00000000-0000-4000-8000-000000000001'],
    })
  })

  it('removes old hashes before adding changed identifiers', () => {
    const changed: ProjectedAudienceMember = {
      ...unchanged,
      emailHash: 'd'.repeat(64),
      eligibilityFingerprint: 'e'.repeat(64),
    }
    const diff = diffAudienceMemberships([changed], [oldMembership])

    expect(diff.remove).toEqual([{
      entityType: 'account',
      entityId: oldMembership.entityId,
      emailHash: 'a'.repeat(64),
      phoneHash: 'b'.repeat(64),
    }])
    expect(diff.add).toEqual([{
      entityType: 'account',
      entityId: oldMembership.entityId,
      emailHash: 'd'.repeat(64),
      phoneHash: 'b'.repeat(64),
    }])
    expect(diff.unchanged).toEqual([])
  })

  it('removes a stored entity that is absent from the eligible projection', () => {
    const diff = diffAudienceMemberships([], [oldMembership])
    expect(diff.remove).toHaveLength(1)
    expect(diff.add).toEqual([])
  })

  it('adds a newly eligible entity without a removal', () => {
    const diff = diffAudienceMemberships([unchanged], [])
    expect(diff.add).toHaveLength(1)
    expect(diff.remove).toEqual([])
  })

  it('orders operations deterministically by entity key', () => {
    const contact: ProjectedAudienceMember = {
      ...unchanged,
      entityType: 'contact',
      entityId: '00000000-0000-4000-8000-000000000009',
    }
    const account: ProjectedAudienceMember = {
      ...unchanged,
      entityId: '00000000-0000-4000-8000-000000000010',
    }
    const diff = diffAudienceMemberships([contact, account], [])
    expect(diff.add.map((entry) => `${entry.entityType}:${entry.entityId}`)).toEqual([
      'account:00000000-0000-4000-8000-000000000010',
      'contact:00000000-0000-4000-8000-000000000009',
    ])
  })
})
