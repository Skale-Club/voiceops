// src/lib/agent-runtime/types.ts
// All shared TypeScript contracts for the agent runtime module.
// Shapes locked by D-34-02 (AgentRunResult), 34-CONTEXT.md, and 34-RESEARCH.md section 8.
// Phase 35 adds a stream overload to runAgent and makes agentId optional (D-35-06).

import type { Database, Json } from '@/types/database'

// TypeScript projection of the agent_channel DB enum (migration 034)
export type AgentChannel = Database['public']['Enums']['agent_channel']

// Return type of runAgent() | D-34-02 exact shape. Phase 35 adds stream overload.
export type AgentRunResult = {
  text: string
  usage: { tokensIn: number; tokensOut: number }
  invocationId: string   // UUID of agent_invocations row; '' if no row was written (denied call)
  traceId: string        // UUID generated at call site; present even for denied calls
  status: 'success' | 'error' | 'aborted' | 'denied' | 'skipped'
  errorDetail?: string
}

// Full resolved invocation context built inside runAgent() before any LLM call
export type AgentRunContext = {
  // Invocation identity
  orgId: string
  agentId: string
  channel: AgentChannel
  conversationId?: string
  sessionId?: string
  traceId: string          // UUID, generated before INSERT
  mode: 'production' | 'playground'

  // Delegation guard stub (D-34-10; Phase 38 activates recursion)
  _depth: number           // 0 for top-level calls

  // Resolved agent fields (after channel_overrides applied | D-34-11)
  systemPrompt: string     // from agent_prompt_versions via active_prompt_version_id (D-34-06)
  model: string            // agents.model or channel_override
  temperature?: number     // channel_override or undefined (let SDK use its default)
  maxTokens: number        // agents.max_tokens or channel_override
  maxHistory: number       // agents.max_history or channel_override
  fallbackMessage: string  // agents.fallback_message
  allowedChannels: AgentChannel[]  // agents.allowed_channels

  // Conversation input
  userMessage: string
  historyWindow: Array<{ role: 'user' | 'assistant'; content: string }>
}

// Options accepted by runAgent() from callers (channel handlers)
export type AgentRunOptions = {
  orgId: string
  agentId?: string                // Optional | resolved from agent_channel_defaults when absent (D-35-06)
  channel: AgentChannel
  userMessage: string
  conversationId?: string
  sessionId?: string
  historyWindow?: Array<{ role: 'user' | 'assistant'; content: string }>
  mode?: 'production' | 'playground'
  stream?: boolean                // When true, runAgent returns ReadableStream<Uint8Array> (D-35-01/D-35-09)
  /** Correlation id from the caller (e.g. webhook). When absent the runtime generates one. (O1b) */
  traceId?: string
  /** Per-call LLM step cap (overrides AGENT_MAX_LLM_CALLS_PER_TURN). Used by the workflow agent node. */
  maxSteps?: number
  /** Extra instructions appended to the system prompt for this invocation only (workflow agent node). */
  extraInstructions?: string
  // Internal fields set by Phase 38 recursive delegation (not for external callers):
  _depth?: number
  parentInvocationId?: string
  // Phase 38: visited-set for cycle detection (DELEG-06) | Set of agentIds already in the chain
  _visitedAgentIds?: Set<string>
  // Phase 38: ordered list of agentIds in the current delegation chain (for intersection check, DELEG-07)
  _delegationChain?: string[]
}

/**
 * Identity resolved by a trusted channel adapter before invoking an agent.
 * Keep these fields structurally separate from user-controlled message data.
 */
export type TrustedAgentRoute = {
  orgId: string
  agentId: string
  channel: AgentChannel
  externalInteractionId: string
  conversationId?: string
  sessionId?: string
  traceId?: string
  idempotencyKey?: string
}

/** Untrusted conversation data plus explicitly allowed runtime tuning. */
export type AgentInvocationEnvelope = {
  route: TrustedAgentRoute
  input: {
    userMessage: string
    intent?: string
    locale?: string
    actor?: {
      externalId?: string
      contactId?: string
      name?: string
      phone?: string
      email?: string
    }
    metadata?: Record<string, unknown>
  }
  historyWindow?: Array<{ role: 'user' | 'assistant'; content: string }>
  mode?: 'production' | 'playground'
  stream?: boolean
  maxSteps?: number
  extraInstructions?: string
}

/** Gateway metadata remains available without changing AgentRunResult. */
export type AgentInvocationResult<T> = {
  result: T
  traceId: string
  idempotencyKey: string
  externalInteractionId: string
}

// Shape returned by resolveAgent() after DB query + channel_overrides merge (D-34-11)
export type ResolvedAgent = {
  agentId: string
  orgId: string
  name: string
  systemPrompt: string       // from agent_prompt_versions row pointed to by active_prompt_version_id
  model: string
  temperature?: number
  maxTokens: number
  maxHistory: number
  /**
   * Per-channel LLM step cap from channel_overrides.max_steps (Q6).
   * When set, used as the default stopWhen: stepCountIs() cap in runAgent().
   * opts.maxSteps (e.g. from workflow node) takes precedence over this.
   */
  maxSteps?: number
  /**
   * Anthropic extended-thinking budget in tokens, from
   * channel_overrides.thinking_budget_tokens. 0/undefined → use the
   * AGENT_THINKING_BUDGET_TOKENS env default (off unless set).
   */
  thinkingBudgetTokens?: number
  fallbackMessage: string
  allowedChannels: AgentChannel[]
  isActive: boolean
  kbScope: string[] | null   // agents.kb_scope | null = full org KB (AGENT-05)
}

// Shape returned by resolveAgentTool()
// SEED-033: workflowId/workflowKind populated when the tool is sourced from
// a `workflows` row (kind='tool' or kind='flow'). actionType is set to
// 'run_flow' for kind='flow'. For workflow-sourced tools, integrationId,
// integrationProvider, and credentialsEncrypted are null | credentials are
// resolved inside the flow engine (per-node credential_ref).
export type ResolvedToolConfig = {
  toolConfigId: string
  toolName: string
  actionType: Database['public']['Enums']['action_type'] | 'run_flow'
  config: Json
  integrationId: string | null
  integrationProvider: Database['public']['Enums']['integration_provider'] | null
  credentialsEncrypted: string | null
  workflowId?: string
  workflowKind?: 'tool' | 'flow'
}

// Phase 132: typed allow-listed agent-to-agent handoff input and the
// discriminated specialist result union. Defined in ./handoff.ts (pure, no
// dependency on this file) and re-exported here so runtime consumers can
// import the whole agent-runtime contract surface from one place.
export type { HandoffMessage, HandoffInput, HandoffValidationResult, SpecialistResult } from './handoff'
