import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type {
  OrgTemplateAssetGroup,
  OrgTemplateSnapshot,
  SnapshotAgent,
  SnapshotAgentChannelDefault,
  SnapshotAgentPartnerEdge,
  SnapshotCustomField,
  SnapshotMessageTemplate,
  SnapshotPipeline,
  SnapshotTag,
  SnapshotWorkflow,
} from './types'

type Client = SupabaseClient<Database>

/**
 * Capture a STRUCTURE-ONLY snapshot of the caller's current organization.
 *
 * `supabase` MUST be an RLS-scoped client (the authenticated server client), so
 * every read is automatically constrained to the active org — there is no way
 * to capture another tenant's rows. Only the requested asset groups are read,
 * and the reads run concurrently since they are independent.
 *
 * Never reads: contacts, conversations, messages, bookings, calls, logs,
 * credentials, phone numbers, or connected accounts.
 */
/**
 * Explicit tenant scope for a capture.
 *
 * Every query in this module relied on RLS alone: through the authenticated
 * client that is exactly one organization, through a service-role client it
 * is EVERY organization on the platform - proven 2026-09-05 when an ops probe
 * captured 325 agents and 364 pipelines across all tenants in one call.
 * `organizationId` adds the tenant filter on every top-level query so a
 * caller can never depend on which client it happens to hold. The server
 * action passes it as defence in depth; a service-role caller MUST pass it.
 */
export interface CaptureScope {
  organizationId: string
}

/** Applies the tenant filter when a scope was given; leaves RLS to do it otherwise. */
function scoped<Q extends { eq: (col: string, val: string) => Q }>(query: Q, col: string, orgId?: string): Q {
  return orgId ? query.eq(col, orgId) : query
}

export async function captureOrgSnapshot(
  supabase: Client,
  groups: OrgTemplateAssetGroup[],
  scope?: CaptureScope
): Promise<OrgTemplateSnapshot> {
  const want = new Set(groups)
  const snapshot: OrgTemplateSnapshot = {}
  const tasks: Promise<void>[] = []
  const orgId = scope?.organizationId

  if (want.has('pipelines')) {
    tasks.push(capturePipelines(supabase, orgId).then((v) => void (snapshot.pipelines = v)))
  }
  if (want.has('custom_fields')) {
    tasks.push(captureCustomFields(supabase, orgId).then((v) => void (snapshot.custom_fields = v)))
  }
  if (want.has('tags')) {
    tasks.push(captureTags(supabase, orgId).then((v) => void (snapshot.tags = v)))
  }
  if (want.has('message_templates')) {
    tasks.push(captureMessageTemplates(supabase, orgId).then((v) => void (snapshot.message_templates = v)))
  }
  if (want.has('workflows')) {
    tasks.push(captureWorkflows(supabase, orgId).then((v) => void (snapshot.workflows = v)))
  }
  if (want.has('agents')) {
    tasks.push(
      captureAgents(supabase, orgId).then((v) => {
        snapshot.agents = v.agents
        snapshot.agent_partner_edges = v.agent_partner_edges
        snapshot.agent_channel_defaults = v.agent_channel_defaults
      })
    )
  }

  await Promise.all(tasks)
  return snapshot
}

async function capturePipelines(supabase: Client, orgId?: string): Promise<SnapshotPipeline[]> {
  const { data: pipelines } = await scoped(
    supabase.from('pipelines').select('id, name, is_default, position'),
    'org_id',
    orgId
  ).order('position')
  if (!pipelines || pipelines.length === 0) return []

  const { data: stages } = await scoped(
    supabase.from('pipeline_stages').select('pipeline_id, name, position, color, is_won, is_lost'),
    'org_id',
    orgId
  ).order('position')

  const stagesByPipeline = new Map<string, NonNullable<typeof stages>>()
  for (const s of stages ?? []) {
    const list = stagesByPipeline.get(s.pipeline_id) ?? []
    list.push(s)
    stagesByPipeline.set(s.pipeline_id, list)
  }

  return pipelines.map((p) => ({
    name: p.name,
    is_default: p.is_default,
    position: p.position,
    stages: (stagesByPipeline.get(p.id) ?? []).map((s) => ({
      name: s.name,
      position: s.position,
      color: s.color,
      is_won: s.is_won,
      is_lost: s.is_lost,
    })),
  }))
}

