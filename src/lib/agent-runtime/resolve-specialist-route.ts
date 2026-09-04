// src/lib/agent-runtime/resolve-specialist-route.ts
// Phase 132 Plan 04 (ROUT-02): trusted explicit intent/function-name -> a
// same-organization specialist agent, resolved directly with NO router or
// orchestrator model call.
//
// This is deliberately a NEW, separate resolver from resolveAgentTool()
// (direct workflow/tool ownership) and resolvePartnerEdge() (agent-to-agent
// delegation traversal). It answers a different question: "does this trusted
// explicit intent identify an active specialist agent this org already
// configured, on this channel?"
//
// The mapping is intentionally simple and reuses existing tenant
// configuration instead of inventing a second routing table: an "intent" IS
// the target agent's own `slug` (unique per organization — migration 034),
// the same identifier already used to key the `call_partner_<slug>`
// synthetic delegation tools in run-agent.ts. This keeps the mapping
// channel-neutral and tenant-configured: nothing here hardcodes Vapi,
// ManyChat, or any particular tenant's agent slugs.
//
// `intent` MUST be a trusted, explicit value the calling channel adapter
// chose from its own fixed, configured set (e.g. a tool/function name) —
// never free text extracted from a user message or a model's own output.
// Ambiguous input (missing intent, no match, an inactive specialist, or a
// specialist that doesn't allow this channel) is the caller's signal to fall
// back to the organization's configured entry/orchestrator agent; this
// module never guesses or broadens a match.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'
import type { AgentChannel } from './types'

export type SpecialistRouteDenialReason =
  | 'no_intent'
  | 'not_found'
  | 'inactive'
  | 'channel_not_allowed'
  | 'cross_organization'

export type SpecialistRouteMatch = {
  matched: true
  agentId: string
  agentSlug: string
}

export type SpecialistRouteNoMatch = {
  matched: false
  reason: SpecialistRouteDenialReason
}

export type SpecialistRouteResult = SpecialistRouteMatch | SpecialistRouteNoMatch

export interface ResolveSpecialistRouteParams {
  /** Trusted org id of the current invocation. Never payload-derived. */
  organizationId: string
  /** Trusted invocation channel. Never payload-derived. */
  channel: AgentChannel
  /**
   * Trusted explicit intent/function name chosen by the channel adapter from
   * its own fixed, configured set. Never free text extracted from a user
   * message or a model's own reasoning.
   */
  intent: string | null | undefined
}

type SpecialistAgentRow = {
  id: string
  organization_id: string
  slug: string
  is_active: boolean | null
  allowed_channels: string[] | null
}

/**
 * Resolves exactly one trusted intent -> same-org specialist agent mapping.
 * Fails closed: any missing data, cross-tenant mismatch, inactive agent, or
 * disallowed channel denies the direct route (caller falls back to its
 * configured entry agent).
 */
