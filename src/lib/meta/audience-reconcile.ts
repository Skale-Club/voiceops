import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { diffAudienceMemberships, type StoredAudienceMembership } from '@/lib/meta/audience-diff'
import {
  projectAudienceMembers,
  type AudienceSourceEntity,
  type ProjectedAudienceMember,
} from '@/lib/meta/audience-members'
import {
  audienceSourceTypes,
  normalizeAudienceSourceDefinition,
  type AudienceSourceDefinition,
} from '@/lib/meta/audience-source'
import {
  MetaAudienceConnectionError,
  type MetaConnectionProvider,
} from '@/lib/meta/audience-provider'
import {
  createCustomAudience,
  syncHashedUsersToAudience,
  type AudienceHashEntry,
  type MetaCustomerFileSource,
} from '@/lib/meta/custom-audiences'
import { MetaGraphRequestError } from '@/lib/meta/graph'
import type { Database, Json } from '@/types/database'

export type AudienceSyncTrigger = 'manual' | 'scheduled' | 'ingestion' | 'retry'

export interface ReconcileConfig {
  id: string
  orgId: string
  adsConnectionId: string | null
  metaAdAccountId: string
  customAudienceId: string | null
  audienceName: string
  consentBasis: MetaCustomerFileSource
  termsAcceptedAt: string | null
  termsAcceptedBy: string | null
  audienceKind?: string
  sourceDefinition?: Json
}

export interface ReconcileClaim {
  claimed: boolean
  runId?: string
  claimId?: string
}

interface FinishCounts {
  targetCount: number
  addCount: number
  removeCount: number
  unchangedCount: number
  invalidCount: number
  suppressedCount: number
}

interface ClaimInput {
  orgId: string
  audienceConfigId: string
  trigger: AudienceSyncTrigger
  dryRun: boolean
}

interface FinishInput extends FinishCounts {
  orgId: string
  audienceConfigId: string
  runId: string
  claimId: string
}

export interface AudienceReconcileStore {
  claim(input: ClaimInput): Promise<ReconcileClaim>
  loadConfig(orgId: string, audienceConfigId: string): Promise<ReconcileConfig | null>
  loadProjectedMembers(config: ReconcileConfig): Promise<{
    members: ProjectedAudienceMember[]
    suppressedCount: number
    invalidCount: number
  }>
  loadMemberships(orgId: string, audienceConfigId: string): Promise<StoredAudienceMembership[]>
  setRemoteAudienceId(input: {
    orgId: string
    audienceConfigId: string
    runId: string
    claimId: string
    audienceId: string
  }): Promise<void>
  commitSuccess(input: FinishInput & { members: ProjectedAudienceMember[] }): Promise<void>
  completeDryRun(input: FinishInput): Promise<void>
  fail(input: {
    orgId: string
    audienceConfigId: string
    runId: string
    claimId: string
    errorCode: string
    errorMessage: string
    misconfigured: boolean
  }): Promise<void>
}

export interface AudienceReconcileTransport {
  createAudience(
    adAccountId: string,
    token: string,
    opts: { name: string; consentBasis: MetaCustomerFileSource },
  ): Promise<{ id: string }>
  syncHashes(
    audienceId: string,
    token: string,
    entries: AudienceHashEntry[],
    operation: 'ADD' | 'REMOVE',
  ): Promise<{ sent: number; invalid: number }>
}

const defaultTransport: AudienceReconcileTransport = {
  createAudience: createCustomAudience,
  syncHashes: syncHashedUsersToAudience,
}

export type ReconcileResult =
  | ({ status: 'succeeded'; dryRun: boolean } & FinishCounts)
  | { status: 'skipped'; reason: 'already_claimed' }
  | { status: 'failed'; errorCode: string; errorMessage: string }

class ReconcilePreconditionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ReconcilePreconditionError'
  }
}

function redactFailure(message: string, token?: string): string {
  let safe = message
  if (token) safe = safe.split(token).join('[REDACTED_TOKEN]')
  return safe.replace(/\b[0-9a-f]{64}\b/gi, '[REDACTED_HASH]').slice(0, 300)
}

