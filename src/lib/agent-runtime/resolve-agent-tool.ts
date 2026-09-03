// src/lib/agent-runtime/resolve-agent-tool.ts
// Sibling resolver to resolveTool(orgId, toolName) in src/lib/action-engine/.
// D-34-07: resolveTool() is NOT modified; this is a NEW function for agent-scoped authorization.
// Queries agent_tools junction to verify tool is attached to the agent + allowed on the channel.
//
// SEED-033: after the legacy tool_configs lookup, falls through to a second
// lookup against agent_tools joined to workflows (and workflow_versions for
// the definition). Workflow-sourced tools return a ResolvedToolConfig with
// workflowId/workflowKind populated and integration fields left null.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { extractActionTypeFromDefinition } from '@/lib/workflows/derive-action-type'
import { isWorkflowDelegatedThroughEdge, type PartnerEdgeDecision } from './resolve-partner-edge'
import type { AgentChannel, ResolvedToolConfig } from './types'

function isChannelAllowed(
  allowed: AgentChannel[] | null,
  channel: AgentChannel,
): boolean {
  if (allowed === null) return true
  if (!Array.isArray(allowed)) return true
  return (allowed as string[]).includes(channel)
}

export async function resolveAgentTool(
  agentId: string,
  toolName: string,
  channel: AgentChannel
): Promise<ResolvedToolConfig | null> {
  const supabase = createServiceRoleClient()

  // ── 1. Legacy path: agent_tools → tool_configs → integrations ─────────────
  const { data: legacyRow } = await supabase
    .from('agent_tools')
    .select(`
      allowed_channels,
      tool_config_id,
      _legacy_tool_configs!inner (
        id,
        tool_name,
        action_type,
        config,
        is_active,
        integration_id,
        integrations (
          provider,
          encrypted_api_key
        )
      )
    `)
    .eq('agent_id', agentId)
    .eq('_legacy_tool_configs.tool_name', toolName)
    .eq('_legacy_tool_configs.is_active', true)
    .not('tool_config_id', 'is', null)
    .maybeSingle()

  if (legacyRow) {
    const tc = legacyRow._legacy_tool_configs as {
      id: string
      tool_name: string
      action_type: string
      config: unknown
      is_active: boolean
      integration_id: string | null
      integrations?: { provider: string; encrypted_api_key: string } | null
    }

    if (!isChannelAllowed(legacyRow.allowed_channels as AgentChannel[] | null, channel)) {
      // Tool attached but not on this channel | keep searching the workflow path
      // before giving up entirely (a separate workflow attachment could allow it).
    } else {
      return {
        toolConfigId: tc.id,
        toolName: tc.tool_name,
        actionType: tc.action_type as ResolvedToolConfig['actionType'],
        config: tc.config as ResolvedToolConfig['config'],
        integrationId: tc.integration_id,
        integrationProvider: (tc.integrations?.provider ?? null) as ResolvedToolConfig['integrationProvider'],
        credentialsEncrypted: tc.integrations?.encrypted_api_key ?? null,
      }
    }
  }

  // ── 2. Workflow path: agent_tools → workflows → workflow_versions ─────────
  const { data: workflowRow } = await supabase
    .from('agent_tools')
    .select(`
      allowed_channels,
      workflow_id,
      workflows!inner (
        id,
        tool_name,
        kind,
        is_active,
        health_blocked,
        current_version_id
      )
    `)
    .eq('agent_id', agentId)
    .eq('workflows.tool_name', toolName)
    .eq('workflows.is_active', true)
    .eq('workflows.health_blocked', false)
    .not('workflow_id', 'is', null)
    .maybeSingle()

  if (!workflowRow) return null

  if (!isChannelAllowed(workflowRow.allowed_channels as AgentChannel[] | null, channel)) {
    return null
  }

  const wf = workflowRow.workflows as {
    id: string
    tool_name: string
    kind: 'tool' | 'flow'
    is_active: boolean
    health_blocked: boolean
    current_version_id: string | null
  }

  if (!wf.current_version_id) return null

  const { data: version } = await supabase
    .from('workflow_versions')
    .select('definition')
    .eq('id', wf.current_version_id)
    .single()

  if (!version) return null

  const definition = version.definition as ResolvedToolConfig['config']
  const actionType =
    wf.kind === 'tool'
      ? (extractActionTypeFromDefinition(definition) as ResolvedToolConfig['actionType'])
      : ('run_flow' as const)

  return {
    toolConfigId: wf.id,
    toolName: wf.tool_name,
    actionType,
    config: definition,
    integrationId: null,
    integrationProvider: null,
    credentialsEncrypted: null,
    workflowId: wf.id,
    workflowKind: wf.kind,
  }
}

// ---------------------------------------------------------------------------
// Phase 132 (AUTHZ-01/AUTHZ-02): effective delegated authority composition.
//
// Replaces the Phase 38 "every ancestor in the delegation chain must own
// this tool" intersection model. Per 132-CONTEXT.md "Authorization
// semantics":
//
//   effective delegated authority
//     = specialist's own direct workflow grants   (resolveAgentTool, unchanged)
//     ∩ current partner edge's delegated workflow allow-list  (resolvePartnerEdge)
//     ∩ current channel policy                    (resolvePartnerEdge)
//
// `incomingEdge` is the trusted, already-resolved PartnerEdgeAllow decision
// for the edge traversed to reach the CURRENT agent (undefined/null when the
// current agent was invoked directly, i.e. not through delegation — legacy
// top-level behavior is preserved unchanged in that case).
//
// AUTHZ-02 (never widen): when `resolved` is null (the specialist does not
// directly own the tool/workflow), the answer is ALWAYS deny — a delegation
// edge grant can never substitute for, or create, a direct tool grant.
//
// Legacy (non-workflow) `_legacy_tool_configs`-sourced tools have no
// verifiable per-edge grant surface at all (migration 1291 only introduced
// `agent_partner_workflow_grants`, keyed by `workflows.id`). Per
// "Never broaden authority when an edge policy is absent", a legacy tool is
// therefore NEVER delegated authority through an edge — it fails closed
// whenever `incomingEdge` is present, regardless of the edge's grant list.
export type EffectiveToolAuthorityDenialReason = 'not_attached' | 'not_delegated'

export type EffectiveToolAuthorityDecision =
  | { allow: true }
  | { allow: false; reason: EffectiveToolAuthorityDenialReason }

export function resolveEffectiveToolAuthority(
  resolved: ResolvedToolConfig | null,
  incomingEdge: PartnerEdgeDecision | null | undefined,
): EffectiveToolAuthorityDecision {
  // AUTHZ-02: no direct grant → always deny, independent of any edge policy.
  if (!resolved) return { allow: false, reason: 'not_attached' }

  // Not reached through delegation (top-level / directly invoked agent):
  // direct ownership alone is sufficient, matching pre-Phase-132 behavior.
  if (!incomingEdge) return { allow: true }

  // Reached through delegation: the specialist's own direct grant must also
  // be present in the current edge's delegated-workflow allow-list.
  if (!resolved.workflowId || !isWorkflowDelegatedThroughEdge(incomingEdge, resolved.workflowId)) {
    return { allow: false, reason: 'not_delegated' }
  }

  return { allow: true }
}
