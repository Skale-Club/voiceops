// Template Organizations — shared types.
//
// A template captures the STRUCTURE of an organization (the "way of working"),
// never its live data. The snapshot shapes below only ever describe pipelines,
// custom field definitions, tags, message (email) templates, workflow
// definitions, and the agent mesh (agents, their active prompt text, direct
// tool grants, partner edges, delegated workflow grants, and channel
// defaults). They intentionally contain no contacts, conversations, bookings,
// logs, credentials, phone numbers, or connected-account data.

// Canonical definition lives with the DB types; re-exported here for colocation.
import type { OrgTemplateStatus } from '@/types/database'
export type { OrgTemplateStatus }

export const ASSET_GROUPS = [
  'pipelines',
  'custom_fields',
  'tags',
  'message_templates',
  'workflows',
  'agents',
] as const

export type OrgTemplateAssetGroup = (typeof ASSET_GROUPS)[number]

export const ASSET_GROUP_LABELS: Record<OrgTemplateAssetGroup, string> = {
  pipelines: 'Pipelines & stages',
  custom_fields: 'Custom fields',
  tags: 'Tags',
  message_templates: 'Message templates',
  workflows: 'Workflows (imported as drafts)',
  agents: 'Agents (mesh: prompts, tools, delegation, channel defaults)',
}

// ─── Snapshot payload shapes (structure only) ────────────────────────────────

export interface SnapshotPipelineStage {
  name: string
  position: number
  color: string
  is_won: boolean
  is_lost: boolean
}

export interface SnapshotPipeline {
  name: string
  is_default: boolean
  position: number
  stages: SnapshotPipelineStage[]
}

export interface SnapshotCustomField {
  entity: 'contact' | 'opportunity' | 'account'
  key: string
  label: string
  type: string
  required: boolean
  unique_per_org: boolean
  position: number
  group_name: string | null
  help_text: string | null
  default_value: unknown
  options: unknown
  validation: unknown
  visible_in_list: boolean
  filterable: boolean
}

export interface SnapshotTag {
  name: string
  slug: string
  color: string
}

export interface SnapshotMessageTemplate {
  name: string
  description: string | null
  subject_line: string
  preview_text: string
  ai_prompt: string | null
  status: string
  tags: string[]
  document: unknown
  html_snapshot: string | null
  plain_text_snapshot: string | null
}

export interface SnapshotWorkflow {
  name: string
  slug: string
  description: string | null
  kind: 'tool' | 'flow'
  tool_name: string | null
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
  trigger_config: Record<string, unknown>
  definition: unknown
}

export interface SnapshotAgent {
  slug: string
  name: string
  description: string | null
  /**
   * Derived at capture time, informational only — there is no `role` column on
   * `agents`. An agent with zero direct_tools is captured as 'orchestrator'; one
   * with at least one direct tool is 'specialist'. Never read by install logic for
   * an authorization decision; used only for summaries/checklists.
   */
  role: 'orchestrator' | 'specialist'
  model: string
  temperature: number | null
  max_tokens: number | null
  max_history: number
  fallback_message: string
  allowed_channels: string[]
  kb_scope: string[] | null
  is_active: boolean
  /**
   * Verbatim active-prompt-version text. May contain `{{business_name}}` /
   * `{{business_location}}` tokens (see src/lib/org-templates/prompt-template.ts,
   * a sibling plan) — capture does NOT interpret or strip them, it stores exactly
   * what agent_prompt_versions.system_prompt holds for the active version.
   */
  system_prompt: string
  /** Workflow tool_names this agent directly owns (agent_tools, workflow_id-sourced only). */
  direct_tools: string[]
}

export interface SnapshotAgentPartnerEdge {
  agent_slug: string
  partner_agent_slug: string
  invocation_description: string
  allowed_channels: string[] | null
  max_calls_per_turn: number
  max_depth: number
  timeout_ms: number
  /** Workflow tool_names this edge delegates (agent_partner_workflow_grants). */
  workflow_grants: string[]
}

export interface SnapshotAgentChannelDefault {
  channel: string
  agent_slug: string
}

export interface OrgTemplateSnapshot {
  pipelines?: SnapshotPipeline[]
  custom_fields?: SnapshotCustomField[]
  tags?: SnapshotTag[]
  message_templates?: SnapshotMessageTemplate[]
  workflows?: SnapshotWorkflow[]
  agents?: SnapshotAgent[]
  agent_partner_edges?: SnapshotAgentPartnerEdge[]
  agent_channel_defaults?: SnapshotAgentChannelDefault[]
}

// ─── Install result ──────────────────────────────────────────────────────────

export interface InstallCounts {
  pipelines: number
  stages: number
  custom_fields: number
  tags: number
  message_templates: number
  workflows: number
  agents: number
  agent_direct_tool_grants: number
  agent_partner_edges: number
  agent_delegated_workflow_grants: number
  agent_channel_defaults: number
}

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
}

export interface InstallSummary {
  counts: InstallCounts
  checklist: ChecklistItem[]
}

export function emptyCounts(): InstallCounts {
  return {
    pipelines: 0,
    stages: 0,
    custom_fields: 0,
    tags: 0,
    message_templates: 0,
    workflows: 0,
    agents: 0,
    agent_direct_tool_grants: 0,
    agent_partner_edges: 0,
    agent_delegated_workflow_grants: 0,
    agent_channel_defaults: 0,
  }
}
