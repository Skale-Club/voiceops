// src/lib/agent-runtime/resolve-agent.ts
// Resolves an agent row + applies channel_overrides for the invocation channel.
// D-34-06: reads system_prompt from agent_prompt_versions (never from agents.system_prompt directly).
// D-34-11: channel_overrides deep-merge (system_prompt suffix-append; model/temp/tokens/history replace).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { hasTenantFactTokens, renderPromptTemplate, resolveTenantFacts } from '@/lib/org-templates/prompt-template'
import { createLogger } from '@/lib/obs/logger'
import { memoTtl } from '@/lib/cache/ttl-memo'
import type { AgentChannel, ResolvedAgent } from './types'

// Perf (2026-09-05 re-analysis, FINDINGS-OUTSIDE-SCOPE.md item 9): this is
// the single seam every runtime path (blocking, streaming, every partner
// call) resolves an agent through, and it was measured at 200-230ms in
// production (1358ms on a cold facts lookup) — a join plus, for a
// templatized prompt, the tenant-facts round trip in
// resolveTenantFacts(). Every one of those is read-only and does not
// change from one turn to the next, so it is safe to memoise for a short
// window: a prompt edit (new active_prompt_version_id, a flipped
// is_active, a channel_overrides change) reaching a live conversation up
// to 30s late is an acceptable trade against paying this cost twice per
// widget turn (orchestrator at depth 0, specialist at depth 1) and again
// on every follow-up turn. A failed/null resolution is NEVER cached —
// resolveAgentUncached() throws in that case so memoTtl's own
// never-cache-a-rejection contract keeps every caller retrying on the very
// next turn instead of being stuck behind a transient failure for 30s.
const RESOLVE_AGENT_TTL_MS = 30_000

