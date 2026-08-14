import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { AudienceEntityType } from '@/lib/meta/audience-members'
import { matchesAudienceSourceType, normalizeAudienceSourceDefinition } from '@/lib/meta/audience-source'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

export interface AudienceDirtyChange {
  sourceType?: string | null
  entityType?: AudienceEntityType
  entityId?: string
}

export interface MarkMetaAudiencesDirtyInput {
  orgId: string
  reason: string
  sourceType?: string | null
  entityType?: AudienceEntityType
  entityId?: string
  changes?: AudienceDirtyChange[]
}

interface AudienceScope {
  id: string
  audience_kind: string
  source_definition: unknown
}

function changeMatchesScope(change: AudienceDirtyChange, scope: AudienceScope): boolean {
  const definition = normalizeAudienceSourceDefinition(scope.audience_kind, scope.source_definition)
  if (definition.kind === 'xcraper_master') {
    return matchesAudienceSourceType(change.sourceType, definition)
  }
  if (!change.entityType || !change.entityId) return false
  return definition.entityKeys.includes(`${change.entityType}:${change.entityId}`)
}

/**
 * Durably schedules enabled audience scopes in one organization for
 * reconciliation. The service-role client bypasses RLS, so org_id is repeated
 * on both the discovery query and update as a hard tenant boundary.
 */
export async function markMetaAudiencesDirty(
  supabase: ServiceClient,
  input: MarkMetaAudiencesDirtyInput,
): Promise<{ marked: number }> {
  const { data, error } = await supabase
    .from('meta_audience_config')
    .select('id, audience_kind, source_definition')
    .eq('org_id', input.orgId)
    .eq('sync_enabled', true)

  if (error) throw new Error('Could not discover Meta audience scopes to reconcile')

  const shorthand: AudienceDirtyChange | null =
    input.sourceType || input.entityType || input.entityId
      ? { sourceType: input.sourceType, entityType: input.entityType, entityId: input.entityId }
      : null
  const changes = input.changes ?? (shorthand ? [shorthand] : [])
  const scopes = (data ?? []) as AudienceScope[]
  const matchingIds = changes.length === 0
    ? scopes.map((scope) => scope.id)
    : scopes.filter((scope) => changes.some((change) => changeMatchesScope(change, scope))).map((scope) => scope.id)

  if (matchingIds.length === 0) return { marked: 0 }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('meta_audience_config')
    .update({
      dirty_at: now,
      dirty_reason: input.reason,
      next_sync_at: now,
      operational_status: 'dirty',
      sync_claim_id: null,
      sync_claimed_at: null,
      updated_at: now,
    })
    .eq('org_id', input.orgId)
    .in('id', matchingIds)

  if (updateError) throw new Error('Could not schedule Meta audience reconciliation')
  return { marked: matchingIds.length }
}
