---
phase: 134-traceability-and-reversible-routing
status: ready_for_detailed_planning
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 134 Context — Traceability and Reversible Routing

## Goal

Operators can follow one request across every orchestration and action boundary,
understand nested failures and costs, and move channels between legacy and specialist
routing without destroying configuration or history.

## Requirements

OBS-01, OBS-02, ROLL-02.

## Existing Foundation to Reuse

More of this is already built than the roadmap implies. Reuse it; do not rebuild.

- `agent_invocations` already carries `parent_invocation_id`, `trace_id`, `channel`,
  `depth`, `status`, `mode`, `tool_calls`, `partner_calls`, `tokens_in`, `tokens_out`,
  `cost_usd`, `model`, `duration_ms`, and `error_detail`.
- `src/lib/agent-runtime/invocations.ts` already opens an invocation row with the
  parent link and closes it with tokens, model, cost (joined through
  `agent_model_pricing`), duration, `tool_calls`, and `error_detail`.
- `src/lib/agent-runtime/observability.ts` already exposes
  `getInvocationDelegationTree()`, `getConversationDelegationTree()`,
  `InvocationTreeNode`, `getAgentInvocations()`, `getAgentMetrics()`, and
  `getOrgCostTicker()` — the read side of the tree exists.
- Phase 132 `resolveTrustedAgentRoute()` already resolves a trusted intent to a
  specialist. ROLL-02 needs the switch that decides whether a channel uses it, not a
  new resolver.

## Confirmed Gaps

Every claim below was grepped against current source. The planning-time inventories in
this workstream have been wrong twice, so nothing here is carried over on trust.

### `partner_calls` is a dead column

The column exists on `agent_invocations` and is named directly by OBS-02, but **nothing
in `src/lib/agent-runtime/` ever writes it** — zero references outside the generated
type. `finalizeInvocation()` updates `tool_calls` and never `partner_calls`. Delegation
is therefore invisible in the persisted record even though Phase 132 made it rich:
edges traversed, budgets spent, and denials all exist only in transient logs.

### The trace breaks at the workflow boundary

`workflow_runs` has `trigger_type`, `tool_name`, `vapi_call_id`, and `execution_ms` —
but **no `trace_id` and no `agent_invocation_id`**. `logToolRun()`'s input
(`ToolRunLogInput`) accepts no trace or invocation identifier either.

So OBS-01's chain is severable in exactly one place: an operator can follow channel
ingress → entry agent → specialist invocations through `agent_invocations`, and can see
that a workflow ran, but cannot join the two. `vapi_call_id` correlates only for voice,
and only for the legacy route. Closing this is the core of OBS-01.

### Denials and idempotency replays are logged but not recorded

Phases 132 and 133 added a large denial surface — partner-edge denial, direct-tool
denial, cycle, depth, disallowed channel, call-count, timeout, channel model-invocation
ceiling, idempotency conflict, and abandoned ownership. Every one of these currently
goes to `createLogger(...)` and nowhere else. None lands on the invocation row, so the
trace cannot answer "why did this stop?" — only "it stopped".

`error_detail` is written only when an `errorDetail` is present, which is not the same
thing as a denial: a denied call is a deliberate, successful refusal, not an error.

### No redaction contract on persisted text

`user_message` and `assistant_reply` persist raw text, and `tool_calls` persists raw
request payloads. OBS-02 requires that plaintext credentials and unnecessary personal
data are not recorded. There is no redaction step today. Note the existing precedent to
respect: `src/lib/crypto.ts` is a sensitive path whose format must not change — this is
about not *writing* secrets into observability rows, not about changing encryption.

### Reversible routing does not exist at all

Greenfield. `grep` for a routing switch finds only
`src/app/(dashboard)/calls/*-actions.ts`, whose `routing_mode` is an unrelated
call-handling setting (`browser` / `phone_forward`) and must not be overloaded.

ROLL-02 needs a per-channel legacy-versus-specialist selector that an operator can flip
independently per channel and roll back, where rollback deletes nothing — not agents,
not mappings, not workflows, not invocation history. The switch must be readable by the
ingress path without an extra model call, and default to legacy so no organization is
silently migrated.

## Locked Decisions

- Extend the existing invocation/observability tables and helpers; do not introduce a
  parallel tracing system.
- A denial is recorded as a denial, distinct from an error.
- Redaction happens before persistence, never as a display-time filter.
- Routing mode defaults to legacy for every organization and channel. Enabling
  specialist routing is always an explicit operator action.
- Rollback is non-destructive by construction: the switch changes which path reads the
  configuration, never the configuration itself.
- No production Vapi cutover, no `supabase db push`, no live booking in this phase.
  Migrations 1290 and 1291 stay unapplied; migrations authored here join them.

## Verification Focus

- One trace id joins channel ingress, entry agent, every nested specialist invocation,
  the workflow run, and the Action Engine execution — provably, in a test that walks the
  join rather than asserting the columns exist.
- A nested specialist failure is reflected in the parent invocation's status rather than
  being swallowed.
- `partner_calls` is populated with the edges actually traversed, their timing, and
  their outcome.
- Every denial class from Phases 132 and 133 is recorded with its reason and is
  distinguishable from an error.
- An idempotency replay is visible in the trace as a replay, not as a fresh execution.
- No credential material or unnecessary personal data reaches a persisted observability
  row; a test asserts this on realistic payloads.
- Switching a channel to specialist routing and back leaves agents, mappings, workflows,
  and prior invocation rows byte-identical.
- Voice and text switch independently — changing one does not move the other.
- Phase 131, 132 and 133 suites stay green.

## Human/Production Boundary

Migration files may be authored and tested but must not be applied. Do not bind or
activate a real Vapi assistant, do not change tenant agents, and do not execute a live
booking. Those gates remain in Phases 135-136.

## Known Environment Traps

- The full suite fails 30-32 files / 52-53 tests for unrelated reasons, and the set is
  not stable: members beyond the core 30 shift between runs and pass in isolation
  (Postgres `deadlock detected` in `calendar-rls`, a vitest SSR module-cycle in
  `demo-readonly`). Check any newcomer in isolation before calling it regression or
  noise.
- Production build needs `NODE_OPTIONS=--max-old-space-size=8192`.
- Never junction `node_modules` into a git worktree.