function safeFailure(error: unknown, token?: string): {
  code: string
  message: string
  misconfigured: boolean
} {
  if (error instanceof ReconcilePreconditionError) {
    return { code: error.code, message: error.message, misconfigured: true }
  }
  if (error instanceof MetaAudienceConnectionError) {
    return { code: error.code, message: error.message, misconfigured: true }
  }
  if (error instanceof MetaGraphRequestError) {
    return {
      code: error.code === null ? 'META_GRAPH_ERROR' : `META_GRAPH_${error.code}`,
      message: redactFailure(error.message, token),
      misconfigured: false,
    }
  }
  return {
    code: 'META_SYNC_FAILED',
    message: redactFailure(error instanceof Error ? error.message : 'Meta audience sync failed', token),
    misconfigured: false,
  }
}

function hashEntries(operations: Array<{ emailHash: string | null; phoneHash: string | null }>) {
  return operations.map((operation) => ({
    emailHash: operation.emailHash,
    phoneHash: operation.phoneHash,
  }))
}

export async function reconcileMetaAudience(input: {
  store: AudienceReconcileStore
  provider: MetaConnectionProvider
  transport?: AudienceReconcileTransport
  orgId: string
  audienceConfigId: string
  trigger: AudienceSyncTrigger
  dryRun: boolean
}): Promise<ReconcileResult> {
  const transport = input.transport ?? defaultTransport
  const claim = await input.store.claim({
    orgId: input.orgId,
    audienceConfigId: input.audienceConfigId,
    trigger: input.trigger,
    dryRun: input.dryRun,
  })
  if (!claim.claimed || !claim.runId || !claim.claimId) {
    return { status: 'skipped', reason: 'already_claimed' }
  }

  let token: string | undefined
  try {
    const config = await input.store.loadConfig(input.orgId, input.audienceConfigId)
    if (!config) throw new ReconcilePreconditionError('CONFIG_NOT_FOUND', 'Audience configuration was not found.')
    if (!input.dryRun && (!config.termsAcceptedAt || !config.termsAcceptedBy)) {
      throw new ReconcilePreconditionError('TERMS_NOT_ACCEPTED', 'Meta Custom Audience terms must be accepted first.')
    }
    if (!config.adsConnectionId) {
      throw new ReconcilePreconditionError('CONNECTION_ID_REQUIRED', 'Select a tenant Meta connection before syncing.')
    }
    if (!config.metaAdAccountId) {
      throw new ReconcilePreconditionError('AD_ACCOUNT_REQUIRED', 'Select a Meta ad account before syncing.')
    }

    const connection = await input.provider.getConnection(
      input.orgId,
      config.metaAdAccountId,
      config.adsConnectionId,
    )
    token = connection.token

    let audienceId = config.customAudienceId
    if (!audienceId && !input.dryRun) {
      const created = await transport.createAudience(config.metaAdAccountId, token, {
        name: config.audienceName,
        consentBasis: config.consentBasis,
      })
      audienceId = created.id
      await input.store.setRemoteAudienceId({
        orgId: input.orgId,
        audienceConfigId: input.audienceConfigId,
        runId: claim.runId,
        claimId: claim.claimId,
        audienceId,
      })
    }

    const projection = await input.store.loadProjectedMembers(config)
    const previous = await input.store.loadMemberships(input.orgId, input.audienceConfigId)
    const diff = diffAudienceMemberships(projection.members, previous)
    const counts: FinishCounts = {
      targetCount: projection.members.length,
      addCount: diff.add.length,
      removeCount: diff.remove.length,
      unchangedCount: diff.unchanged.length,
      invalidCount: projection.invalidCount,
      suppressedCount: projection.suppressedCount,
    }
    const finish = {
      ...counts,
      orgId: input.orgId,
      audienceConfigId: input.audienceConfigId,
      runId: claim.runId,
      claimId: claim.claimId,
    }

    if (input.dryRun) {
      await input.store.completeDryRun(finish)
      return { status: 'succeeded', dryRun: true, ...counts }
    }
    if (!audienceId) {
      throw new ReconcilePreconditionError('AUDIENCE_ID_REQUIRED', 'The Meta Custom Audience could not be resolved.')
    }

    if (diff.remove.length > 0) {
      const removed = await transport.syncHashes(audienceId, token, hashEntries(diff.remove), 'REMOVE')
      counts.invalidCount += removed.invalid
      if (removed.invalid > 0) throw new Error('Meta rejected one or more REMOVE identifiers')
    }
    if (diff.add.length > 0) {
      const added = await transport.syncHashes(audienceId, token, hashEntries(diff.add), 'ADD')
      counts.invalidCount += added.invalid
      if (added.invalid > 0) throw new Error('Meta rejected one or more ADD identifiers')
    }

    await input.store.commitSuccess({ ...finish, ...counts, members: projection.members })
    return { status: 'succeeded', dryRun: false, ...counts }
  } catch (error) {
    const failure = safeFailure(error, token)
    await input.store.fail({
      orgId: input.orgId,
      audienceConfigId: input.audienceConfigId,
      runId: claim.runId,
      claimId: claim.claimId,
      errorCode: failure.code,
      errorMessage: failure.message,
      misconfigured: failure.misconfigured,
    })
    return { status: 'failed', errorCode: failure.code, errorMessage: failure.message }
  }
}

