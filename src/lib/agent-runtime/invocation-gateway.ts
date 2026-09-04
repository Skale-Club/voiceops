import { runAgent } from './run-agent'
import { resolveSpecialistRoute } from './resolve-specialist-route'
import { resolveChannelRoutingMode } from './routing-mode'
import {
  createPartnerBudget,
  checkChannelModelInvocationCeiling,
  type PartnerBudget,
} from './guardrails'
import type {
  AgentChannel,
  AgentInvocationEnvelope,
  AgentInvocationResult,
  AgentRunOptions,
  AgentRunResult,
  TrustedAgentRoute,
} from './types'

export type { AgentInvocationEnvelope, AgentInvocationResult, TrustedAgentRoute } from './types'
export type { SpecialistRouteResult } from './resolve-specialist-route'

type StreamingEnvelope = AgentInvocationEnvelope & { stream: true }
type BlockingEnvelope = AgentInvocationEnvelope & { stream?: false }

/**
 * Trusted omnichannel entry point for the existing agent runtime.
 *
 * Tenant and agent identity are copied exclusively from `route`. Message
 * metadata is intentionally not spread into AgentRunOptions, so inbound
 * payloads cannot replace server-resolved identity or runtime controls.
 */
export function invokeAgent(
  envelope: StreamingEnvelope,
): AgentInvocationResult<ReadableStream<Uint8Array>>
export function invokeAgent(
  envelope: BlockingEnvelope,
): Promise<AgentInvocationResult<AgentRunResult>>
export function invokeAgent(
  envelope: AgentInvocationEnvelope,
):
  | AgentInvocationResult<ReadableStream<Uint8Array>>
  | Promise<AgentInvocationResult<AgentRunResult>> {
  const traceId = envelope.route.traceId ?? crypto.randomUUID()
  const idempotencyKey = envelope.route.idempotencyKey ?? crypto.randomUUID()

  const baseOptions: AgentRunOptions = {
    orgId: envelope.route.orgId,
    agentId: envelope.route.agentId,
    channel: envelope.route.channel,
    userMessage: envelope.input.userMessage,
    traceId,
  }

  if (envelope.route.conversationId !== undefined) {
    baseOptions.conversationId = envelope.route.conversationId
  }
  if (envelope.route.sessionId !== undefined) {
    baseOptions.sessionId = envelope.route.sessionId
  }
  if (envelope.historyWindow !== undefined) baseOptions.historyWindow = envelope.historyWindow
  if (envelope.mode !== undefined) baseOptions.mode = envelope.mode
  if (envelope.maxSteps !== undefined) baseOptions.maxSteps = envelope.maxSteps
  if (envelope.extraInstructions !== undefined) {
    baseOptions.extraInstructions = envelope.extraInstructions
  }

  const invocationMetadata = {
    traceId,
    idempotencyKey,
    externalInteractionId: envelope.route.externalInteractionId,
  }

  if (envelope.stream === true) {
    return {
      ...invocationMetadata,
      result: runAgent({ ...baseOptions, stream: true }),
    }
  }

  return runAgent({ ...baseOptions, stream: false }).then((result) => ({
    ...invocationMetadata,
    result,
  }))
}

export interface TrustedIntentRouteParams {
  /** Trusted org id of the current invocation. Never payload-derived. */
  organizationId: string
  /** Trusted invocation channel. Never payload-derived. */
  channel: AgentChannel
  /** Organization's already-configured entry/orchestrator agent for this channel. */
  entryAgentId: string
  /**
   * Trusted explicit intent/function name the channel adapter chose from its
   * own fixed, configured set (e.g. a tool/function name). Never free text
   * extracted from a user message or a model's own output — this is NOT the
   * same value as `AgentInvocationEnvelope.input.intent`, which remains
   * untrusted conversation data and is never used to select an agent.
   */
  intent?: string | null
}

export interface TrustedIntentRouteResult {
  /** The agentId a caller should pass as `route.agentId` to invokeAgent(). */
  agentId: string
  /** true when `intent` matched an active same-org specialist directly. */
  specialistMatched: boolean
}

/**
 * Resolves the trusted agentId a channel adapter should use for this turn,
 * given a trusted explicit intent.
 *
 * When `intent` identifies an active same-organization specialist allowed on
 * this channel, that specialist is returned directly — NO router or
 * orchestrator model call is made to pick it. Any ambiguity (missing intent,
 * no match, inactive specialist, or a channel the specialist doesn't allow)
 * falls back to `entryAgentId`, the caller's already-configured entry
 * orchestrator agent. Channel-neutral: this function has no knowledge of
 * Vapi, ManyChat, or any tenant-specific agent.
 *
 * This does not change invokeAgent()'s own trusted-identity contract —
 * callers resolve the route first, then pass the result as `route.agentId`.
 */
export async function resolveTrustedAgentRoute(
  params: TrustedIntentRouteParams
): Promise<TrustedIntentRouteResult> {
  const decision = await resolveSpecialistRoute({
    organizationId: params.organizationId,
    channel: params.channel,
    intent: params.intent,
  })

  if (decision.matched) {
    return { agentId: decision.agentId, specialistMatched: true }
  }

  return { agentId: params.entryAgentId, specialistMatched: false }
}

