'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { PUBLIC_AGENT_CHANNELS, type AgentChannel } from '@/lib/agents/channels'
import type { AgentFormOutput, AgentSettingsOutput } from '@/lib/agents/zod-schemas'
import { CHANNEL_ROUTING_MODES, type ChannelRoutingMode } from '@/lib/agents/zod-schemas'
import { slugify } from '@/lib/agents/slug'
import { DEFAULT_MODEL } from '@/lib/agents/models'
import { setAgentTools, getToolPickerData } from './_actions/tools'

// Re-export sub-module functions so consumers can import from a single path
export { setAgentTools, getToolPickerData }

type AgentRow = Database['public']['Tables']['agents']['Row']

export interface AgentListItem extends AgentRow {
  tool_count: number
}

export interface AgentWithToolIds extends AgentRow {
  tool_ids: string[]
}

// ─── Agent list ───────────────────────────────────────────────────────────────

/**
 * Returns all org agents (active + inactive) ordered by position then
 * created_at. Each row is augmented with a `tool_count` from agent_tools.
 */
export async function getAgents(): Promise<AgentListItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*, agent_tools(count)')
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map((a) => {
    const { agent_tools: rel, ...rest } = a as AgentRow & {
      agent_tools: { count: number }[]
    }
    return { ...(rest as AgentRow), tool_count: rel?.[0]?.count ?? 0 }
  })
}

/**
 * Returns only is_active=true agents — used by Channel Defaults dropdowns.
 */
export async function getActiveAgents(): Promise<
  Pick<AgentRow, 'id' | 'name' | 'slug'>[]
> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('agents')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('name', { ascending: true })
  return data ?? []
}

// ─── Channel defaults ─────────────────────────────────────────────────────────

/**
 * Returns the channels with their currently-assigned agent_id.
 * Channels without an explicit default return null.
 */
export async function getChannelDefaults(): Promise<
  Record<AgentChannel, string | null>
> {
  const empty: Record<AgentChannel, string | null> = {
    voice: null,
    web_widget: null,
    sms: null,
    whatsapp: null,
    messenger: null,
    instagram: null,
    manychat: null,
    telegram: null,
    zernio: null,
    workflow: null,
  }
  const user = await getUser()
  if (!user) return empty
  const supabase = await createClient()
  const { data } = await supabase
    .from('agent_channel_defaults')
    .select('channel, agent_id')
  if (!data) return empty
  const result = { ...empty }
  for (const row of data) {
    result[row.channel as AgentChannel] = row.agent_id
  }
  return result
}

/**
 * UPSERTs the channel default when agentId is provided, DELETEs when null.
 */
export async function setChannelDefault(
  channel: AgentChannel,
  agentId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  if (agentId === null) {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .delete()
      .eq('channel', channel)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .upsert(
        { organization_id: orgId, channel, agent_id: agentId },
        { onConflict: 'organization_id,channel' }
      )
    if (error) return { error: error.message }
  }
  revalidatePath('/agents')
}

// ─── Channel routing modes ────────────────────────────────────────────────────
//
// Phase 139 Plan 03 (TMPL-04): the Phase 134 legacy/specialist switch,
// finally reachable from Settings instead of a raw SQL UPDATE. This never
// touches an agent, a mapping, a workflow, or an invocation row — it writes
// exactly one row in `agent_channel_routing_modes`, matching that table's
// own doc comment: flipping this switch changes which path READS
// configuration, never the configuration itself (see routing-mode.ts).

function isChannelRoutingMode(value: unknown): value is ChannelRoutingMode {
  return typeof value === 'string' && (CHANNEL_ROUTING_MODES as readonly string[]).includes(value)
}

/**
 * Returns every public channel's current routing mode. A channel with no row
 * in `agent_channel_routing_modes` defaults to 'legacy', matching that
 * table's own default and routing-mode.ts's fail-closed contract.
 */
export async function getChannelRoutingModes(): Promise<
  Record<AgentChannel, ChannelRoutingMode>
