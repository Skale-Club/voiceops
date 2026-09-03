// src/lib/agent-runtime/index.ts
// Public API of the agent-runtime module.
// Phase 35 will import runAgent from here to wire it into the web widget endpoint.

export { runAgent } from './run-agent'
export { invokeAgent } from './invocation-gateway'
export type {
  AgentInvocationEnvelope,
  AgentInvocationResult,
  AgentRunResult,
  AgentRunOptions,
  TrustedAgentRoute,
} from './types'
// Phase 38: idempotency utilities (exported for test utilities and external tooling)
export { deriveIdempotencyKey, requiresIdempotency } from './idempotency'
// Phase 38: guardrail utilities
export { checkVisitedSet } from './guardrails'