export async function resolveSpecialistRoute(
  params: ResolveSpecialistRouteParams
): Promise<SpecialistRouteResult> {
  const { organizationId, channel, intent } = params
  const trimmedIntent = intent?.trim()

  if (!organizationId || !channel || !trimmedIntent) {
    return { matched: false, reason: 'no_intent' }
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('agents')
    .select('id, organization_id, slug, is_active, allowed_channels')
    .eq('organization_id', organizationId)
    .eq('slug', trimmedIntent)
    .maybeSingle()

  const agent = data as unknown as SpecialistAgentRow | null

  if (error || !agent) {
    return { matched: false, reason: 'not_found' }
  }

  // Defense-in-depth: the query above already scopes by organization_id, but
  // the runtime preflight never trusts a single layer blindly.
  if (agent.organization_id !== organizationId) {
    createLogger({ orgId: organizationId }).warn('specialist_route_denied', {
      reason: 'cross_organization',
      intent: trimmedIntent,
    })
    return { matched: false, reason: 'cross_organization' }
  }

  if (agent.is_active !== true) {
    createLogger({ orgId: organizationId, agentId: agent.id }).warn('specialist_route_denied', {
      reason: 'inactive',
      intent: trimmedIntent,
    })
    return { matched: false, reason: 'inactive' }
  }

  const allowedChannels = (agent.allowed_channels ?? []) as AgentChannel[]
  if (channel !== 'workflow' && !allowedChannels.includes(channel)) {
    createLogger({ orgId: organizationId, agentId: agent.id }).warn('specialist_route_denied', {
      reason: 'channel_not_allowed',
      intent: trimmedIntent,
      channel,
    })
    return { matched: false, reason: 'channel_not_allowed' }
  }

  return { matched: true, agentId: agent.id, agentSlug: agent.slug }
}

// ---------------------------------------------------------------------------
// Phase 137 Plan 02 (MESH-02): trusted tool-name -> specialist resolution.
//
// resolveSpecialistRoute() above answers "does this intent match an active
// specialist's own slug?" (used by the text/web_widget call_partner_<slug>
// convention). This is a DIFFERENT question, asked by a channel adapter that
// only has a trusted function/tool name (e.g. Vapi's tool-call payload) and
// no agent slug at all: "which active, channel-allowed specialist in this
// org has this tool_name attached as one of its own granted workflows?"
//
// The mapping is derived entirely from tenant configuration already on disk
// (agent_tools joined to workflows) rather than a hardcoded table of tool
// names, so a tenant that names its tools differently still resolves
// correctly, and nothing here hardcodes any particular tenant's tool name.
//
// Fails closed, same posture as resolveSpecialistRoute(): no tool name, no
// owning agent, an inactive/unhealthy workflow, a channel the agent (or its
// per-tool override) does not allow, or MORE THAN ONE agent owning the same
// tool_name for this org+channel (ambiguous — e.g. a generalist agent that
// also has every tool attached) all resolve to no route. This function never
// guesses; the caller falls back to the existing direct Action Engine path.
// ---------------------------------------------------------------------------

export type SpecialistToolRouteDenialReason =
  | 'no_tool_name'
  | 'not_found'
  | 'ambiguous'
  | 'cross_organization'

export type SpecialistToolRouteResult =
  | SpecialistRouteMatch
  | { matched: false; reason: SpecialistToolRouteDenialReason }

export interface ResolveSpecialistForToolParams {
  /** Trusted org id of the current invocation. Never payload-derived. */
  organizationId: string
  /** Trusted invocation channel. Never payload-derived. */
  channel: AgentChannel
  /**
   * Trusted explicit tool/function name chosen by the channel adapter from
   * its own fixed, already-verified payload (e.g. a Vapi toolCall.name).
   * Never free text extracted from a user message or a model's own output.
   */
  toolName: string | null | undefined
}

type ToolOwnerAgentRow = {
  id: string
  organization_id: string
  slug: string
  is_active: boolean | null
  allowed_channels: string[] | null
}

type ToolOwnerRow = {
  agent_id: string
  allowed_channels: string[] | null
  agents: ToolOwnerAgentRow | ToolOwnerAgentRow[] | null
}

function firstOf<T>(v: T | T[] | null): T | null {
  if (v === null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * Resolves a trusted tool/function name to the single same-org, channel-
 * allowed specialist agent that has it attached as a granted workflow (via
 * `agent_tools` -> `workflows`), with NO orchestrator or router model call.
 */
export async function resolveSpecialistForTool(
  params: ResolveSpecialistForToolParams
): Promise<SpecialistToolRouteResult> {
  const { organizationId, channel, toolName } = params
  const trimmedToolName = toolName?.trim()

  if (!organizationId || !channel || !trimmedToolName) {
    return { matched: false, reason: 'no_tool_name' }
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('agent_tools')
    .select(
      `
      agent_id,
      allowed_channels,
      workflows!inner ( tool_name, is_active, health_blocked ),
      agents!inner ( id, organization_id, slug, is_active, allowed_channels )
    `
    )
    .eq('organization_id', organizationId)
    .eq('workflows.tool_name', trimmedToolName)
    .eq('workflows.is_active', true)
    .eq('workflows.health_blocked', false)
    .eq('agents.is_active', true)

  const rows = data as unknown as ToolOwnerRow[] | null

  if (error || !rows || rows.length === 0) {
    return { matched: false, reason: 'not_found' }
  }

  const matchedAgents = new Map<string, ToolOwnerAgentRow>()

  for (const row of rows) {
    const agent = firstOf(row.agents)
    if (!agent) continue

    // Defense-in-depth: the query above already scopes by organization_id,
    // but the runtime preflight never trusts a single layer blindly.
    if (agent.organization_id !== organizationId) continue

    const agentAllowedChannels = (agent.allowed_channels ?? []) as AgentChannel[]
    if (channel !== 'workflow' && !agentAllowedChannels.includes(channel)) continue

    // Per-tool channel override on the agent_tools junction row, if present.
    const toolAllowedChannels = row.allowed_channels
    if (
      channel !== 'workflow' &&
      Array.isArray(toolAllowedChannels) &&
      !(toolAllowedChannels as string[]).includes(channel)
    ) {
      continue
    }

    matchedAgents.set(agent.id, agent)
  }

  if (matchedAgents.size === 0) {
    return { matched: false, reason: 'not_found' }
  }

  if (matchedAgents.size > 1) {
    createLogger({ orgId: organizationId }).warn('specialist_tool_route_denied', {
      reason: 'ambiguous',
      toolName: trimmedToolName,
      candidateCount: matchedAgents.size,
    })
    return { matched: false, reason: 'ambiguous' }
  }

  const [agent] = [...matchedAgents.values()]

  return { matched: true, agentId: agent.id, agentSlug: agent.slug }
}
