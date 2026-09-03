// src/lib/agent-runtime/channel-policy.ts
// Phase 133 Plan 02 (PERF-01): channel-keyed latency policy for the agent
// runtime. Channel-neutral by design — no specific voice-provider name, no
// tenant slug, and no single client's playbook belongs in this file.
//
// This module answers exactly one question: "how many internal specialist
// MODEL invocations, and how much wall-clock time, may a turn on this
// channel spend before it must fall back to whatever it already has?" It
// does NOT enforce anything itself — see guardrails.ts
// (checkChannelModelInvocationCeiling), which reads the policy returned
// here and checks it against the Phase 132 tree-shared PartnerBudget.
//
// Voice is latency-sensitive: a caller is on the line waiting, so a normal
// lookup should resolve with at most one hop to an internal specialist
// before deterministic tool execution takes over. Text/widget channels keep
// today's looser behavior (no additional ceiling beyond the existing
// per-edge resolvePartnerEdge() bounds) — this module deliberately does not
// narrow that.

import type { AgentChannel } from './types'

export interface ChannelLatencyPolicy {
  /**
   * Max number of internal specialist MODEL invocations (Phase 132
   * PartnerBudget.callCount traversals) allowed anywhere in the invocation
   * tree for one turn on this channel. Deterministic tool execution that
   * needs no further model call is never counted against this ceiling.
   */
  maxInternalSpecialistInvocations: number
  /**
   * Wall-clock ceiling (ms) for the whole invocation tree under this
   * channel's policy. Independent from any single partner edge's own
   * timeout_ms (resolve-partner-edge.ts) — this is the channel-level bound.
   */
  wallClockCeilingMs: number
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// No additional channel-policy ceiling beyond what already exists today
// (per-edge max_calls_per_turn/timeout_ms in resolve-partner-edge.ts, and
// the global RUNTIME-04/05 caps in guardrails.ts). Effectively unrestricted.
const UNRESTRICTED_INVOCATIONS = Number.POSITIVE_INFINITY
const UNRESTRICTED_WALL_CLOCK_MS = Number.POSITIVE_INFINITY

const DEFAULT_POLICY: ChannelLatencyPolicy = {
  maxInternalSpecialistInvocations: UNRESTRICTED_INVOCATIONS,
  wallClockCeilingMs: UNRESTRICTED_WALL_CLOCK_MS,
}

const VOICE_POLICY: ChannelLatencyPolicy = {
  maxInternalSpecialistInvocations: readIntEnv('AGENT_VOICE_MAX_SPECIALIST_INVOCATIONS', 1),
  wallClockCeilingMs: readIntEnv('AGENT_VOICE_WALL_CLOCK_CEILING_MS', 8000),
}

// Single source of truth (task requirement: "read defaults from one place").
// Only channels that need a tighter-than-default policy are listed here —
// every other AgentChannel value falls through to DEFAULT_POLICY.
const CHANNEL_LATENCY_POLICIES: Partial<Record<AgentChannel, ChannelLatencyPolicy>> = {
  voice: VOICE_POLICY,
}

/**
 * Resolves the latency policy for a channel. `organizationId` is accepted
 * now (unused) so a later phase can source per-org overrides from this one
 * function without changing any call site — see channel-policy.ts header.
 */
export function getChannelLatencyPolicy(
  channel: AgentChannel,
  organizationId?: string,
): ChannelLatencyPolicy {
  void organizationId
  return CHANNEL_LATENCY_POLICIES[channel] ?? DEFAULT_POLICY
}