async function resolveAgentUncached(
  agentId: string,
  orgId: string,
  channel: AgentChannel
): Promise<ResolvedAgent> {
  const supabase = createServiceRoleClient()

  // Fetch agent + active prompt version in one query (D-34-06: join via active_prompt_version_id)
  // Phase 41 (AGENT-12): system_prompt removed from outer select | runtime MUST use the version row.
  const { data: agent, error } = await supabase
    .from('agents')
    .select(`
      id,
      name,
      model,
      temperature,
      max_tokens,
      max_history,
      fallback_message,
      allowed_channels,
      channel_overrides,
      is_active,
      active_prompt_version_id,
      kb_scope,
      agent_prompt_versions!agents_active_prompt_version_id_fkey (
        id,
        system_prompt
      )
    `)
    .eq('id', agentId)
    .eq('organization_id', orgId)
    .single()

  if (error || !agent) throw new Error('agent_resolve_not_found')

  // Phase 41 (AGENT-12): runtime MUST use active_prompt_version_id; never reads agents.system_prompt directly.
  // If active_prompt_version_id is null, resolveAgent returns null | caller falls back to fallback_message.
  const promptVersionRow = Array.isArray(agent.agent_prompt_versions)
    ? agent.agent_prompt_versions[0]
    : agent.agent_prompt_versions

  if (!promptVersionRow?.system_prompt) {
    createLogger({ agentId, orgId })
      .error('agent_prompt_version_missing', { active_prompt_version_id: agent.active_prompt_version_id, resolution: 'returning_null_to_caller' })
    throw new Error('agent_prompt_version_missing')
  }
  // A stored prompt may be a template: scripts/templatize-agent-prompts.ts
  // (139-06) turns a live tenant's prompts into ones carrying
  // `{{business_name}}` / `{{business_location}}`, so that the same rows can be
  // captured into an org template. Those tokens are rendered here, on every
  // channel, from the tenant's own facts — this is the one seam every runtime
  // path (blocking, streaming, partner calls) resolves an agent through, so
  // rendering here is what makes "a template carries behaviour; a tenant
  // supplies its facts" true for the source tenant and not only for a target
  // one installed from it. Prompts without tokens cost nothing extra: the
  // facts lookup runs only when a token is present.
  const storedSystemPrompt = promptVersionRow.system_prompt
  const baseSystemPrompt = hasTenantFactTokens(storedSystemPrompt)
    ? renderPromptTemplate(storedSystemPrompt, await resolveTenantFacts(supabase, orgId))
    : storedSystemPrompt

  // D-34-11: apply channel_overrides | JSONB keyed by channel name
  const overrides = (agent.channel_overrides as Record<string, Record<string, unknown>> | null) ?? {}
  const channelOverride = overrides[channel] ?? {}

  // system_prompt: suffix-append only (NOT replace) | D-34-11
  const systemPrompt = channelOverride.system_prompt
    ? `${baseSystemPrompt}\n\n${channelOverride.system_prompt}`
    : baseSystemPrompt

  // model: replace if present in override
  const model = typeof channelOverride.model === 'string'
    ? channelOverride.model
    : agent.model

  // temperature: channel_override wins, else agents.temperature (migration 044,
  // NUMERIC → coerce to number), else undefined (let the SDK use its default).
  const temperature = typeof channelOverride.temperature === 'number'
    ? channelOverride.temperature
    : agent.temperature != null
      ? Number(agent.temperature)
      : undefined

  // max_tokens: channel_override wins, else agents.max_tokens (migration 044),
  // else a 1024-token default.
  const maxTokens = typeof channelOverride.max_tokens === 'number'
    ? channelOverride.max_tokens
    : agent.max_tokens != null
      ? Number(agent.max_tokens)
      : 1024

  // max_history: replace if present in override
  const maxHistory = typeof channelOverride.max_history === 'number'
    ? channelOverride.max_history
    : (agent.max_history ?? 20)

  // max_steps: channel-specific LLM step cap (Q6).
  // opts.maxSteps from callers (e.g. workflow node) takes precedence at runtime.
  const maxSteps = typeof channelOverride.max_steps === 'number'
    ? Math.max(1, Math.min(50, channelOverride.max_steps))
    : undefined

  // thinking_budget_tokens: per-channel extended-thinking budget (override-only).
  // 0/absent → runtime falls back to the AGENT_THINKING_BUDGET_TOKENS env default.
  const thinkingBudgetTokens = typeof channelOverride.thinking_budget_tokens === 'number'
    ? Math.max(0, Math.min(32000, channelOverride.thinking_budget_tokens))
    : undefined

  return {
    agentId: agent.id,
    orgId,
    name: agent.name,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    maxHistory,
    maxSteps,
    thinkingBudgetTokens,
    fallbackMessage: agent.fallback_message ?? "I can't help with that right now | let me transfer you to a human.",
    allowedChannels: (agent.allowed_channels ?? []) as AgentChannel[],
    isActive: agent.is_active ?? false,
    kbScope: (agent.kb_scope as string[] | null) ?? null,
  }
}

/**
 * Public entry point. Memoises a successful resolution for
 * RESOLVE_AGENT_TTL_MS, keyed by the exact (orgId, agentId, channel) triple
 * — a different channel can carry different channel_overrides, so it is
 * never folded into the same cache entry. Every failure path in
 * resolveAgentUncached() throws rather than returning null specifically so
 * memoTtl's "a rejected fn caches nothing" contract applies here without
 * any extra bookkeeping; this function is the only place that turns that
 * rejection back into the documented `null` return contract callers rely on.
 */
export async function resolveAgent(
  agentId: string,
  orgId: string,
  channel: AgentChannel
): Promise<ResolvedAgent | null> {
  try {
    return await memoTtl(
      `resolve-agent:${orgId}:${agentId}:${channel}`,
      RESOLVE_AGENT_TTL_MS,
      () => resolveAgentUncached(agentId, orgId, channel)
    )
  } catch {
    return null
  }
}
