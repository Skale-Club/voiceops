---
phase: 132-authorized-specialist-orchestration
status: draft_for_planner_review
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 132 Execution Outline

This is a handoff-ready draft, not yet a checker-approved set of GSD PLAN files. The next AI should convert each slice into an executable plan with exact `read_first`, files, tests, and acceptance criteria before implementation.

## Proposed Wave Structure

### Wave 1 — 132-01: Typed handoff and result contracts

Requirements: ROUT-01, ROUT-04, ROUT-05, KNOW-02.

Primary files:

- `src/lib/agent-runtime/types.ts`
- new `src/lib/agent-runtime/handoff.ts`
- `src/lib/agent-runtime/run-agent.ts`
- `tests/agent-delegation.test.ts`
- new `tests/agent-handoff-contract.test.ts`

Deliver an allow-listed handoff input schema and typed specialist output union. Sanitize recursively through objects and arrays. Reject identity, role/instruction, credential/secret/token/API-key, runtime-control, and prototype-pollution keys. Preserve exactly one response owner. Start with pure contract functions and tests before touching recursive execution.

### Wave 1 — 132-02: Tenant-safe capability edges and budget model

Requirements: ROUT-03, AUTHZ-01, AUTHZ-02, AUTHZ-03.

Primary files:

- new append-only migration `1291_*`
- `src/types/database.ts`
- agent partner server actions/forms that create or update edges
- new `src/lib/agent-runtime/resolve-partner-edge.ts`
- schema/RLS/authorization tests

Add same-organization composite constraints for both endpoints of `agent_partners`. Model explicit edge channels and delegated workflow/capability allow-list plus call/time/depth budgets. Prefer normalized relational grants when referential tenant safety cannot be guaranteed with arrays. Define legacy defaults conservatively and document migration compatibility. Do not apply the migration.

### Wave 2 — 132-03: Replace ancestor intersection with edge authorization

Depends on: 132-01, 132-02. Requirements: ROUT-01..05, AUTHZ-01..03.

Primary files:

- `src/lib/agent-runtime/run-agent.ts`
- `src/lib/agent-runtime/build-workflow-tools.ts`
- `src/lib/agent-runtime/resolve-agent-tool.ts`
- `src/lib/agent-runtime/guardrails.ts`
- `tests/agent-delegation.test.ts`
- `tests/agent-workflow-tools.test.ts`

Centralize a preflight decision that checks tenant, active target, channel, cycle, depth, call count, time budget, specialist direct grant, and current edge delegated grant before model/action execution. Remove ancestor direct-tool intersection only after new denial tests are red. Propagate typed results and shared trace/parent IDs. Do not let the orchestrator directly execute specialist-only workflows.

### Wave 2 — 132-04: Enforce knowledge scope

Depends on: 132-01. Requirements: KNOW-01, KNOW-02.

Primary files:

- `src/lib/knowledge/query-knowledge.ts`
- `src/lib/agent-runtime/run-agent.ts`
- `src/lib/agent-runtime/resolve-agent.ts`
- knowledge/runtime tests

Implement `null` full-org, `[]` disabled, and non-empty restricted scope semantics. Filter with organization ownership at the query boundary, not after retrieval. Apply the same path in blocking and streaming execution and prohibit handoff overrides.

### Wave 3 — 132-05: Trusted direct-specialist routing

Depends on: 132-01..03. Requirements: ROUT-02, ROUT-04.

Primary files:

- `src/lib/agent-runtime/invocation-gateway.ts`
- new intent/specialist route resolver
- trusted assistant/tool mapping schema decided during detailed planning
- isolated routing tests

Resolve explicit function/intent mappings server-side and invoke the specialist directly through `invokeAgent()`. Ambiguous text continues to the configured entry orchestrator. This plan should create the reusable resolver and tests only; production `/api/vapi/tools` cutover remains Phase 133/134 gated.

### Wave 3 — 132-06: OpenRouter consolidation and drift guard

Requirements: MODEL-01, MODEL-02.

Primary files:

- new centralized server-side OpenRouter provider factory
- direct generative call sites inventoried in `132-CONTEXT.md`
- provider policy tests/static scan
- embedding ownership documentation

Move all Xphere-owned generative model calls behind tenant-OpenRouter-then-platform-OpenRouter resolution. Remove Anthropic generation fallback and misleading errors. Keep OpenAI-compatible SDK usage only when its base URL is OpenRouter. Explicitly allow documented embedding modules without changing vector dimensions or triggering reindexing.

## Phase Gate

Run focused contract, delegation, workflow-tool, knowledge, provider-policy, gateway, Action Engine, and Vapi suites together. Then run the production build with:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run build
```

Verify by search that no production Vapi route has been cut over and that migration 1291 is unapplied. Produce one summary per plan and `132-VERIFICATION.md` before marking Phase 132 requirements complete.

## Planning Risks to Resolve Before Coding

- Decide normalized edge-capability schema and legacy-edge default behavior.
- Decide how a trusted explicit intent maps to a specialist without coupling the platform to Vapi function names.
- Define one budget object shared by root and nested calls without duplicating mutable counters.
- Classify every direct provider call as generation, OpenRouter-compatible transport, or embeddings.
- Confirm how knowledge source IDs/scopes are represented in current tables before writing filters.