// ---------------------------------------------------------------------------
// Phase 136 Plan 01 (ROLL-02 wiring): consult the Phase 134 routing switch
// at the trusted boundary.
//
// Phase 134 built resolveChannelRoutingMode() and deliberately wired it into
// nothing, so an operator could flip the row and observe no difference.
// This is the first thing that reads it. It is a SWITCH in front of the
// existing paths, not a rewrite of either of them:
//
//   - 'legacy'     -> invokeAgent(envelope) exactly as written above, with
//                     the envelope's own route.agentId untouched. Byte-for-
//                     byte today's behavior, including for every caller that
//                     keeps calling invokeAgent() directly and never goes
//                     through this function at all.
//   - 'specialist' -> resolveTrustedAgentRoute() (Phase 132), the existing
//                     trusted-route resolver, THEN invokeAgent() with its
//                     result. No new routing logic is introduced here; this
//                     only decides which existing path runs.
//
// The mode is resolved ONCE per invocation (one query against
// agent_channel_routing_modes), never per tool call — invokeInternalSpecialist()
// below, used for in-turn delegation, does not call this function or repeat
// the lookup. Legacy callers pay for exactly that one query and nothing
// more: the specialist lookup (resolveSpecialistRoute's `agents` query)
// never runs unless the resolved mode is the literal string 'specialist' —
// never inferred, never defaulted into, and never reached because a lookup
// failed, since resolveChannelRoutingMode() itself fails closed to 'legacy'
// on every axis of uncertainty (absent row, read error, unrecognised or
// malformed value). An explicit 'legacy' row takes the same branch as no
// row at all.
// ---------------------------------------------------------------------------

export interface ChannelRoutedInvocationParams {
  /**
   * Trusted explicit intent/function name the channel adapter chose from
   * its own fixed, configured set — same trust contract as
   * TrustedIntentRouteParams.intent above. Never free text extracted from a
   * user message or a model's own output, and NOT the same value as
   * envelope.input.intent, which remains untrusted conversation data and is
   * never read for routing.
   */
  intent?: string | null
  /**
   * envelope.route.orgId / .channel / .agentId are the trusted organization,
   * channel, and already-configured entry/orchestrator agent for this
   * invocation — the same fields resolveTrustedAgentRoute() above calls
   * organizationId / channel / entryAgentId.
   */
  envelope: BlockingEnvelope
}

/**
 * The routed trusted boundary: resolves the Phase 134 channel routing mode
 * once, then dispatches to whichever existing path that mode names. See the
 * block comment above for the exact fail-closed contract.
 */
export async function invokeAgentWithChannelRouting(
  params: ChannelRoutedInvocationParams
): Promise<AgentInvocationResult<AgentRunResult>> {
  const { intent, envelope } = params
  const { orgId: organizationId, channel, agentId: entryAgentId } = envelope.route

  const mode = await resolveChannelRoutingMode({ organizationId, channel })

  if (mode !== 'specialist') {
    return invokeAgent(envelope)
  }

  const route = await resolveTrustedAgentRoute({ organizationId, channel, entryAgentId, intent })

  return invokeAgent({
    ...envelope,
    route: { ...envelope.route, agentId: route.agentId },
  })
}

// ---------------------------------------------------------------------------
// Phase 133 (PERF-01): voice latency policy on the Phase 132 tree-shared
// PartnerBudget.
// ---------------------------------------------------------------------------

/**
 * Lean, recoverable AgentRunResult for when a channel's internal specialist
 * model-invocation ceiling (channel-policy.ts) has already been spent on the
 * shared PartnerBudget. Never thrown — invokeInternalSpecialist() returns
 * this in place of calling runAgent(), so no model call and no side effect
 * can happen for the denied invocation. `status: 'skipped'` mirrors
 * checkKillSwitch()'s existing guardrail-tripped shape in guardrails.ts.
 */
export function buildSpecialistCeilingExhaustedResult(traceId: string): AgentRunResult {
  return {
    text: 'Reached the specialist lookup limit for this turn — continuing with what is already available.',
    usage: { tokensIn: 0, tokensOut: 0 },
    invocationId: '',
    traceId,
    status: 'skipped',
    errorDetail: 'channel_specialist_invocation_ceiling',
  }
}

/**
 * Invokes an internal specialist agent through the trusted gateway while
 * counting the call against the SAME Phase 132 tree-shared PartnerBudget
 * used by run-agent.ts's own delegation recursion (guardrails.ts
 * checkChannelModelInvocationCeiling) — never a second, independent
 * limiter. Callers that share one `partnerBudget` object across multiple
 * invokeInternalSpecialist() calls within one turn (e.g. trying a second
 * specialist after the first) get the channel's ceiling enforced across all
 * of them; a caller that omits `partnerBudget` gets a fresh one, so the
 * common single-specialist-per-turn case on every channel is unaffected.
 *
 * On exhaustion this resolves to buildSpecialistCeilingExhaustedResult()
 * WITHOUT calling runAgent() at all — no model call, no partial side
 * effect, and never an exception or a hang.
 */
export function invokeInternalSpecialist(
  envelope: BlockingEnvelope,
  partnerBudget: PartnerBudget = createPartnerBudget(),
): Promise<AgentInvocationResult<AgentRunResult>> {
  const traceId = envelope.route.traceId ?? crypto.randomUUID()

  const ceilingDenial = checkChannelModelInvocationCeiling(
    partnerBudget,
    envelope.route.channel,
    envelope.route.orgId,
    envelope.route.agentId,
  )
  if (ceilingDenial) {
    return Promise.resolve({
      traceId,
      idempotencyKey: envelope.route.idempotencyKey ?? crypto.randomUUID(),
      externalInteractionId: envelope.route.externalInteractionId,
      result: buildSpecialistCeilingExhaustedResult(traceId),
    })
  }

  partnerBudget.callCount += 1

  return invokeAgent({
    ...envelope,
    route: { ...envelope.route, traceId },
  })
}
