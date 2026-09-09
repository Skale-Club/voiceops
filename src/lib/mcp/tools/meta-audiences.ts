import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { OrgOAuthProvider, type AdsConnectionQueryClient } from '@/lib/meta/audience-provider'
import {
  reconcileMetaAudience,
  SupabaseAudienceReconcileStore,
  type ReconcileConfig,
} from '@/lib/meta/audience-reconcile'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

type AudienceConfigRow = {
  id: string
  org_id: string
  ads_connection_id: string | null
  meta_ad_account_id: string
  custom_audience_id: string | null
  audience_name: string | null
  audience_kind: string
  source_definition: ReconcileConfig['sourceDefinition']
  sync_enabled: boolean
  consent_basis: ReconcileConfig['consentBasis']
  terms_accepted_at: string | null
  terms_accepted_by: string | null
  operational_status: string
  last_synced_at: string | null
  last_sync_stats: unknown
  last_error_code: string | null
  last_error_message: string | null
}

const configColumns = [
  'id', 'org_id', 'ads_connection_id', 'meta_ad_account_id', 'custom_audience_id',
  'audience_name', 'audience_kind', 'source_definition', 'sync_enabled', 'consent_basis',
  'terms_accepted_at', 'terms_accepted_by', 'operational_status', 'last_synced_at',
  'last_sync_stats', 'last_error_code', 'last_error_message',
].join(', ')

async function loadConfig(orgId: string, id: string): Promise<AudienceConfigRow | null> {
  const { data, error } = await db()
    .from('meta_audience_config')
    .select(configColumns)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Could not read Meta audience configuration')
  return data as AudienceConfigRow | null
}

function reconcileConfig(config: AudienceConfigRow): ReconcileConfig {
  return {
    id: config.id,
    orgId: config.org_id,
    adsConnectionId: config.ads_connection_id,
    metaAdAccountId: config.meta_ad_account_id,
    customAudienceId: config.custom_audience_id,
    audienceName: config.audience_name ?? 'Xphere Prospects',
    consentBasis: config.consent_basis,
    termsAcceptedAt: config.terms_accepted_at,
    termsAcceptedBy: config.terms_accepted_by,
    audienceKind: config.audience_kind,
    sourceDefinition: config.source_definition,
  }
}

export const metaAudienceTools: McpToolDef[] = [
  {
    name: 'meta_audiences_status',
    title: 'List Meta prospect audiences',
    description:
      'List this workspace Meta/Facebook Custom Audience configurations, consent readiness, connection status, and recent aggregate sync results. Returns no contact identifiers, hashes, or access tokens.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const service = db()
      const [configsResult, connectionsResult, runsResult] = await Promise.all([
        service.from('meta_audience_config').select(configColumns).eq('org_id', auth.orgId).order('created_at', { ascending: true }),
        service.from('ads_connections').select('id, status, health, usable, ad_account_id, token_expires_at').eq('org_id', auth.orgId).eq('platform', 'meta'),
        service.from('meta_audience_sync_runs').select('audience_config_id, status, dry_run, target_count, add_count, remove_count, invalid_count, suppressed_count, error_code, created_at, completed_at').eq('org_id', auth.orgId).order('created_at', { ascending: false }).limit(20),
      ])
      if (configsResult.error || connectionsResult.error || runsResult.error) {
        return { error: 'meta_audience_status_unavailable', detail: 'Could not load Meta audience status.' }
      }
      const connections = new Map((connectionsResult.data ?? []).map((row: Record<string, unknown>) => [row.id, row]))
      return {
        audiences: (configsResult.data ?? []).map((config: AudienceConfigRow) => {
          const connection = connections.get(config.ads_connection_id ?? '') as Record<string, unknown> | undefined
          return {
            id: config.id,
            name: config.audience_name,
            kind: config.audience_kind,
            sync_enabled: config.sync_enabled,
            terms_accepted: Boolean(config.terms_accepted_at && config.terms_accepted_by),
            operational_status: config.operational_status,
            remote_audience_created: Boolean(config.custom_audience_id),
            // `connection_status` is selection only (active/available) as of
            // migration 1300; `connection_usable` is the real "can we sync"
            // signal (status='active' AND health='ok') — surfaced separately
            // so an operator/AI reading this doesn't mistake a hidden-but-
            // healthy account for a broken one, or vice versa. See
            // docs/integrations/ads-connection-health-plan.md.
            connection_status: connection?.status ?? 'missing',
            connection_health: connection?.health ?? null,
            connection_usable: connection?.usable ?? false,
            connection_expires_at: connection?.token_expires_at ?? null,
            last_synced_at: config.last_synced_at,
            last_sync_stats: config.last_sync_stats,
            last_error_code: config.last_error_code,
            last_error_message: config.last_error_message,
          }
        }),
        recent_runs: runsResult.data ?? [],
      }
    },
  },
  {
    name: 'meta_audience_sync',
    title: 'Preview or sync a Meta prospect audience',
    description:
      'Preview aggregate eligible/suppressed counts for a configured Meta/Facebook Custom Audience. A real ADD/REMOVE reconciliation runs only with confirmed:true, after explicit human approval, accepted Customer List terms, and sync_enabled=true. Never returns contact identifiers or hashes.',
    area: 'general_xphere',
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: z.object({
      audience_id: z.string().uuid().describe('Configuration id from meta_audiences_status.'),
      confirmed: z.boolean().optional().describe('Must be true to write ADD/REMOVE membership changes to Meta. Omit for count-only preview.'),
    }).strict(),
    handler: async (input, { auth }) => {
      const config = await loadConfig(auth.orgId, input.audience_id)
      if (!config) return { error: 'meta_audience_not_found', detail: 'Meta audience configuration was not found in this workspace.' }

      const service = db()
      if (!input.confirmed) {
        const projection = await new SupabaseAudienceReconcileStore(service).loadProjectedMembers(reconcileConfig(config))
        return {
          dry_run: true,
          audience_id: config.id,
          name: config.audience_name,
          eligible: projection.members.length,
          with_email: projection.members.filter((member) => member.emailHash).length,
          with_phone: projection.members.filter((member) => member.phoneHash).length,
          suppressed: projection.suppressedCount,
          invalid: projection.invalidCount,
          message: 'Nothing was sent to Meta. Show this aggregate preview to the human before using confirmed:true.',
        }
      }

      if (!config.sync_enabled) {
        return { error: 'meta_audience_sync_disabled', detail: 'Enable this audience in Xphere before requesting a real sync.' }
      }
      if (!config.terms_accepted_at || !config.terms_accepted_by) {
        return { error: 'meta_audience_terms_not_accepted', detail: 'Accept the Meta Customer List Custom Audience terms in Xphere first.' }
      }
      if (!config.ads_connection_id) {
        return { error: 'meta_audience_connection_required', detail: 'Select an active tenant Meta connection in Xphere first.' }
      }

      const result = await reconcileMetaAudience({
        store: new SupabaseAudienceReconcileStore(service),
        provider: new OrgOAuthProvider(service as unknown as AdsConnectionQueryClient),
        orgId: auth.orgId,
        audienceConfigId: config.id,
        trigger: 'manual',
        dryRun: false,
      })
      if (result.status === 'skipped') {
        return { error: 'meta_audience_sync_busy', detail: 'Another reconciliation is already running.' }
      }
      if (result.status === 'failed') {
        return { error: result.errorCode || 'meta_audience_sync_failed', detail: result.errorMessage }
      }
      return { synced: true, audience_id: config.id, ...result }
    },
  },
]