> {
  const empty = Object.fromEntries(
    PUBLIC_AGENT_CHANNELS.map((ch) => [ch, 'legacy' as ChannelRoutingMode])
  ) as Record<AgentChannel, ChannelRoutingMode>

  const user = await getUser()
  if (!user) return empty

  const supabase = await createClient()
  const { data } = await supabase.from('agent_channel_routing_modes').select('channel, mode')
  if (!data) return empty

  const result = { ...empty }
  for (const row of data) {
    if (isChannelRoutingMode(row.mode)) {
      result[row.channel as AgentChannel] = row.mode
    }
  }
  return result
}

/**
 * UPSERTs the routing mode for one (organization, channel) pair.
 */
export async function setChannelRoutingMode(
  channel: AgentChannel,
  mode: ChannelRoutingMode
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { error } = await supabase
    .from('agent_channel_routing_modes')
    .upsert(
      { organization_id: orgId, channel, mode },
      { onConflict: 'organization_id,channel' }
    )
  if (error) return { error: error.message }

  revalidatePath('/agents')
}

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

/**
 * Returns a single agent row + attached tool_config_ids. Returns null if the
 * agent is missing or out of scope.
 */
export async function getAgentById(
  id: string
): Promise<AgentWithToolIds | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!agent) return null
  const { data: tools } = await supabase
    .from('agent_tools')
    .select('tool_config_id')
    .eq('agent_id', id)
    .not('tool_config_id', 'is', null)
  return {
    ...(agent as AgentRow),
    tool_ids: (tools ?? [])
      .map((t) => t.tool_config_id)
      .filter((id): id is string => Boolean(id)),
  }
}

/**
 * Inserts a new agent row. TOOL-03: new agents start with zero attached tools
 * regardless of input.tool_ids — deny-by-default safety net.
 */
export async function createAgent(
  input: AgentFormOutput
): Promise<{ error?: string; id?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data, error } = await supabase
    .from('agents')
    .insert({
      organization_id: orgId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      system_prompt: input.system_prompt,
      model: input.model,
      fallback_message: input.fallback_message,
      max_history: input.max_history,
      temperature: input.temperature ?? null,
      max_tokens: input.max_tokens ?? null,
      is_active: input.is_active,
      group_id: input.group_id ?? null,
      position: 0,
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Insert']['channel_overrides'],
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'An agent with this slug already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/agents')
  return { id: data.id }
}

/**
 * Lightweight creation for the "New agent" popup. Collects only a name (and
 * optional description) and births the agent with sensible defaults; the rest
 * (prompt, tools, channels, …) is configured on the agent page afterwards.
 * Delegates to createAgent so insert/slug-collision handling stays in one place.
 */
export async function createAgentQuick(input: {
  name: string
  description?: string | null
}): Promise<{ error?: string; id?: string }> {
  const name = input.name.trim()
  if (!name) return { error: 'Name is required.' }

  const payload = {
    name,
    slug: slugify(name),
    description: input.description?.trim() || null,
    system_prompt: 'You are a helpful assistant.',
    model: DEFAULT_MODEL,
    fallback_message: 'I cannot help with that right now.',
    max_history: 20,
    temperature: null,
    max_tokens: null,
    is_active: true,
    group_id: null,
    allowed_channels: ['web_widget'],
    channel_overrides: {},
    tool_ids: [],
  } as unknown as AgentFormOutput

  return createAgent(payload)
}

/**
 * Updates an agent row + diffs its attached tools.
 */
export async function updateAgent(
  id: string,
  input: AgentFormOutput
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('agents')
    .update({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      system_prompt: input.system_prompt,
      model: input.model,
      fallback_message: input.fallback_message,
      max_history: input.max_history,
      temperature: input.temperature ?? null,
      max_tokens: input.max_tokens ?? null,
      is_active: input.is_active,
      group_id: input.group_id ?? null,
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Update']['channel_overrides'],
      updated_by: user.id,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'An agent with this slug already exists for your organization.' }
    }
    return { error: error.message }
  }

  const toolsResult = await setAgentTools(id, input.tool_ids)
  if (toolsResult && 'error' in toolsResult && toolsResult.error) {
    return { error: toolsResult.error }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
}

