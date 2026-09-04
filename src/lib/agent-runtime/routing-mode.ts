// src/lib/agent-runtime/routing-mode.ts
// Phase 134 (ROLL-02): the reversible-routing switch. Resolves, for one
// (organization, channel) pair, whether the ingress path should keep using
// the legacy entry-agent flow or Phase 132's resolveTrustedAgentRoute()
// specialist flow — and nothing else.
//
// This module is deliberately READ-ONLY with respect to the rest of the
// platform: it never creates, updates, or deletes an agent, an
// agent_channel_defaults mapping, a workflow, or an agent_invocations row.
// Flipping a channel between 'legacy' and 'specialist' (and back) can only
// ever change which code path a caller chooses to run next — see
// 134-CONTEXT.md "Rollback is non-destructive by construction: the switch
// changes which path reads the configuration, never the configuration
// itself."
//
// Not wired into any live route yet (135/136 do that). Not the same concept
// as the unrelated `routing_mode` (browser/phone_forward/sip) in
// src/app/(dashboard)/calls/settings-actions.ts and routing-actions.ts —
// this module never imports from, or writes to, those files or their table.
//
// Fail-to-legacy contract (134-CONTEXT.md "Confirmed Gaps" /
// "Locked Decisions"): 'legacy' is returned for EVERY axis of uncertainty —
// no row for the (org, channel) pair, a read error, a null/undefined value,
// or any string that isn't exactly 'legacy' or 'specialist'. An unknown
// value is never read as "enable specialist".

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { AgentChannel } from './types'
import { CHANNEL_ROUTING_MODES, type ChannelRoutingMode } from '@/lib/agents/zod-schemas'

export type { ChannelRoutingMode } from '@/lib/agents/zod-schemas'

export const LEGACY_ROUTING_MODE: ChannelRoutingMode = 'legacy'

export interface ResolveChannelRoutingModeParams {
  /** Trusted org id of the current invocation. Never payload-derived. */
  organizationId: string
  /** Trusted invocation channel. Never payload-derived. */
  channel: AgentChannel
}

function isRoutingMode(value: unknown): value is ChannelRoutingMode {
  return typeof value === 'string' && (CHANNEL_ROUTING_MODES as readonly string[]).includes(value)
}

/**
 * Resolves the routing mode for exactly one (organization, channel) pair.
 *
 * Cheap by design for the ingress path: a single scoped read against
 * `agent_channel_routing_modes`, no model call, no join, no recursion. Two
 * channels for the same organization (e.g. 'voice' and 'web_widget') are
 * resolved by two independent calls against two independent rows — flipping
 * one channel's row never reads or moves another channel's row.
 *
 * Fails closed to 'legacy' on every axis of uncertainty: no row, a read
 * error, or a value other than the two recognised modes.
 */
export async function resolveChannelRoutingMode(
  params: ResolveChannelRoutingModeParams
): Promise<ChannelRoutingMode> {
  const { organizationId, channel } = params

  if (!organizationId || !channel) {
    return LEGACY_ROUTING_MODE
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('agent_channel_routing_modes')
    .select('mode')
    .eq('organization_id', organizationId)
    .eq('channel', channel)
    .maybeSingle()

  if (error || !data) {
    return LEGACY_ROUTING_MODE
  }

  if (!isRoutingMode(data.mode)) {
    return LEGACY_ROUTING_MODE
  }

  return data.mode
}

/** Convenience predicate for callers that only care about the specialist branch. */
export async function isSpecialistRoutingEnabled(
  params: ResolveChannelRoutingModeParams
): Promise<boolean> {
  return (await resolveChannelRoutingMode(params)) === 'specialist'
}
