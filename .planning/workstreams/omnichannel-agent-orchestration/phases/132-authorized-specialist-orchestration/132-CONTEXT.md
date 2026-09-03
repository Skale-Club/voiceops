---
phase: 132-authorized-specialist-orchestration
status: ready_for_detailed_planning
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 132 Context — Authorized Specialist Orchestration

## Goal

Turn the existing recursive partner-agent mechanism into a typed, tenant-safe, least-privilege specialist graph shared by voice and text. Explicit intents must be able to select a specialist without an extra router model call; ambiguous requests may use the entry orchestrator. Every Xphere-owned generative call must use OpenRouter.

## Requirements

ROUT-01..05, AUTHZ-01..03, KNOW-01..02, MODEL-01..02.

## Existing Foundation to Reuse

- `src/lib/agent-runtime/invocation-gateway.ts` is the trusted channel boundary completed in Phase 131.
- `agent_partners` already models directed agent-to-agent edges and is protected by organization RLS.
- `run-agent.ts` already exposes synthetic `call_partner_<slug>` tools, recursive blocking calls, parent invocation IDs, depth checks, visited-set cycle checks, and shared traces.
- `resolveAgentTool()` and `buildWorkflowTools()` already enforce each agent's own workflow/tool grants.
- `runAgent()` already resolves tenant OpenRouter first and platform OpenRouter second.
- `ResolvedAgent.kbScope` already exists, but both blocking and streaming runtime paths currently call `queryKnowledge(..., { rawMode: true })` without passing the scope.

## Confirmed Gaps

### Partner-edge tenancy and capability policy

`agent_partners.organization_id`, `agent_id`, and `partner_agent_id` are not tied by one composite same-organization constraint. RLS protects authenticated writes, but privileged/runtime paths still need a database invariant. The edge also has only `invocation_description`; it cannot express allowed channels, workflow capabilities, or per-edge call/time budgets.

### Authorization semantics

Both the legacy tool assembly in `run-agent.ts` and `build-workflow-tools.ts` require every ancestor in the delegation chain to own the specialist's workflow. This prevents escalation but forces the orchestrator to carry specialist tools. Replace it with:

```text
effective delegated authority
  = specialist's own direct workflow grants
  ∩ current partner edge's delegated workflow allow-list
  ∩ current channel policy
```

Ancestors retain permission to traverse their outgoing edge; they do not need direct ownership of the final workflow. Never broaden authority when an edge policy is absent: legacy edges should default to no delegated side effects until explicitly configured, while read-only partner response can remain available if the detailed plan proves compatibility.

### Handoff contract

The current partner tool accepts arbitrary objects and recursively rejects only keys matching `role`, `system`, or `instruction(s)`. It does not reject organization, agent, secret, credential, token, API-key, nested-array, prototype, or runtime-control overrides. Introduce an allow-listed schema and typed result union; do not stringify unrestricted model output into a privileged invocation.

### Response ownership

The current partner returns only a string. Add a typed specialist result with `success`, `business_failure`, `retryable_failure`, and `handoff` outcomes. The caller remains the sole response owner; specialist internal reasoning and raw provider errors must not reach the channel.

### Knowledge scope

`kb_scope` is loaded by `resolveAgent()` but ignored by runtime retrieval. Define three explicit states and test both blocking/streaming paths:

- `null`: full organization knowledge (legacy behavior);
- `[]`: disable automatic retrieval;
- non-empty IDs/scopes: filter retrieval to only those tenant-owned sources.

Do not accept knowledge scope from handoff payloads or channel metadata.

### Provider drift inventory

Agent generation is OpenRouter-only, but direct generative provider construction remains in at least:

- `src/app/api/email-templates/generate/route.ts`
- `src/app/api/ads/memories/extract/route.ts`
- `src/app/(dashboard)/workflows/flows/_actions/ai-build.ts`
- `src/lib/prospects/qualify-llm.ts`
- `src/lib/knowledge/query-knowledge.ts` synthesis path
- `src/lib/chat/stream/anthropic.ts`
- `src/app/(dashboard)/email-marketing/_actions/generate.ts`

OpenAI embedding construction in `src/lib/knowledge/query-knowledge.ts` and `src/lib/knowledge/embed.ts` is not automatically a violation: classify it explicitly as embedding infrastructure and do not change the embedding model without a compatibility/reindexing plan.

## Locked Decisions

- Vapi remains telephony/STT/TTS/live-conversation owner.
- Action Engine remains the sole provider action executor.
- Direct workflow/tool grants and partner-delegation grants are separate concepts.
- Explicit trusted intent routing must not require an orchestrator model call.
- Voice and text reuse the same agents and edges; channel restrictions live on policies.
- No production Vapi cutover, database push, or Cuts & Culture configuration in Phase 132.
- No unbounded dynamic agent creation. The graph is configured and auditable.
- A partner may call another partner only through the same authorization and budget checks.

## Verification Focus

- Cross-org edge insertion and invocation fail before model/action execution.
- Direct tool denial remains intact even if a delegation edge grants that capability.
- Delegated workflow succeeds only when the specialist owns it and the current edge permits it.
- Cycles, inactive agents, disallowed channels, call count, depth, and timeout budgets deny before model/action execution.
- Handoff injection tests cover nested objects and arrays plus identity, instruction, and secret keys.
- `kb_scope` is enforced identically in blocking and streaming paths.
- A static/provider-contract test prevents new direct generative Anthropic/OpenAI clients outside documented embedding exceptions.
- Existing delegation, agent runtime, workflow-tool, gateway, Action Engine, and Vapi baseline suites remain green.

## Human/Production Boundary

Migration files may be authored and tested, but must not be applied. Do not bind or activate a real Vapi assistant, change tenant agents, or execute a live booking. Those gates remain in Phases 135-136.