async function captureCustomFields(supabase: Client, orgId?: string): Promise<SnapshotCustomField[]> {
  const { data } = await scoped(
    supabase
      .from('custom_field_definitions')
      .select(
        'entity, key, label, type, required, unique_per_org, position, group_name, help_text, default_value, options, validation, visible_in_list, filterable'
      ),
    'org_id',
    orgId
  )
    .eq('archived', false)
    .order('position')
  return (data ?? []).map((f) => ({
    entity: f.entity as 'contact' | 'opportunity' | 'account',
    key: f.key,
    label: f.label,
    type: f.type as string,
    required: f.required,
    unique_per_org: f.unique_per_org,
    position: f.position,
    group_name: f.group_name,
    help_text: f.help_text,
    default_value: f.default_value,
    options: f.options,
    validation: f.validation,
    visible_in_list: f.visible_in_list,
    filterable: f.filterable,
  }))
}

async function captureTags(supabase: Client, orgId?: string): Promise<SnapshotTag[]> {
  const { data } = await scoped(supabase.from('tags').select('name, slug, color'), 'org_id', orgId).order('name')
  return (data ?? []).map((t) => ({ name: t.name, slug: t.slug, color: t.color }))
}

async function captureMessageTemplates(supabase: Client, orgId?: string): Promise<SnapshotMessageTemplate[]> {
  const { data } = await scoped(
    supabase
      .from('email_templates')
      .select(
        'name, description, subject_line, preview_text, ai_prompt, status, tags, document, html_snapshot, plain_text_snapshot'
      ),
    'org_id',
    orgId
  ).order('name')
  return (data ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    subject_line: t.subject_line,
    preview_text: t.preview_text,
    ai_prompt: t.ai_prompt,
    status: t.status,
    tags: t.tags ?? [],
    document: t.document,
    html_snapshot: t.html_snapshot,
    plain_text_snapshot: t.plain_text_snapshot,
  }))
}

async function captureWorkflows(supabase: Client, orgId?: string): Promise<SnapshotWorkflow[]> {
  const { data: workflows } = await scoped(
    supabase
      .from('workflows')
      .select(
        'id, name, slug, description, kind, tool_name, trigger_type, trigger_config, current_version_id'
      ),
    'org_id',
    orgId
  ).order('name')
  if (!workflows || workflows.length === 0) return []

  const versionIds = workflows
    .map((w) => w.current_version_id)
    .filter((id): id is string => !!id)

  const definitions = new Map<string, unknown>()
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)
    for (const v of versions ?? []) definitions.set(v.id, v.definition)
  }

  return workflows.map((w) => ({
    name: w.name,
    slug: w.slug,
    description: w.description,
    kind: (w.kind as 'tool' | 'flow') ?? 'flow',
    tool_name: w.tool_name,
    trigger_type: (w.trigger_type as SnapshotWorkflow['trigger_type']) ?? 'manual',
    trigger_config: (w.trigger_config as Record<string, unknown>) ?? {},
    definition: w.current_version_id ? definitions.get(w.current_version_id) ?? null : null,
  }))
}

/**
 * Capture the agent mesh: agents, their active prompt text, direct tool
 * grants, partner edges, delegated workflow grants, and channel defaults.
 *
 * Every cross-reference is resolved to a stable name before it leaves this
 * function — agent ids become `slug`, workflow ids become `tool_name` — so
 * the result can be installed into a different organization where none of
 * the source ids exist. RLS scopes every read to the caller's active org,
 * exactly like every sibling capture function; no explicit organization_id
 * filter is added anywhere below.
 */
