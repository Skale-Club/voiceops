'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'
import { getRbacContext } from '@/lib/rbac/server'
import { OrgOAuthProvider, type AdsConnectionQueryClient } from '@/lib/meta/audience-provider'
import { DEFAULT_SCRAPE_SOURCE_TYPES } from '@/lib/meta/audience-source'
import {
  reconcileMetaAudience,
  SupabaseAudienceReconcileStore,
  type ReconcileConfig,
} from '@/lib/meta/audience-reconcile'
import type { Json } from '@/types/database'

export type MetaAudienceSafeCode =
  | 'NOT_AUTHENTICATED'
  | 'FORBIDDEN'
  | 'NO_ORGANIZATION'
  | 'CONFIG_NOT_FOUND'
  | 'CONNECTION_REQUIRED'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_INACTIVE'
  | 'CONNECTION_EXPIRED'
  | 'TERMS_NOT_ACCEPTED'
  | 'INVALID_SCOPE'
  | 'SYNC_DISABLED'
  | 'SYNC_BUSY'
  | 'META_FAILURE'
  | 'DATABASE_ERROR'

export interface ActionResult {
  ok: boolean
  code?: MetaAudienceSafeCode | string
  error?: string
}

export interface MetaAudienceConfigRow {
  id: string
  org_id: string
  ads_connection_id: string | null
  meta_business_id: string | null
  meta_ad_account_id: string
  custom_audience_id: string | null
  audience_name: string | null
  audience_kind: 'xcraper_master' | 'prospect_segment'
  source_definition: Json
  sync_enabled: boolean
  terms_accepted_at: string | null
  terms_accepted_by: string | null
  consent_basis: string
  operational_status: string
  dirty_at: string | null
  last_synced_at: string | null
  last_sync_stats: { sent?: number; removed?: number; invalid?: number } | null
  last_error_code: string | null
  last_error_message: string | null
}

export interface MetaAudienceConnectionOption {
  id: string
  adAccountId: string
  adAccountName: string
  status: string
  expiresAt: string | null
}

export interface MetaAudienceRunRow {
  id: string
  audienceConfigId: string
  status: string
  dryRun: boolean
  triggerSource: string
  targetCount: number
  addCount: number
  removeCount: number
  unchangedCount: number
  invalidCount: number
  suppressedCount: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface MetaAudienceDashboardData {
  orgName: string
  configs: MetaAudienceConfigRow[]
  connections: MetaAudienceConnectionOption[]
  savedSegments: Array<{ id: string; name: string; entityCount: number }>
  runs: MetaAudienceRunRow[]
}

type AuthContext = {
  userId: string
  orgId: string
  supabase: Awaited<ReturnType<typeof createClient>>
}

async function requireAudienceAdmin(): Promise<
  { ok: true; context: AuthContext } | { ok: false; result: ActionResult }
> {
  const user = await getUser()
  if (!user) return { ok: false, result: { ok: false, code: 'NOT_AUTHENTICATED', error: 'Sign in to continue.' } }
  const rbac = await getRbacContext()
  if (!rbac.isPlatformAdmin && rbac.role !== 'owner' && rbac.role !== 'admin') {
    return { ok: false, result: { ok: false, code: 'FORBIDDEN', error: 'Workspace admin access is required.' } }
  }
  const supabase = await createClient()
  const { data: orgId, error } = await supabase.rpc('get_current_org_id')
  if (error || !orgId) {
    return { ok: false, result: { ok: false, code: 'NO_ORGANIZATION', error: 'No active workspace found.' } }
  }
  return { ok: true, context: { userId: user.id, orgId: orgId as string, supabase } }
}

function entityKeysFromDefinition(definition: Json): string[] {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return []
  const values = definition.entityKeys
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string =>
    typeof value === 'string' && /^(contact|account):[0-9a-f-]{36}$/i.test(value),
  )
}

function configSourceValid(config: MetaAudienceConfigRow): boolean {
  if (config.audience_kind === 'xcraper_master') {
    if (!config.source_definition || typeof config.source_definition !== 'object' || Array.isArray(config.source_definition)) return false
    return config.source_definition.sourceType === 'xcraper'
  }
  return entityKeysFromDefinition(config.source_definition).length > 0
}

