// src/lib/agent-runtime/resolve-partner-edge.ts
// Phase 132 (ROUT-03, AUTHZ-01, AUTHZ-02, AUTHZ-03): fail-closed preflight for
// ONE agent_partners edge traversal.
//
// This is deliberately a NEW, separate resolver from resolveAgentTool()
// (resolve-agent-tool.ts). resolveAgentTool() answers "does this agent
// directly own this workflow/tool on this channel?" — that check is never
// modified here. resolvePartnerEdge() answers a different question: "may the
// source agent traverse this specific partner edge to reach the target agent
// right now?" Per 132-CONTEXT.md:
//
//   effective delegated authority
//     = specialist's own direct workflow grants   (resolveAgentTool, unchanged)
//     ∩ current partner edge's delegated workflow allow-list  (this module)
//     ∩ current channel policy                    (this module)
//
// A caller MUST still call resolveAgentTool() (or buildWorkflowTools())
// independently for the specific workflow before executing it — an "allow"
// decision here is traversal permission only and NEVER a substitute for, or
// an escalation of, the specialist's own direct tool/workflow grant.
//
// All identity (organizationId, sourceAgentId, partnerAgentId) MUST come from
// trusted server-side context (the resolved invocation chain), never from an
// LLM tool-call payload — there is no "payload" parameter on this function by
// design; any extra properties a caller mistakenly merges in from untrusted
// data are simply not read.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'
import type { AgentChannel } from './types'

export type PartnerEdgeDenialReason =
  | 'invalid_request'
  | 'edge_not_found'
  | 'cross_organization'
  | 'source_inactive'
  | 'target_inactive'
  | 'channel_not_allowed'
  | 'depth_exceeded'
  | 'call_count_exceeded'
  | 'malformed_policy'

export type PartnerEdgeAllow = {
  allow: true
  edgeId: string
  partnerAgentId: string
  maxCallsPerTurn: number
  maxDepth: number
  timeoutMs: number
  /**
   * Normalized delegated-workflow allow-list for THIS edge
   * (agent_partner_workflow_grants). Empty array = no delegated workflow
   * authority through this edge (the legacy/default state — 132-CONTEXT.md
   * "Never broaden authority when an edge policy is absent").
   */
  grantedWorkflowIds: string[]
}

export type PartnerEdgeDeny = {
  allow: false
  reason: PartnerEdgeDenialReason
}

export type PartnerEdgeDecision = PartnerEdgeAllow | PartnerEdgeDeny

export interface ResolvePartnerEdgeParams {
  /** Trusted org id of the current invocation chain. Never payload-derived. */
  organizationId: string
  /** Trusted id of the agent attempting to traverse the edge. Never payload-derived. */
  sourceAgentId: string
  /** Trusted id of the specialist the source is attempting to reach. Never payload-derived. */
  partnerAgentId: string
  /** Trusted invocation channel (voice/text). Never payload-derived. */
  channel: AgentChannel
  /** Delegation depth BEFORE this traversal (0 for a top-level agent). */
  currentDepth: number
  /** Number of partner calls already made this turn, BEFORE this traversal. */
  currentCallCount: number
}

type PartnerRow = {
  id: string
  organization_id: string
  allowed_channels: AgentChannel[] | null
  max_calls_per_turn: number | null
  max_depth: number | null
  timeout_ms: number | null
  source: { id: string; organization_id: string; is_active: boolean | null } | { id: string; organization_id: string; is_active: boolean | null }[] | null
  target: { id: string; organization_id: string; is_active: boolean | null } | { id: string; organization_id: string; is_active: boolean | null }[] | null
  agent_partner_workflow_grants: { workflow_id: string }[] | null
}

