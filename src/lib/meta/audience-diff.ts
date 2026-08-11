import type { AudienceEntityType, ProjectedAudienceMember } from '@/lib/meta/audience-members'

export interface StoredAudienceMembership {
  entityType: AudienceEntityType
  entityId: string
  submittedEmailHash: string | null
  submittedPhoneHash: string | null
  eligibilityFingerprint: string
}

export interface AudienceMembershipOperation {
  entityType: AudienceEntityType
  entityId: string
  emailHash: string | null
  phoneHash: string | null
}

export interface AudienceMembershipDiff {
  add: AudienceMembershipOperation[]
  remove: AudienceMembershipOperation[]
  unchanged: string[]
}

function key(value: { entityType: AudienceEntityType; entityId: string }) {
  return `${value.entityType}:${value.entityId}`
}

function currentOperation(member: ProjectedAudienceMember): AudienceMembershipOperation {
  return {
    entityType: member.entityType,
    entityId: member.entityId,
    emailHash: member.emailHash,
    phoneHash: member.phoneHash,
  }
}

function storedOperation(member: StoredAudienceMembership): AudienceMembershipOperation {
  return {
    entityType: member.entityType,
    entityId: member.entityId,
    emailHash: member.submittedEmailHash,
    phoneHash: member.submittedPhoneHash,
  }
}

/** Diff a current safe projection against the last fully successful ledger. */
export function diffAudienceMemberships(
  current: ProjectedAudienceMember[],
  stored: StoredAudienceMembership[],
): AudienceMembershipDiff {
  const currentByKey = new Map(current.map((member) => [key(member), member]))
  const storedByKey = new Map(stored.map((member) => [key(member), member]))
  const keys = [...new Set([...currentByKey.keys(), ...storedByKey.keys()])].sort()
  const diff: AudienceMembershipDiff = { add: [], remove: [], unchanged: [] }

  for (const entityKey of keys) {
    const next = currentByKey.get(entityKey)
    const previous = storedByKey.get(entityKey)
    if (!previous && next) {
      diff.add.push(currentOperation(next))
      continue
    }
    if (previous && !next) {
      diff.remove.push(storedOperation(previous))
      continue
    }
    if (!previous || !next) continue

    const hashesUnchanged =
      previous.submittedEmailHash === next.emailHash &&
      previous.submittedPhoneHash === next.phoneHash
    if (hashesUnchanged && previous.eligibilityFingerprint === next.eligibilityFingerprint) {
      diff.unchanged.push(entityKey)
      continue
    }

    diff.remove.push(storedOperation(previous))
    diff.add.push(currentOperation(next))
  }

  return diff
}
