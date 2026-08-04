// SEED-025 Phase B: unified workflow resolver.
//
// Reads tool-kind workflows from the unified `workflows` table and returns
// them in the legacy `ToolConfigWithIntegration` shape so callers (Vapi
// webhook, ManyChat dispatcher, agent runtime) do not need to change.
//
// Internally: workflow row + workflow_versions.definition (1-node graph) +
// integration row → projected back into the action-engine contract.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { ToolConfigWithIntegration } from '@/lib/action-engine/resolve-tool'

type WorkflowDefinitionField = Record<string, unknown> | Json | null

type ActionType = Database['public']['Enums']['action_type']

interface ActionNodeData {
  kind: 'action'
  action_type: string
  config: Record<string, unknown>
  credential_ref?: string
  label?: string
  fallback_message?: string
}

interface FlowDefinitionShape {
  nodes: Array<{
    id: string
    type: string
    data: Record<string, unknown>
  }>
}

function extractActionNode(definition: WorkflowDefinitionField): ActionNodeData | null {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return null
  const def = definition as unknown as FlowDefinitionShape
  if (!Array.isArray(def.nodes)) return null
  const actionNode = def.nodes.find((n) => n.type === 'action')
  if (!actionNode) return null
  const data = actionNode.data as unknown as ActionNodeData
  if (data?.kind !== 'action') return null
  return data
}

async function projectToToolConfig(
  workflow: {
    id: string
    org_id: string
    tool_name: string | null
    is_active: boolean
    health_blocked: boolean
    current_version_id: string | null
    legacy_tool_config_id: string | null
  },
  supabase: SupabaseClient<Database>,
): Promise<ToolConfigWithIntegration | null> {
  if (!workflow.tool_name) return null
  if (workflow.health_blocked) return null
  if (!workflow.current_version_id) return null

  const { data: version, error: vErr } = await supabase
    .from('workflow_versions')
    .select('definition')
    .eq('id', workflow.current_version_id)
    .single()

  if (vErr || !version) return null

  const action = extractActionNode(version.definition)
  if (!action) return null

  // A tool's action either calls an external provider (credential_ref points at
  // the org's integration row) or runs natively inside Xphere — create_task,
  // create_note, knowledge_base, pipeline_*, contact_create. Native actions have
  // nothing to decrypt, so requiring a credential here silently made every one
  // of them unresolvable as an agent tool ("Tool not configured.").
  let integration: {
    id: string
    encrypted_api_key: string
    location_id: string | null
    provider: Database['public']['Enums']['integration_provider']
    config: Database['public']['Tables']['integrations']['Row']['config']
  } | null = null

  if (action.credential_ref) {
    const { data, error: iErr } = await supabase
      .from('integrations')
      .select('id, encrypted_api_key, location_id, provider, config')
      .eq('id', action.credential_ref)
      .single()

    // An action that DOES name a credential but whose integration is missing or
    // keyless stays unresolvable — that's a real misconfiguration, not a native
    // action.
    if (iErr || !data?.encrypted_api_key) return null
    integration = data
  }

  // The legacy ToolConfigWithIntegration shape: project the workflow row
  // back into it so existing webhook/dispatcher callsites stay unchanged.
  // We use the workflow id (or its legacy_tool_config_id when present)
  // so that log writes that reference tool_config_id still match a real
  // row during the transition.
  return {
    id: workflow.legacy_tool_config_id ?? workflow.id,
    workflow_id: workflow.id,
    organization_id: workflow.org_id,
    integration_id: integration?.id ?? '',
    tool_name: workflow.tool_name,
    action_type: action.action_type as ActionType,
    config: action.config as unknown as Json,
    fallback_message: action.fallback_message ?? '',
    is_active: workflow.is_active,
    integrations: integration
      ? {
          id: integration.id,
          encrypted_api_key: integration.encrypted_api_key,
          location_id: integration.location_id,
          provider: integration.provider,
          config: integration.config,
        }
      : null,
  }
}

// Unified equivalent of resolveTool(orgId, toolName).
// Reads from workflows WHERE kind='tool' instead of tool_configs.
export async function resolveWorkflowAsTool(
  orgId: string,
  toolName: string,
  supabase: SupabaseClient<Database>,
): Promise<ToolConfigWithIntegration | null> {
  const { data: workflow, error } = await supabase
    .from('workflows')
    .select(
      'id, org_id, tool_name, is_active, health_blocked, current_version_id, legacy_tool_config_id',
    )
    .eq('org_id', orgId)
    .eq('kind', 'tool')
    .eq('tool_name', toolName)
    .eq('is_active', true)
    .is('deleted_at', null)
    .is('archived_at', null)
    .single()

  if (error || !workflow) return null
  return projectToToolConfig(workflow, supabase)
}

// Unified equivalent of resolveToolById(toolConfigId).
// During the transition we accept both real workflow ids AND the legacy
// tool_config id (preserved on workflows.legacy_tool_config_id).
export async function resolveWorkflowAsToolById(
  idOrLegacyId: string,
  supabase: SupabaseClient<Database>,
): Promise<ToolConfigWithIntegration | null> {
  const { data: workflow, error } = await supabase
    .from('workflows')
    .select(
      'id, org_id, tool_name, is_active, health_blocked, current_version_id, legacy_tool_config_id',
    )
    .eq('kind', 'tool')
    .or(`id.eq.${idOrLegacyId},legacy_tool_config_id.eq.${idOrLegacyId}`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .is('archived_at', null)
    .single()

  if (error || !workflow) return null
  return projectToToolConfig(workflow, supabase)
}
