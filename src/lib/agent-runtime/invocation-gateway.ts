import { runAgent } from './run-agent'
import { resolveSpecialistRoute } from './resolve-specialist-route'
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
