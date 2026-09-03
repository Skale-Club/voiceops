import { z } from 'zod'
import { AVAILABLE_MODELS } from './models'
import { AGENT_CHANNELS } from './channels'

/**
 * Per-channel override shape. Empty/undefined fields are STRIPPED so the
 * runtime's "key absent → use base agent value" fallback works (Phase 34 lock).
 */
export const channelOverrideSchema = z
  .object({
    system_prompt_suffix: z.string().optional(),
    model: z.enum(AVAILABLE_MODELS).optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).max(200000).optional(),
    max_history: z.number().int().min(1).max(100).optional(),
    // Extended-thinking budget in tokens (0 = off). Widens the turn timeout
    // and forces temperature=1 at runtime when > 0.
    thinking_budget_tokens: z.number().int().min(0).max(32000).optional(),
  })
  .transform((v) => {
    const out: Record<string, unknown> = {}
    if (v.system_prompt_suffix && v.system_prompt_suffix.trim()) {
      out.system_prompt_suffix = v.system_prompt_suffix.trim()
    }
    if (v.model) out.model = v.model
    if (v.temperature !== undefined) out.temperature = v.temperature
    if (v.max_tokens !== undefined) out.max_tokens = v.max_tokens
    if (v.max_history !== undefined) out.max_history = v.max_history
    if (v.thinking_budget_tokens !== undefined) {
      out.thinking_budget_tokens = v.thinking_budget_tokens
    }
    return out
  })

/**
 * Full agent CRUD form payload. Maps to Database['public']['Tables']['agents']['Insert']
 * (with temperature + max_tokens added in Plan 01) plus a tool_ids list for the picker.
 */
export const agentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits, hyphens only'),
  description: z.string().max(500).nullable().optional(),
  system_prompt: z.string().min(1, 'System prompt is required'),
  model: z.enum(AVAILABLE_MODELS),
  fallback_message: z.string().min(1).max(500),
  max_history: z.number().int().min(1).max(100),
  temperature: z.number().min(0).max(2).nullable().optional(),
  max_tokens: z.number().int().min(1).max(200000).nullable().optional(),
  is_active: z.boolean(),
  /** Optional agent group (folder) for the sidebar tree. Null = Unfiled. */
  group_id: z.string().uuid().nullable().optional(),
  allowed_channels: z
    .array(z.enum(AGENT_CHANNELS))
    .min(1, 'At least one channel is required'),
  channel_overrides: z.record(z.enum(AGENT_CHANNELS), channelOverrideSchema),
  tool_ids: z.array(z.string().uuid()),
})

export type AgentFormInput = z.input<typeof agentSchema>
export type AgentFormOutput = z.output<typeof agentSchema>

/**
 * Settings-only payload (Prompt & Actions section owns system_prompt + tools).
 * Same shape as agentSchema minus `system_prompt` and `tool_ids`, so the
 * Settings form saves config without touching the prompt or attached tools.
 */
export const agentSettingsSchema = agentSchema.omit({
  system_prompt: true,
  tool_ids: true,
})

export type AgentSettingsInput = z.input<typeof agentSettingsSchema>
export type AgentSettingsOutput = z.output<typeof agentSettingsSchema>

/**
 * Phase 132 (AUTHZ-01): partner-edge policy payload. Bounds mirror the
 * migration 1291 CHECK constraints (chk_agent_partners_max_calls_per_turn_bounded,
 * chk_agent_partners_max_depth_bounded, chk_agent_partners_timeout_ms_bounded) so
 * a malformed config is rejected at the config layer before it ever reaches the
 * database. `allowed_channels: null` means "every channel the specialist agent
 * itself allows" (agent_tools.allowed_channels convention) — it is NOT an
 * escalation, since resolvePartnerEdge() still intersects with the specialist's
 * own allowed_channels. `granted_workflow_ids` is the normalized delegated-
 * workflow allow-list (agent_partner_workflow_grants); it is a TRAVERSAL grant
 * only and never substitutes for the specialist's own direct workflow grant.
 */
export const agentPartnerEdgeSchema = z.object({
  partner_agent_id: z.string().uuid(),
  invocation_description: z.string().min(1).max(1000),
  allowed_channels: z.array(z.enum(AGENT_CHANNELS)).min(1).nullable(),
  max_calls_per_turn: z.number().int().min(1).max(10),
  max_depth: z.number().int().min(1).max(5),
  timeout_ms: z.number().int().min(1000).max(120000),
  granted_workflow_ids: z.array(z.string().uuid()),
})

export type AgentPartnerEdgeInput = z.input<typeof agentPartnerEdgeSchema>
export type AgentPartnerEdgeOutput = z.output<typeof agentPartnerEdgeSchema>