function firstOf<T>(v: T | T[] | null): T | null {
  if (v === null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * Resolves and authorizes exactly one agent_partners edge (source → partner)
 * before any model call or side effect executes. Fails closed: any missing
 * data, malformed policy, or ambiguity denies traversal.
 */
export async function resolvePartnerEdge(
  params: ResolvePartnerEdgeParams
): Promise<PartnerEdgeDecision> {
  const { organizationId, sourceAgentId, partnerAgentId, channel, currentDepth, currentCallCount } = params

  if (!organizationId || !sourceAgentId || !partnerAgentId || !channel) {
    return { allow: false, reason: 'invalid_request' }
  }
  if (currentDepth < 0 || currentCallCount < 0) {
    return { allow: false, reason: 'invalid_request' }
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('agent_partners')
    .select(
      `
      id,
      organization_id,
      allowed_channels,
      max_calls_per_turn,
      max_depth,
      timeout_ms,
      source:agents!agent_partners_agent_id_fkey ( id, organization_id, is_active ),
      target:agents!agent_partners_partner_agent_id_fkey ( id, organization_id, is_active ),
      agent_partner_workflow_grants ( workflow_id )
    `
    )
    .eq('organization_id', organizationId)
    .eq('agent_id', sourceAgentId)
    .eq('partner_agent_id', partnerAgentId)
    .maybeSingle()

  const edge = data as unknown as PartnerRow | null

  if (error || !edge) {
    createLogger({ orgId: organizationId, agentId: sourceAgentId }).warn('partner_edge_denied', {
      reason: 'edge_not_found',
      partnerAgentId,
    })
    return { allow: false, reason: 'edge_not_found' }
  }

  // Defense-in-depth: the composite FK (migration 1291) proves this at the DB
  // boundary, but the runtime preflight never trusts a single layer blindly.
  if (edge.organization_id !== organizationId) {
    return { allow: false, reason: 'cross_organization' }
  }

  const source = firstOf(edge.source)
  const target = firstOf(edge.target)

  if (!source || source.organization_id !== organizationId || source.is_active !== true) {
    return { allow: false, reason: 'source_inactive' }
  }
  if (!target || target.organization_id !== organizationId || target.is_active !== true) {
    return { allow: false, reason: 'target_inactive' }
  }
  if (target.id !== partnerAgentId) {
    return { allow: false, reason: 'cross_organization' }
  }

  const allowedChannels = edge.allowed_channels
  if (allowedChannels !== null && Array.isArray(allowedChannels) && !allowedChannels.includes(channel)) {
    return { allow: false, reason: 'channel_not_allowed' }
  }

  // Fail closed on malformed/missing policy: a finite, positive budget on
  // every axis is required before any delegated authority is granted.
  const maxDepth = edge.max_depth
  const maxCallsPerTurn = edge.max_calls_per_turn
  const timeoutMs = edge.timeout_ms
  if (
    typeof maxDepth !== 'number' || !Number.isFinite(maxDepth) || maxDepth < 1 ||
    typeof maxCallsPerTurn !== 'number' || !Number.isFinite(maxCallsPerTurn) || maxCallsPerTurn < 1 ||
    typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 1
  ) {
    createLogger({ orgId: organizationId, agentId: sourceAgentId }).warn('partner_edge_denied', {
      reason: 'malformed_policy',
      partnerAgentId,
    })
    return { allow: false, reason: 'malformed_policy' }
  }

  if (currentDepth >= maxDepth) {
    return { allow: false, reason: 'depth_exceeded' }
  }
  if (currentCallCount >= maxCallsPerTurn) {
    return { allow: false, reason: 'call_count_exceeded' }
  }

  const grants = Array.isArray(edge.agent_partner_workflow_grants) ? edge.agent_partner_workflow_grants : []
  const grantedWorkflowIds = grants
    .map((g) => g.workflow_id)
    .filter((id): id is string => typeof id === 'string')

  return {
    allow: true,
    edgeId: edge.id,
    partnerAgentId: target.id,
    maxCallsPerTurn,
    maxDepth,
    timeoutMs,
    grantedWorkflowIds,
  }
}

/**
 * AUTHZ-02: a delegation grant on an edge never creates or widens a direct
 * tool grant. This helper only proves that THIS edge's normalized grant list
 * permits delegating to `workflowId` — callers MUST additionally verify the
 * specialist directly owns the workflow via resolveAgentTool()/
 * buildWorkflowTools() before executing it.
 */
export function isWorkflowDelegatedThroughEdge(
  decision: PartnerEdgeDecision,
  workflowId: string
): boolean {
  if (!decision.allow) return false
  return decision.grantedWorkflowIds.includes(workflowId)
}
