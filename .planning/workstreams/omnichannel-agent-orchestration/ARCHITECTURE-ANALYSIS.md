# Omnichannel Agent Orchestration — Architecture Analysis

**Date:** 2026-09-03
**Status:** Planning complete at roadmap level; Phase 131 detailed planning in progress; production implementation not started.
**Workstream:** `omnichannel-agent-orchestration`

## Executive Conclusion

The target architecture is a shared, tenant-scoped graph of specialist Xphere agents reused by voice and text. Vapi remains responsible for telephony, STT, TTS, and its live conversation loop. Xphere resolves the tenant, invokes the correct internal orchestrator or specialist, executes workflows through the Action Engine, and returns a channel-appropriate result. All generative inference owned by Xphere must use OpenRouter.

The current product only partially implements this model:

- Text already uses `runAgent()` and OpenRouter, but Cuts & Culture has one overloaded generalist agent and no configured partners.
- Voice currently uses a Vapi assistant whose functions call `/api/vapi/tools`; that route resolves a workflow and calls the Action Engine directly. It does not call `runAgent()` or any specialist.
- Internal delegation exists, but the current intersection authorization model requires the orchestrator to possess every downstream tool, which defeats clean specialization and least privilege.
- The `voice` channel does not exist in the agent channel enum or channel registry.
- `assistant_mappings` has no internal `agent_id`/entry-agent binding.

## Live Cuts & Culture Snapshot

Verified on 2026-09-03:

- Cuts & Culture is an active Xphere organization and has an active Xkedule integration targeting `demo.xkedule.com`.
- Vapi assistant: `99518fa7-09f1-4c76-b7c8-58cd8a92105c`, named `Cuts & Culture | Receptionist | EN`.
- Current Vapi model: `anthropic/claude-haiku-4.5` through provider `openrouter`.
- Vapi tools: `list_services`, `business_info`, `get_quote`, `check_availability`, `lookup_customer`, `book_appointment`, `reschedule_appointment`, `cancel_appointment`.
- Every Vapi tool points to `https://xphere.app/api/vapi/tools`.
- The assistant is held in the shared Skale Club Vapi account; the Cuts organization itself has OpenRouter and Xkedule integrations but no tenant-owned Vapi integration.
- One historical Vapi call failed with an OpenAI 401 before the assistant was updated to OpenRouter. A later live call is still required to prove the corrected configuration end to end.
- Text agent: one active generalist named `Cuts & Culture | Booking Agent | EN`, model `anthropic/claude-sonnet-4.6`, allowed on `web_widget`, with eight workflow tools and no agent partners.
- Six observed text invocations were all depth zero and successful at the top level; none delegated.
- Observed text latency was approximately 13.8s minimum, 26.3s median, and 41.2s maximum. Inputs reached approximately 21k tokens.
- Thirteen observed workflow tool runs included ten successes and three failures. An invocation can remain `success` when a nested tool fails, exposing a status-semantics gap.

## Current Runtime Paths

### Voice

```text
Vapi tool call
  -> src/app/api/vapi/tools/route.ts
  -> resolveOrgForCall(...)
  -> resolveTool(orgId, toolName) for a kind='tool' workflow
  -> decrypt tenant/provider credentials
  -> executeAction(...)
  -> Xkedule/provider
```

Properties:

- Node.js runtime.
- Always returns HTTP 200 by contract.
- Non-essential logging uses the established deferred pattern.
- Processes only `toolCallList[0]`; additional tool calls are currently ignored.
- Does not invoke internal agents.

### Text

```text
Widget/channel adapter
  -> runAgent(...)
  -> OpenRouter model
  -> attached workflow tools and/or call_partner_<slug>
  -> workflow runtime
  -> executeAction(...)
  -> provider
```

Properties:

- `runAgent()` is the shared text-side agent runtime.
- Agent model calls use OpenRouter with tenant key first and platform fallback.
- Partner calls recursively call `runAgentBlocking()` with a structured handoff.
- Default delegation depth is 2; root-to-specialist-to-second-specialist reaches the cap.
- The configured `kbScope` is loaded but not enforced; runtime retrieval currently queries organization knowledge generally.

## Critical Architectural Gaps