/**
 * Updates ONLY the settings fields of an agent row (name, slug, description,
 * model, fallback, generation params, channels, overrides, active, group).
 *
 * Unlike `updateAgent`, this does NOT touch `system_prompt` or attached tools —
 * those are owned by the "Prompt & Actions" section. Used by the Settings tab.
 */
export async function updateAgentSettings(
  id: string,
  input: AgentSettingsOutput
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('agents')
    .update({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      model: input.model,
      fallback_message: input.fallback_message,
      max_history: input.max_history,
      temperature: input.temperature ?? null,
      max_tokens: input.max_tokens ?? null,
      is_active: input.is_active,
      group_id: input.group_id ?? null,
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Update']['channel_overrides'],
      updated_by: user.id,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'An agent with this slug already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
}

/**
 * Renames an agent — updates ONLY `agents.name`. The slug is an identifier and
 * is intentionally left untouched so existing references stay stable. Used by
 * the inline-editable header title.
 */
export async function renameAgent(
  id: string,
  name: string
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('agents')
    .update({ name: trimmed, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
}

/**
 * Sets which org knowledge sources this agent may use (agents.kb_scope).
 * Pass `null` or an empty array to mean "use all org knowledge".
 */
export async function setAgentKbScope(
  id: string,
  sourceIds: string[] | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const next = sourceIds && sourceIds.length > 0 ? sourceIds : null
  const { error } = await supabase
    .from('agents')
    .update({ kb_scope: next, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/agents/${id}`)
  revalidatePath(`/agents/${id}/knowledge`)
}

/**
 * Flips agents.is_active. Deactivating an agent excludes it from Channel
 * Defaults dropdowns.
 */
export async function toggleAgentActive(
  id: string,
  active: boolean
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('agents')
    .update({ is_active: active, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/agents')
}

/**
 * Soft-deletes an agent:
 *  1. Refuses if the target IS the Main Agent.
 *  2. Refuses if no active Main Agent exists.
 *  3. Reassigns any channel defaults pointing at this agent → Main Agent.
 *  4. Sets is_active=false on the target.
 */
export async function softDeleteAgent(
  id: string
): Promise<{ error?: string; reassignedCount?: number } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data: mainAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', 'Main Agent')
    .eq('is_active', true)
    .maybeSingle()
  if (!mainAgent) {
    return { error: 'Cannot delete: no active Main Agent to reassign channel defaults to.' }
  }
  if (mainAgent.id === id) {
    return { error: 'Cannot delete the Main Agent.' }
  }

  const { data: reassigned, error: reassignError } = await supabase
    .from('agent_channel_defaults')
    .update({ agent_id: mainAgent.id })
    .eq('agent_id', id)
    .select('id')
  if (reassignError) return { error: reassignError.message }

  const { error } = await supabase
    .from('agents')
    .update({ is_active: false, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/agents')
  return { reassignedCount: reassigned?.length ?? 0 }
}

// ─── Ordering ─────────────────────────────────────────────────────────────────

export async function moveAgentToGroup(
  agentId: string,
  groupId: string | null,
): Promise<{ ok: true; data: undefined } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: tail } = await supabase
    .from('agents')
    .select('position')
    .eq('group_id', groupId as unknown as string)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (tail?.[0]?.position ?? -1) + 1

  const { error } = await supabase
    .from('agents')
    .update({ group_id: groupId, position: nextPosition })
    .eq('id', agentId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/agents')
  return { ok: true, data: undefined }
}

export async function reorderAgentsInGroup(
  _groupId: string | null,
  orderedIds: string[],
): Promise<{ ok: true; data: undefined } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    supabase.from('agents').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { ok: false, error: 'Failed to save agent order.' }

  revalidatePath('/agents')
  return { ok: true, data: undefined }
}