async function safePreflight(
  context: AuthContext,
  config: MetaAudienceConfigRow,
  requireTerms: boolean,
): Promise<ActionResult> {
  if (!config.ads_connection_id) {
    return { ok: false, code: 'CONNECTION_REQUIRED', error: 'Select a tenant Meta connection.' }
  }
  if (!configSourceValid(config)) {
    return { ok: false, code: 'INVALID_SCOPE', error: 'Choose a valid Xcraper or saved-segment scope.' }
  }
  if (requireTerms && (!config.terms_accepted_at || !config.terms_accepted_by)) {
    return { ok: false, code: 'TERMS_NOT_ACCEPTED', error: 'Accept the Meta Customer List terms before enabling writes.' }
  }
  const { data: connection, error } = await context.supabase
    .from('ads_connections')
    .select('id, status, ad_account_id, token_expires_at')
    .eq('id', config.ads_connection_id)
    .eq('org_id', context.orgId)
    .eq('platform', 'meta')
    .maybeSingle()
  if (error || !connection || connection.ad_account_id !== config.meta_ad_account_id) {
    return { ok: false, code: 'CONNECTION_NOT_FOUND', error: 'The selected Meta connection is not available in this workspace.' }
  }
  if (connection.status !== 'active') {
    return { ok: false, code: 'CONNECTION_INACTIVE', error: 'Reconnect the selected Meta account.' }
  }
  const expires = connection.token_expires_at ? Date.parse(connection.token_expires_at) : Number.NaN
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return { ok: false, code: 'CONNECTION_EXPIRED', error: 'The selected Meta token expired. Reconnect it before syncing.' }
  }
  return { ok: true }
}

export async function getMetaAudienceDashboard(): Promise<
  { ok: true; data: MetaAudienceDashboardData } | { ok: false; code: string; error: string }
> {
  const auth = await requireAudienceAdmin()
  if (!auth.ok) return auth.result as { ok: false; code: string; error: string }
  const { orgId, supabase } = auth.context
  const [configsResult, connectionsResult, segmentsResult, runsResult, orgResult] = await Promise.all([
    supabase.from('meta_audience_config').select('*').eq('org_id', orgId).order('created_at', { ascending: true }),
    supabase.from('ads_connections').select('id, ad_account_id, ad_account_name, status, token_expires_at').eq('org_id', orgId).eq('platform', 'meta').order('created_at', { ascending: true }),
    supabase.from('prospect_audiences').select('id, name, definition').eq('org_id', orgId).order('name', { ascending: true }),
    supabase.from('meta_audience_sync_runs').select('id, audience_config_id, status, dry_run, trigger_source, target_count, add_count, remove_count, unchanged_count, invalid_count, suppressed_count, error_code, error_message, created_at, completed_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(30),
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])
  if (configsResult.error || connectionsResult.error || segmentsResult.error || runsResult.error) {
    return { ok: false, code: 'DATABASE_ERROR', error: 'Could not load Meta audience settings.' }
  }
  const configs = (configsResult.data ?? []) as MetaAudienceConfigRow[]
  return {
    ok: true,
    data: {
      orgName: orgResult.data?.name ?? 'Workspace',
      configs,
      connections: (connectionsResult.data ?? []).map((row) => ({
        id: row.id,
        adAccountId: row.ad_account_id,
        adAccountName: row.ad_account_name ?? row.ad_account_id,
        status: row.status,
        expiresAt: row.token_expires_at,
      })),
      savedSegments: (segmentsResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        entityCount: entityKeysFromDefinition(row.definition).length,
      })),
      runs: (runsResult.data ?? []).map((row) => ({
        id: row.id,
        audienceConfigId: row.audience_config_id,
        status: row.status,
        dryRun: row.dry_run,
        triggerSource: row.trigger_source,
        targetCount: row.target_count,
        addCount: row.add_count,
        removeCount: row.remove_count,
        unchangedCount: row.unchanged_count,
        invalidCount: row.invalid_count,
        suppressedCount: row.suppressed_count,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })),
    },
  }
}

export async function getMetaAudienceConfig(): Promise<MetaAudienceConfigRow | null> {
  const result = await getMetaAudienceDashboard()
  return result.ok ? result.data.configs[0] ?? null : null
}

const saveSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  ads_connection_id: z.string().uuid(),
  audience_name: z.string().trim().min(1).max(200),
  audience_kind: z.enum(['xcraper_master', 'prospect_segment']),
  saved_segment_id: z.string().uuid().optional().nullable(),
  terms_accepted: z.boolean().default(false),
})

export type SaveMetaAudienceConfigInput = z.infer<typeof saveSchema>

export async function saveMetaAudienceConfig(input: SaveMetaAudienceConfigInput): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'INVALID_SCOPE', error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  const auth = await requireAudienceAdmin()
  if (!auth.ok) return auth.result
  const { orgId, userId, supabase } = auth.context
  const { data: connection } = await supabase
    .from('ads_connections')
    .select('id, ad_account_id')
    .eq('id', parsed.data.ads_connection_id)
    .eq('org_id', orgId)
    .eq('platform', 'meta')
    .maybeSingle()
  if (!connection) return { ok: false, code: 'CONNECTION_NOT_FOUND', error: 'Select a Meta connection from this workspace.' }

  // Every scrape source, not just the current one: prospects have shipped under
  // both `xcraper` and the earlier `google-maps` push, and "everyone we scraped"
  // has to mean both. Written as the plural form so the saved scope says so
  // explicitly instead of relying on the reader's default.
  let sourceDefinition: Json = { kind: 'xcraper_master', sourceTypes: [...DEFAULT_SCRAPE_SOURCE_TYPES] }
  if (parsed.data.audience_kind === 'prospect_segment') {
    if (!parsed.data.saved_segment_id) return { ok: false, code: 'INVALID_SCOPE', error: 'Choose a saved prospect segment.' }
    const { data: segment } = await supabase
      .from('prospect_audiences')
      .select('id, definition')
      .eq('id', parsed.data.saved_segment_id)
      .eq('org_id', orgId)
      .maybeSingle()
    const entityKeys = segment ? entityKeysFromDefinition(segment.definition) : []
    if (!segment || entityKeys.length === 0) {
      return { ok: false, code: 'INVALID_SCOPE', error: 'The saved segment has no explicit prospect members.' }
    }
    sourceDefinition = { kind: 'prospect_segment', prospectAudienceId: segment.id, entityKeys }
  }

  const now = new Date().toISOString()
  const existing = parsed.data.id
    ? await supabase.from('meta_audience_config').select('*').eq('id', parsed.data.id).eq('org_id', orgId).maybeSingle()
    : { data: null, error: null }
  if (parsed.data.id && !existing.data) return { ok: false, code: 'CONFIG_NOT_FOUND', error: 'Audience configuration was not found.' }
  const prior = existing.data as MetaAudienceConfigRow | null
  const resetRemote = Boolean(prior && (
    prior.ads_connection_id !== connection.id ||
    prior.meta_ad_account_id !== connection.ad_account_id ||
    JSON.stringify(prior.source_definition) !== JSON.stringify(sourceDefinition)
  ))
  const values = {
    org_id: orgId,
    ads_connection_id: connection.id,
    meta_business_id: null,
    meta_ad_account_id: connection.ad_account_id,
    audience_name: parsed.data.audience_name,
    audience_kind: parsed.data.audience_kind,
    source_definition: sourceDefinition,
    terms_accepted_at: prior?.terms_accepted_at ?? (parsed.data.terms_accepted ? now : null),
    terms_accepted_by: prior?.terms_accepted_by ?? (parsed.data.terms_accepted ? userId : null),
    operational_status: 'draft' as const,
    dirty_at: now,
    dirty_reason: 'configuration_changed',
    next_sync_at: now,
    ...(resetRemote ? { custom_audience_id: null, last_synced_at: null, last_sync_stats: null } : {}),
  }
  const mutation = prior
    ? supabase.from('meta_audience_config').update(values).eq('id', prior.id).eq('org_id', orgId)
    : supabase.from('meta_audience_config').insert({ ...values, sync_enabled: false })
  const { error } = await mutation
  if (error) return { ok: false, code: 'DATABASE_ERROR', error: 'Could not save the audience configuration.' }
  revalidatePath('/settings/integrations/meta-audience')
  revalidatePath('/prospects/audiences')
  return { ok: true }
}

async function ownedConfig(context: AuthContext, id: string): Promise<MetaAudienceConfigRow | null> {
  const { data } = await context.supabase
    .from('meta_audience_config')
    .select('*')
    .eq('id', id)
    .eq('org_id', context.orgId)
    .maybeSingle()
  return data as MetaAudienceConfigRow | null
}