### 1. No shared voice/text invocation boundary

There is no typed gateway that normalizes trusted tenant, channel, actor, interaction, trace, intent/message, and idempotency context before invoking an agent. Voice and text enter different runtime paths.

### 2. No Vapi-to-agent binding

`assistant_mappings` stores organization, Vapi assistant ID, display name, and status, but no internal entry-agent ID. The database and TypeScript types need an additive, tenant-safe binding.

### 3. Voice is not an agent channel

The `agent_channel` enum and application channel registry support web widget and messaging channels, but not Vapi/voice. Channel overrides therefore cannot express voice-specific model, history, prompt, tool, or latency policy.

### 4. Delegation authorization conflicts with specialization

The current runtime uses authorization intersection across every agent in the delegation chain. This prevents confused-deputy escalation, but it requires an orchestrator to have the specialist's final tools attached. The result is a larger prompt, duplicated capability visibility, and continued risk that the orchestrator calls sensitive tools directly.

Target authorization must separate:

- direct execution grants owned by the agent;
- delegation permission owned by the partner edge;
- an optional capability/workflow allow-list on the edge.

The effective downstream authority is the intersection of the specialist's own grants and the edge's delegated capabilities, not every ancestor's direct tool list.

### 5. Naive multi-agent routing would violate voice latency

A sequence such as Vapi model -> Xphere router model -> specialist model -> tool is too slow. Voice must use hybrid routing:

- explicit Vapi function -> mapped specialist directly;
- ambiguous natural-language request -> entry orchestrator;
- deterministic reads/writes -> workflow/Action Engine without unnecessary extra model calls;
- normally at most one internal specialist model call on a voice tool turn.

### 6. Incomplete idempotency across Xkedule writes

Stable operation identity must travel from ingress through agent, workflow, Action Engine, and Xkedule. Booking, reschedule, and cancellation retries must return the original recorded result and never duplicate the mutation.

### 7. Incomplete timeout ownership

Some workflow timeouts race the work but do not cancel the underlying operation. This is unsafe for voice-triggered mutations because the caller may retry while the original work continues.

### 8. Partial OpenRouter invariant

`runAgent()` is OpenRouter-only, but platform-wide generative inference is not fully centralized:

- knowledge embedding paths still use OpenAI directly;
- an ads memory-extraction route uses Anthropic directly;
- some legacy direct-provider fallback code remains.

Generative inference should be centralized behind an OpenRouter provider factory. Embeddings must be classified separately because changing them can require vector reindexing.

### 9. Observability is not end to end

`agent_invocations` supports trace IDs, parents, and depth, but voice direct workflow calls do not create an agent invocation. `partner_calls` is not consistently populated, nested tool failure may not fail the parent invocation, and no trace currently links Vapi ingress through agent/workflow/Action Engine/provider.

### 10. Test baseline drift

Focused verification before planning produced 64 passing and 5 failing tests:

- 50/50 multi-agent delegation tests passed.
- Four Vapi/Action Engine tests use stale mocks that do not implement `.maybeSingle()` after the resolver changed.
- One Action Engine case timed out after Redis errors, showing an unintended external dependency in the focused baseline.
- The existing claimed latency integration coverage is theoretical rather than a real timed recursive agent-to-tool execution.

## Target Agent Graph for Cuts & Culture

```text
Entry Orchestrator
  -> Services Specialist       (read catalog/descriptions)
  -> Pricing Specialist        (read/calculate quotes)
  -> Availability Specialist   (read staff and slots)
  -> Customer Specialist       (lookup/prepare customer data)
  -> Booking Specialist        (only holder of booking write capabilities)
```

The graph is tenant configuration, not a platform seed. The same specialist agent IDs are reused by widget and voice; channel overrides tune behavior.

## Target Runtime Shape

```text
Vapi / Widget / WhatsApp / other channel
  -> channel adapter
  -> trusted Agent Invocation Gateway
  -> direct specialist for explicit intent OR entry orchestrator for ambiguity
  -> authorized specialist graph
  -> unified workflow runtime
  -> Action Engine
  -> tenant provider such as Xkedule
  -> typed result
  -> response owner/channel adapter
```