async function captureAgents(supabase: Client, orgId?: string): Promise<{
  agents: SnapshotAgent[]
  agent_partner_edges: SnapshotAgentPartnerEdge[]
  agent_channel_defaults: SnapshotAgentChannelDefault[]
}> {
  const { data: agentRows } = await scoped(
    supabase
      .from('agents')
      .select(
        'id, slug, name, description, model, temperature, max_tokens, max_history, fallback_message, kb_scope, allowed_channels, is_active, active_prompt_version_id'
      ),
    'organization_id',
    orgId
  )
    // A template is what the source org is RUNNING. A deactivated agent is
    // history (the pre-mesh single agent, an abandoned experiment) and would
    // otherwise be carried into every target as dead weight holding grants.
    .eq('is_active', true)
    .order('name')

  if (!agentRows || agentRows.length === 0) {
    return { agents: [], agent_partner_edges: [], agent_channel_defaults: [] }
  }

  const slugById = new Map(agentRows.map((a) => [a.id, a.slug]))

  // Active prompt text — never fall back to agents.system_prompt (legacy/unused
  // by the runtime; see resolveAgent()). A missing/broken active version
  // captures an empty string rather than blocking the whole capture.
  const versionIds = agentRows
    .map((a) => a.active_prompt_version_id)
    .filter((id): id is string => !!id)

  const promptById = new Map<string, string>()
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from('agent_prompt_versions')
      .select('id, system_prompt')
      .in('id', versionIds)
    for (const v of versions ?? []) promptById.set(v.id, v.system_prompt)
  }

  // Direct tool grants — only workflow_id-sourced rows are portable across
  // tenants; tool_config_id-sourced rows point at a per-org integration
  // config a template cannot carry, and are silently skipped.
  const { data: agentToolRows } = await scoped(
    supabase.from('agent_tools').select('agent_id, workflow_id, tool_config_id'),
    'organization_id',
    orgId
  )

  const workflowIds = new Set<string>()
  for (const t of agentToolRows ?? []) {
    if (t.workflow_id) workflowIds.add(t.workflow_id)
  }

  // Partner edges + delegated workflow grants.
  const { data: partnerRows } = await scoped(
    supabase
      .from('agent_partners')
      .select(
        'id, agent_id, partner_agent_id, invocation_description, allowed_channels, max_calls_per_turn, max_depth, timeout_ms'
      ),
    'organization_id',
    orgId
  )

  const partnerEdgeIds = (partnerRows ?? []).map((p) => p.id)
  let grantRows: { partner_edge_id: string; workflow_id: string }[] = []
  if (partnerEdgeIds.length > 0) {
    const { data } = await supabase
      .from('agent_partner_workflow_grants')
      .select('partner_edge_id, workflow_id')
      .in('partner_edge_id', partnerEdgeIds)
    grantRows = data ?? []
  }
  for (const g of grantRows) workflowIds.add(g.workflow_id)

  const toolNameById = new Map<string, string | null>()
  if (workflowIds.size > 0) {
    const { data: workflows } = await supabase
      .from('workflows')
      .select('id, tool_name')
      .in('id', Array.from(workflowIds))
    for (const w of workflows ?? []) toolNameById.set(w.id, w.tool_name)
  }

  const directToolsByAgent = new Map<string, string[]>()
  for (const t of agentToolRows ?? []) {
    if (!t.workflow_id) continue
    const toolName = toolNameById.get(t.workflow_id)
    if (!toolName) continue
    const list = directToolsByAgent.get(t.agent_id) ?? []
    list.push(toolName)
    directToolsByAgent.set(t.agent_id, list)
  }

  const grantsByPartnerEdge = new Map<string, string[]>()
  for (const g of grantRows) {
    const toolName = toolNameById.get(g.workflow_id)
    if (!toolName) continue
    const list = grantsByPartnerEdge.get(g.partner_edge_id) ?? []
    list.push(toolName)
    grantsByPartnerEdge.set(g.partner_edge_id, list)
  }

  const agents: SnapshotAgent[] = agentRows.map((a) => {
    const directTools = directToolsByAgent.get(a.id) ?? []
    return {
      slug: a.slug,
      name: a.name,
      description: a.description,
      role: directTools.length === 0 ? 'orchestrator' : 'specialist',
      model: a.model,
      temperature: a.temperature,
      max_tokens: a.max_tokens,
      max_history: a.max_history,
      fallback_message: a.fallback_message,
      allowed_channels: a.allowed_channels ?? [],
      kb_scope: a.kb_scope,
      is_active: a.is_active,
      system_prompt: a.active_prompt_version_id
        ? promptById.get(a.active_prompt_version_id) ?? ''
        : '',
      direct_tools: directTools,
    }
  })

  const agent_partner_edges: SnapshotAgentPartnerEdge[] = (partnerRows ?? [])
    .map((p) => {
      const agentSlug = slugById.get(p.agent_id)
      const partnerSlug = slugById.get(p.partner_agent_id)
      if (!agentSlug || !partnerSlug) return null
      return {
        agent_slug: agentSlug,
        partner_agent_slug: partnerSlug,
        invocation_description: p.invocation_description,
        allowed_channels: p.allowed_channels as string[] | null,
        max_calls_per_turn: p.max_calls_per_turn,
        max_depth: p.max_depth,
        timeout_ms: p.timeout_ms,
        workflow_grants: grantsByPartnerEdge.get(p.id) ?? [],
      }
    })
    .filter((e): e is SnapshotAgentPartnerEdge => e !== null)

  const { data: channelDefaultRows } = await scoped(
    supabase.from('agent_channel_defaults').select('channel, agent_id'),
    'organization_id',
    orgId
  )

  const agent_channel_defaults: SnapshotAgentChannelDefault[] = (channelDefaultRows ?? [])
    .map((c) => {
      const agentSlug = slugById.get(c.agent_id)
      if (!agentSlug) return null
      return { channel: c.channel as string, agent_slug: agentSlug }
    })
    .filter((c): c is SnapshotAgentChannelDefault => c !== null)

  return { agents, agent_partner_edges, agent_channel_defaults }
}
