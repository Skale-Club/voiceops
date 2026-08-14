import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { normalizePhone, sha256Hex } from '@/lib/meta/graph'
import { matchesAudienceSourceType, type AudienceSourceDefinition } from '@/lib/meta/audience-source'
import type { Json } from '@/types/database'

export type AudienceEntityType = 'contact' | 'account'

// Re-exported so existing importers keep working; the definition itself now
// lives in audience-source.ts, shared with dirty-marking and reconciliation.
export type { AudienceSourceDefinition }

export interface AudienceSourceEntity {
  entityType: AudienceEntityType
  entityId: string
  sourceType: string | null
  lifecycleStage: string | null
  email: string | null
  phone: string | null
  phoneE164?: string | null
  customFields?: Json | null
  emailStatus?: string | null
  dndEnabled?: boolean | null
  engagementStatus?: string | null
  identityStatus?: string | null
  emailSuppressed?: boolean
  deletedAt?: string | null
}

export type AudienceExclusionReason =
  | 'source_not_selected'
  | 'dnd'
  | 'unsubscribed'
  | 'email_suppressed'
  | 'archived_duplicate'
  | 'deleted'
  | 'no_identifiers'
  | 'duplicate_identifiers'

export interface ProjectedAudienceMember {
  entityType: AudienceEntityType
  entityId: string
  emailHash: string | null
  phoneHash: string | null
  eligibilityFingerprint: string
  emailStatus: string | null
}

export interface AudienceProjectionExclusion {
  eligible: false
  entityType: AudienceEntityType
  entityId: string
  reason: AudienceExclusionReason
}

export type AudienceProjectionResult =
  | { eligible: true; member: ProjectedAudienceMember }
  | AudienceProjectionExclusion

function entityKey(entity: Pick<AudienceSourceEntity, 'entityType' | 'entityId'>) {
  return `${entity.entityType}:${entity.entityId}`
}

function isSelected(entity: AudienceSourceEntity, source: AudienceSourceDefinition) {
  if (source.kind === 'xcraper_master') {
    return matchesAudienceSourceType(entity.sourceType, source) && entity.lifecycleStage === 'prospect'
  }
  return source.entityKeys.includes(entityKey(entity))
}

function accountEmail(entity: AudienceSourceEntity): string | null {
  if (entity.entityType !== 'account') return entity.email
  if (
    !entity.customFields ||
    typeof entity.customFields !== 'object' ||
    Array.isArray(entity.customFields)
  ) return null
  const value = entity.customFields.email
  return typeof value === 'string' ? value : null
}

async function fingerprint(
  entityType: AudienceEntityType,
  entityId: string,
  emailHash: string | null,
  phoneHash: string | null,
) {
  return sha256Hex(`${entityType}:${entityId}:${emailHash ?? ''}:${phoneHash ?? ''}`)
}

function exclusion(
  entity: Pick<AudienceSourceEntity, 'entityType' | 'entityId'>,
  reason: AudienceExclusionReason,
): AudienceProjectionExclusion {
  return { eligible: false, entityType: entity.entityType, entityId: entity.entityId, reason }
}

/**
 * Convert one canonical CRM entity into the only representation that may be
 * persisted or logged by audience synchronization: entity references, hashes,
 * a deterministic fingerprint, and non-identifying verification status.
 */
export async function projectAudienceMember(
  entity: AudienceSourceEntity,
  source: AudienceSourceDefinition,
): Promise<AudienceProjectionResult> {
  if (!isSelected(entity, source)) return exclusion(entity, 'source_not_selected')
  if (entity.dndEnabled) return exclusion(entity, 'dnd')
  if (entity.engagementStatus === 'unsubscribed') return exclusion(entity, 'unsubscribed')
  if (entity.emailSuppressed) return exclusion(entity, 'email_suppressed')
  if (entity.identityStatus === 'archived_duplicate') return exclusion(entity, 'archived_duplicate')
  if (entity.deletedAt) return exclusion(entity, 'deleted')

  const normalizedEmail = normaliseEmail(accountEmail(entity))
  const phoneInput = entity.phoneE164 ?? entity.phone
  const normalizedPhone = phoneInput ? normalizePhone(phoneInput) : ''
  const emailHash = normalizedEmail ? await sha256Hex(normalizedEmail) : null
  const phoneHash = normalizedPhone ? await sha256Hex(normalizedPhone) : null

  if (!emailHash && !phoneHash) return exclusion(entity, 'no_identifiers')

  return {
    eligible: true,
    member: {
      entityType: entity.entityType,
      entityId: entity.entityId,
      emailHash,
      phoneHash,
      eligibilityFingerprint: await fingerprint(entity.entityType, entity.entityId, emailHash, phoneHash),
      emailStatus: entity.emailStatus ?? null,
    },
  }
}

/**
 * Project a source snapshot in stable entity-key order and ensure each
 * normalized identifier is submitted once. When a later entity shares only
 * one key, its other unique key remains eligible; when both keys are already
 * owned, the later entity is reported as a deterministic exclusion.
 */
export async function projectAudienceMembers(
  entities: AudienceSourceEntity[],
  source: AudienceSourceDefinition,
): Promise<{ members: ProjectedAudienceMember[]; exclusions: AudienceProjectionExclusion[] }> {
  const members: ProjectedAudienceMember[] = []
  const exclusions: AudienceProjectionExclusion[] = []
  const usedEmailHashes = new Set<string>()
  const usedPhoneHashes = new Set<string>()

  const sorted = [...entities].sort((a, b) => entityKey(a).localeCompare(entityKey(b)))
  for (const entity of sorted) {
    const result = await projectAudienceMember(entity, source)
    if (result.eligible === false) {
      exclusions.push(result)
      continue
    }

    const emailHash = result.member.emailHash && !usedEmailHashes.has(result.member.emailHash)
      ? result.member.emailHash
      : null
    const phoneHash = result.member.phoneHash && !usedPhoneHashes.has(result.member.phoneHash)
      ? result.member.phoneHash
      : null

    if (!emailHash && !phoneHash) {
      exclusions.push(exclusion(entity, 'duplicate_identifiers'))
      continue
    }

    if (emailHash) usedEmailHashes.add(emailHash)
    if (phoneHash) usedPhoneHashes.add(phoneHash)
    members.push({
      ...result.member,
      emailHash,
      phoneHash,
      eligibilityFingerprint: await fingerprint(
        result.member.entityType,
        result.member.entityId,
        emailHash,
        phoneHash,
      ),
    })
  }

  return { members, exclusions }
}