type DbClient = SupabaseClient<Database>
type RpcResult = { data: unknown; error: { message: string } | null }
type RpcCall = (name: string, params: Record<string, unknown>) => Promise<RpcResult>
const SOURCE_PAGE_SIZE = 1_000

function sourceDefinition(config: ReconcileConfig): AudienceSourceDefinition {
  return normalizeAudienceSourceDefinition(config.audienceKind, config.sourceDefinition)
}

function accountEmail(customFields: Record<string, unknown>): string | null {
  return typeof customFields.email === 'string' ? normaliseEmail(customFields.email) : null
}

export class SupabaseAudienceReconcileStore implements AudienceReconcileStore {
  private readonly rpc: RpcCall

  constructor(private readonly client: DbClient) {
    this.rpc = client.rpc.bind(client) as unknown as RpcCall
  }

  async claim(input: ClaimInput): Promise<ReconcileClaim> {
    const { data, error } = await this.rpc('claim_meta_audience_sync', {
      p_org_id: input.orgId,
      p_audience_config_id: input.audienceConfigId,
      p_trigger_source: input.trigger,
      p_dry_run: input.dryRun,
    })
    if (error) throw new Error('Could not claim Meta audience reconciliation')
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row !== 'object') return { claimed: false }
    const value = row as Record<string, unknown>
    if (value.claimed !== true) return { claimed: false }
    return {
      claimed: true,
      runId: typeof value.run_id === 'string' ? value.run_id : undefined,
      claimId: typeof value.claim_id === 'string' ? value.claim_id : undefined,
    }
  }

  async loadConfig(orgId: string, audienceConfigId: string): Promise<ReconcileConfig | null> {
    const { data, error } = await this.client
      .from('meta_audience_config')
      .select('id, org_id, ads_connection_id, meta_ad_account_id, custom_audience_id, audience_name, consent_basis, terms_accepted_at, terms_accepted_by, audience_kind, source_definition')
      .eq('org_id', orgId)
      .eq('id', audienceConfigId)
      .maybeSingle()
    if (error) throw new Error('Could not read Meta audience configuration')
    if (!data) return null
    return {
      id: data.id,
      orgId: data.org_id,
      adsConnectionId: data.ads_connection_id,
      metaAdAccountId: data.meta_ad_account_id,
      customAudienceId: data.custom_audience_id,
      audienceName: data.audience_name ?? `Xphere Prospects — ${data.org_id.slice(0, 8)}`,
      consentBasis: data.consent_basis,
      termsAcceptedAt: data.terms_accepted_at,
      termsAcceptedBy: data.terms_accepted_by,
      audienceKind: data.audience_kind,
      sourceDefinition: data.source_definition,
    }
  }

  async loadProjectedMembers(config: ReconcileConfig) {
    const source = sourceDefinition(config)
    const entities: AudienceSourceEntity[] = []
    const segmentKeys = source.kind === 'prospect_segment' ? new Set(source.entityKeys) : null
    // A scrape audience spans every source type the definition selects, so this
    // filters with `.in`, not `.eq`. Narrowing it to a single value here would
    // silently drop entities that projectAudienceMember would have accepted.
    const sourceTypes = audienceSourceTypes(source)

    const contactIds = segmentKeys
      ? [...segmentKeys].filter((key) => key.startsWith('contact:')).map((key) => key.slice(8))
      : []
    type ContactRow = Pick<Database['public']['Tables']['contacts']['Row'],
      'id' | 'source_type' | 'lifecycle_stage' | 'email' | 'phone' | 'phone_e164' |
      'email_status' | 'dnd_enabled' | 'engagement_status' | 'identity_status'>
    const contacts: ContactRow[] = []
    if (!segmentKeys || contactIds.length > 0) {
      for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
        let query = this.client
          .from('contacts')
          .select('id, source_type, lifecycle_stage, email, phone, phone_e164, email_status, dnd_enabled, engagement_status, identity_status')
          .eq('org_id', config.orgId)
        if (sourceTypes) query = query.in('source_type', sourceTypes).eq('lifecycle_stage', 'prospect')
        if (contactIds.length > 0) query = query.in('id', contactIds)
        const { data, error } = await query
          .order('id', { ascending: true })
          .range(offset, offset + SOURCE_PAGE_SIZE - 1)
        if (error) throw new Error('Could not project audience contacts')
        contacts.push(...(data ?? []))
        if (!data || data.length < SOURCE_PAGE_SIZE) break
      }
    }

    const accountIds = segmentKeys
      ? [...segmentKeys].filter((key) => key.startsWith('account:')).map((key) => key.slice(8))
      : []
    type AccountRow = Pick<Database['public']['Tables']['accounts']['Row'],
      'id' | 'source_type' | 'lifecycle_stage' | 'phone' | 'custom_fields' |
      'email_status' | 'engagement_status'>
    const accounts: AccountRow[] = []
    if (!segmentKeys || accountIds.length > 0) {
      for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
        let query = this.client
          .from('accounts')
          .select('id, source_type, lifecycle_stage, phone, custom_fields, email_status, engagement_status')
          .eq('org_id', config.orgId)
        if (sourceTypes) query = query.in('source_type', sourceTypes).eq('lifecycle_stage', 'prospect')
        if (accountIds.length > 0) query = query.in('id', accountIds)
        const { data, error } = await query
          .order('id', { ascending: true })
          .range(offset, offset + SOURCE_PAGE_SIZE - 1)
        if (error) throw new Error('Could not project audience accounts')
        accounts.push(...(data ?? []))
        if (!data || data.length < SOURCE_PAGE_SIZE) break
      }
    }

    const suppressedEmails = new Set<string>()
    for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
      const { data, error } = await this.client
        .from('email_unsubscribes')
        .select('email')
        .eq('org_id', config.orgId)
        .order('email', { ascending: true })
        .range(offset, offset + SOURCE_PAGE_SIZE - 1)
      if (error) throw new Error('Could not read audience suppressions')
      for (const row of data ?? []) {
        const email = normaliseEmail(row.email)
        if (email) suppressedEmails.add(email)
      }
      if (!data || data.length < SOURCE_PAGE_SIZE) break
    }

    for (const contact of contacts) {
      const email = normaliseEmail(contact.email)
      entities.push({
        entityType: 'contact', entityId: contact.id, sourceType: contact.source_type,
        lifecycleStage: contact.lifecycle_stage, email: contact.email, phone: contact.phone,
        phoneE164: contact.phone_e164, emailStatus: contact.email_status,
        dndEnabled: contact.dnd_enabled, engagementStatus: contact.engagement_status,
        identityStatus: contact.identity_status,
        emailSuppressed: Boolean(email && suppressedEmails.has(email)),
      })
    }
    for (const account of accounts) {
      const email = accountEmail(account.custom_fields)
      entities.push({
        entityType: 'account', entityId: account.id, sourceType: account.source_type,
        lifecycleStage: account.lifecycle_stage, email: null, phone: account.phone,
        customFields: account.custom_fields as Json, emailStatus: account.email_status,
        engagementStatus: account.engagement_status,
        emailSuppressed: Boolean(email && suppressedEmails.has(email)),
      })
    }

    const projection = await projectAudienceMembers(entities, source)
    return {
      members: projection.members,
      suppressedCount: projection.exclusions.filter((item) =>
        item.reason === 'dnd' || item.reason === 'unsubscribed' || item.reason === 'email_suppressed',
      ).length,
      invalidCount: projection.exclusions.filter((item) =>
        item.reason === 'no_identifiers' || item.reason === 'duplicate_identifiers',
      ).length,
    }
  }

  async loadMemberships(orgId: string, audienceConfigId: string): Promise<StoredAudienceMembership[]> {
    const memberships: StoredAudienceMembership[] = []
    for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
      const { data, error } = await this.client
        .from('meta_audience_memberships')
        .select('entity_type, entity_id, submitted_email_hash, submitted_phone_hash, eligibility_fingerprint')
        .eq('org_id', orgId)
        .eq('audience_config_id', audienceConfigId)
        .order('entity_id', { ascending: true })
        .range(offset, offset + SOURCE_PAGE_SIZE - 1)
      if (error) throw new Error('Could not read successful audience membership')
      memberships.push(...(data ?? []).map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        submittedEmailHash: row.submitted_email_hash,
        submittedPhoneHash: row.submitted_phone_hash,
        eligibilityFingerprint: row.eligibility_fingerprint,
      })))
      if (!data || data.length < SOURCE_PAGE_SIZE) break
    }
    return memberships
  }

  async setRemoteAudienceId(input: {
    orgId: string; audienceConfigId: string; runId: string; claimId: string; audienceId: string
  }): Promise<void> {
    const { error } = await this.client
      .from('meta_audience_config')
      .update({ custom_audience_id: input.audienceId })
      .eq('org_id', input.orgId)
      .eq('id', input.audienceConfigId)
      .eq('sync_claim_id', input.claimId)
    if (error) throw new Error('Could not persist the Meta audience identifier')
  }

  async commitSuccess(input: FinishInput & { members: ProjectedAudienceMember[] }): Promise<void> {
    const { error } = await this.rpc('commit_meta_audience_sync', {
      p_org_id: input.orgId,
      p_audience_config_id: input.audienceConfigId,
      p_run_id: input.runId,
      p_claim_id: input.claimId,
      p_members: input.members.map((member) => ({
        entity_type: member.entityType,
        entity_id: member.entityId,
        submitted_email_hash: member.emailHash,
        submitted_phone_hash: member.phoneHash,
        eligibility_fingerprint: member.eligibilityFingerprint,
      })),
      p_counts: input,
    })
    if (error) throw new Error('Could not commit successful Meta audience state')
  }

  async completeDryRun(input: FinishInput): Promise<void> {
    const { error } = await this.rpc('complete_meta_audience_dry_run', {
      p_org_id: input.orgId,
      p_audience_config_id: input.audienceConfigId,
      p_run_id: input.runId,
      p_claim_id: input.claimId,
      p_counts: input,
    })
    if (error) throw new Error('Could not complete Meta audience dry run')
  }

  async fail(input: {
    orgId: string; audienceConfigId: string; runId: string; claimId: string
    errorCode: string; errorMessage: string; misconfigured: boolean
  }): Promise<void> {
    const { error } = await this.rpc('fail_meta_audience_sync', {
      p_org_id: input.orgId,
      p_audience_config_id: input.audienceConfigId,
      p_run_id: input.runId,
      p_claim_id: input.claimId,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
      p_misconfigured: input.misconfigured,
    })
    if (error) throw new Error('Could not record Meta audience sync failure')
  }
}
