import { runAgent } from './run-agent'
import type {
  AgentInvocationEnvelope,
  AgentInvocationResult,
  AgentRunOptions,
  AgentRunResult,
  TrustedAgentRoute,
} from './types'

export type { AgentInvocationEnvelope, AgentInvocationResult, TrustedAgentRoute } from './types'

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