export async function previewMetaAudience(id: string): Promise<
  ActionResult & { preview?: { entities: number; emails: number; phones: number; suppressed: number; invalid: number; scope: string } }
> {
  const auth = await requireAudienceAdmin()
  if (!auth.ok) return auth.result
  const config = await ownedConfig(auth.context, id)
  if (!config) return { ok: false, code: 'CONFIG_NOT_FOUND', error: 'Audience configuration was not found.' }
  if (!configSourceValid(config)) return { ok: false, code: 'INVALID_SCOPE', error: 'The selected source scope is empty or invalid.' }
  const service = createServiceRoleClient()
  const store = new SupabaseAudienceReconcileStore(service)
  const projected = await store.loadProjectedMembers({
    id: config.id,
    orgId: config.org_id,
    adsConnectionId: config.ads_connection_id,
    metaAdAccountId: config.meta_ad_account_id,
    customAudienceId: config.custom_audience_id,
    audienceName: config.audience_name ?? 'Xphere Prospects',
    consentBasis: config.consent_basis as ReconcileConfig['consentBasis'],
    termsAcceptedAt: config.terms_accepted_at,
    termsAcceptedBy: config.terms_accepted_by,
    audienceKind: config.audience_kind,
    sourceDefinition: config.source_definition,
  })
  return {
    ok: true,
    preview: {
      entities: projected.members.length,
      emails: projected.members.filter((member) => member.emailHash).length,
      phones: projected.members.filter((member) => member.phoneHash).length,
      suppressed: projected.suppressedCount,
      invalid: projected.invalidCount,
      scope: config.audience_kind === 'xcraper_master' ? 'Xcraper prospects' : 'Saved prospect segment',
    },
  }
}

export async function toggleMetaAudienceSync(id: string, enabled = true): Promise<ActionResult> {
  const auth = await requireAudienceAdmin()
  if (!auth.ok) return auth.result
  const config = await ownedConfig(auth.context, id)
  if (!config) return { ok: false, code: 'CONFIG_NOT_FOUND', error: 'Audience configuration was not found.' }
  if (enabled) {
    const preflight = await safePreflight(auth.context, config, true)
    if (!preflight.ok) return preflight
  }
  const now = new Date().toISOString()
  const { error } = await auth.context.supabase
    .from('meta_audience_config')
    .update(enabled
      ? { sync_enabled: true, operational_status: 'dirty', dirty_at: now, dirty_reason: 'enabled', next_sync_at: now }
      : { sync_enabled: false, operational_status: 'paused', sync_claim_id: null, sync_claimed_at: null })
    .eq('id', id)
    .eq('org_id', auth.context.orgId)
  if (error) return { ok: false, code: 'DATABASE_ERROR', error: 'Could not update audience sync.' }
  revalidatePath('/settings/integrations/meta-audience')
  return { ok: true }
}

export async function runMetaAudience(id: string, dryRun: boolean): Promise<ActionResult & { run?: unknown }> {
  const auth = await requireAudienceAdmin()
  if (!auth.ok) return auth.result
  const config = await ownedConfig(auth.context, id)
  if (!config) return { ok: false, code: 'CONFIG_NOT_FOUND', error: 'Audience configuration was not found.' }
  const preflight = await safePreflight(auth.context, config, !dryRun)
  if (!preflight.ok) return preflight
  if (!dryRun && !config.sync_enabled) {
    return { ok: false, code: 'SYNC_DISABLED', error: 'Enable this audience before requesting a real sync.' }
  }
  const service = createServiceRoleClient()
  const result = await reconcileMetaAudience({
    store: new SupabaseAudienceReconcileStore(service),
    provider: new OrgOAuthProvider(service as unknown as AdsConnectionQueryClient),
    orgId: auth.context.orgId,
    audienceConfigId: id,
    trigger: 'manual',
    dryRun,
  })
  revalidatePath('/settings/integrations/meta-audience')
  if (result.status === 'skipped') return { ok: false, code: 'SYNC_BUSY', error: 'Another reconciliation is already running.' }
  if (result.status === 'failed') return { ok: false, code: result.errorCode || 'META_FAILURE', error: result.errorMessage }
  return { ok: true, run: result }
}