The gateway envelope must include server-resolved organization and agent identity, channel, external interaction ID, actor/contact, locale, current message or explicit intent, trace/correlation ID, and stable ingress idempotency key. Caller or model arguments cannot override trusted identity fields.

## Delivery Roadmap

The workstream roadmap owns 32 requirements with 32/32 mapped exactly once:

1. **Phase 131 — Trusted Omnichannel Invocation Foundation:** typed gateway, `voice` channel, Vapi entry-agent binding, tenant trust boundary, repaired baseline.
2. **Phase 132 — Authorized Specialist Orchestration:** routing, typed results/handoffs, capability-edge authorization, scoped knowledge, OpenRouter consolidation.
3. **Phase 133 — Idempotent Action and Vapi Safety:** mutation idempotency, latency budgets, multi-call handling, timeout ownership, always-200 integration.
4. **Phase 134 — Traceability and Reversible Routing:** complete traces, correct nested status, per-channel legacy/specialist switches and rollback.
5. **Phase 135 — Release Verification and Hardening:** security, tenancy, provider, timed p95, build, workflow, and UAT gates.
6. **Phase 136 — Cuts & Culture Canary Rollout:** configure the tenant graph, share specialists across voice/widget, execute live availability and idempotent booking canary.

## Phase 131 Locked Boundary

Phase 131 may change additive schema, shared runtime contracts/resolvers, channel registries, and tests. It must not:

- switch production `/api/vapi/tools` to agent execution;
- redesign partner authorization;
- change Xkedule mutation behavior;
- configure Cuts & Culture agents;
- replace the Action Engine;
- add a required UI.

The intended schema addition is nullable `assistant_mappings.entry_agent_id`, with a same-organization invariant and no production backfill. Existing null mappings preserve legacy behavior.

## Relevant Source Files

- `src/app/api/vapi/tools/route.ts` — current latency-sensitive Vapi path.
- `src/lib/vapi/end-of-call.ts` — trusted assistant/number tenant resolution.
- `src/lib/vapi/sync-assistants.ts` — mapping synchronization.
- `src/lib/agent-runtime/run-agent.ts` — shared agent runtime and partner delegation.
- `src/lib/agent-runtime/types.ts` — runtime contracts.
- `src/lib/agent-runtime/resolve-agent.ts` — channel overrides and KB scope loading.
- `src/lib/agent-runtime/build-workflow-tools.ts` — current chain-intersection authorization.
- `src/lib/action-engine/execute-action.ts` — authoritative provider executor.
- `src/lib/xkedule/client.ts` — provider timeout behavior.
- `src/lib/agents/channels.ts` and `src/lib/agents/zod-schemas.ts` — channel configuration.
- `src/types/database.ts` — database type projection.
- `supabase/migrations/001_foundation.sql`, `034_agents.sql`, `036_agent_channel_defaults.sql` — schema patterns.
- `tests/action-engine.test.ts`, `tests/vapi-call-events.test.ts`, `tests/agent-runtime-integration.test.ts`, `tests/agent-delegation.test.ts` — primary regression surfaces.

## Verification Targets

- Existing Vapi always-200 behavior remains unchanged through Phase 131.
- Same agent can be invoked with `web_widget` and `voice` contexts in isolated tests.
- Vapi tool arguments cannot override trusted organization or agent IDs.
- Assistant mapping cannot reference an entry agent from another organization.
- Null entry-agent mapping preserves legacy routing.
- Focused baseline is deterministic without live Redis.
- Later release gate: realistic Vapi -> specialist -> tool p95 at or below 5 seconds under a documented test profile.
- Later canary gate: widget and live Vapi both use the same Availability specialist and a booking replay executes only once.

## Operational Constraints

- Keep `/api/vapi/*` on Node.js.
- Always return HTTP 200 to Vapi unless product requirements explicitly change.
- Use `https://xphere.app` for public Vapi/webhook targets.
- Keep non-essential work deferred from the Vapi response path.
- Enforce tenant isolation with RLS for authenticated flows and explicit trusted organization scope for service-role webhook paths.
- Never log plaintext provider credentials.
- Add new numbered migrations; never rewrite migration history.
- Preserve user and tenant workflows; do not install Cuts-specific configuration globally.

