---
phase: 133-idempotent-action-and-vapi-safety
status: ready_for_detailed_planning
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 133 Context — Idempotent Action and Vapi Safety

## Goal

Side-effecting specialist actions execute through the existing Action Engine exactly
once, and the latency-sensitive Vapi route stays lean, deterministic, traceably owned,
and HTTP-200-compatible under retries, multi-call payloads, timeouts, and failures.

## Requirements

SAFE-01, SAFE-02, PERF-01, PERF-02, PERF-03, OBS-03.

## Existing Foundation to Reuse

- `src/lib/agent-runtime/idempotency.ts` already ships the mechanism: the
  `tool_idempotency_keys` table (migration 038), `deriveIdempotencyKey()`,
  `requiresIdempotency()`, `checkIdempotency()`, `recordIdempotency()`,
  `hashToolArgs()`, and the `SIDE_EFFECTING_ACTIONS` / `COMMERCE_WRITE_ACTIONS` sets.
  **Do not build a second idempotency system.** This phase extends the origin of the
  key and widens where the guard is applied.
- `build-workflow-tools.ts` and `builtin-tools.ts` already call the guard around
  agent-driven tool execution.
- `src/lib/agent-runtime/invocation-gateway.ts` is the Phase 131 trusted boundary, and
  `resolveTrustedAgentRoute()` (Phase 132) is where a voice latency policy belongs.
- Phase 132 `resolvePartnerEdge()` already carries per-edge `max_calls_per_turn`,
  `max_depth`, and `timeout_ms`, and Phase 132 added a call/timeout budget shared
  across the whole invocation tree. PERF-01 should express the voice policy through
  that existing budget rather than inventing a parallel limiter.

## Confirmed Gaps

Every claim below was verified against current source, not inferred from the roadmap.

### The Vapi tool webhook has no idempotency at all

`src/app/api/vapi/tools/route.ts` calls `executeAction()` directly. It never touches
`checkIdempotency` or `recordIdempotency`. A Vapi retry, a duplicate delivery, or a
timeout followed by a retry therefore executes the same booking mutation twice. This is
the single most important gap in the phase (SAFE-02).

### The idempotency key is invocation-scoped, not ingress-scoped

`deriveIdempotencyKey(invocationId, toolCallIndex)` hashes a freshly generated
invocation id. On a retry a new invocation id is minted, so the derived key differs and
the guard cannot recognize the replay. The mechanism is correct; its inputs are not
stable across ingress retries.

The identifiers that actually survive a Vapi retry are `call.id` and `toolCall.id` from
the webhook payload. SAFE-01 needs a key derived from channel ingress identity and
propagated inward, keeping the current invocation-scoped derivation as the fallback for
paths that have no ingress identity (widget, campaigns, cron).

Preserve `hashToolArgs()` as a mismatch guard: a replayed key whose arguments differ is
a conflict, not a replay, and must not silently return the original result.

### Only the first tool call in a payload is executed

The route does `const toolCall = toolCallList[0]` and returns a single result. Every
additional call in a multi-call payload is silently dropped — Vapi receives no result
id for it and cannot distinguish "ignored" from "failed" (OBS-03). Either execute every
supported call with matching tool-call ids, or reject the shape deterministically with
a result per call. Silence is the one unacceptable outcome.

### Timeout reports completion without owning the work

The inner catch maps `AbortError` to `status: 'timeout'` and returns
`toolConfig.fallback_message` to the caller. The underlying provider request may still
be in flight. Nothing records that a side-effecting operation was abandoned mid-flight,
so later reconciliation cannot tell whether the booking landed (PERF-03). A timeout on
a side-effecting action must leave a traceable ownership record, and must not let a
subsequent retry treat the slot as free.

### No voice latency policy

PERF-01 requires that a normal voice lookup use at most one internal specialist model
invocation before deterministic tool execution, and that budget exhaustion return a
lean recoverable Vapi result. Nothing expresses this today. The legacy Vapi route runs
no agent at all; the gateway path has no channel-specific model-call ceiling. This is a
policy on the `voice` channel, not a Vapi-specific hack.

### PERF-02 is largely already satisfied — verify, do not rewrite

The route already declares `export const runtime = 'nodejs'`, returns HTTP 200 on every
handled and error path including the outer catch, and defers logging through `after()`.
What still needs checking: that payloads stay lean, and that first-party targets use the
canonical `https://xphere.app` origin. Treat PERF-02 as a verification and
regression-test task, not a rewrite. Do not restructure a working latency-sensitive
handler for style.

## Locked Decisions

- Action Engine remains the sole provider action executor.
- The existing `tool_idempotency_keys` table and helpers are extended, never replaced.
- A replay returns the original recorded result; a same-key/different-args request is a
  conflict and must fail loudly.
- Idempotency keys derive from trusted server-side ingress identity. Never accept a key,
  a call id, or a tool-call id supplied inside a handoff payload or model output.
- The Vapi tool webhook returns HTTP 200 on every path, without exception.
- Voice latency policy is a channel policy, expressed through the Phase 132 budget.
- No production Vapi cutover, no `supabase db push`, no live booking in this phase.
  Migrations 1290 and 1291 stay unapplied; any migration this phase authors joins them.

## Verification Focus

- A replayed Vapi tool call with the same `call.id` and `toolCall.id` executes the
  provider mutation once and returns the original result on the second delivery.
- The same key with different arguments is rejected as a conflict, not replayed.
- A multi-call Vapi payload returns one result per call with matching ids, or is
  rejected deterministically — never silently truncated to the first call.
- A timeout on a side-effecting action records traceable ownership and does not report
  success.
- Non-side-effecting reads are not slowed or blocked by the guard.
- Voice budget exhaustion returns a lean recoverable result rather than an error or a
  hang.
- The Vapi route still returns HTTP 200 on malformed JSON, failed schema parse,
  unresolvable org, unconfigured tool, executor throw, and unexpected outer error.
- Phase 131 and 132 suites stay green, and the pre-existing 30-file/52-test baseline
  failure set does not grow.

## Human/Production Boundary

Migration files may be authored and tested but must not be applied. Do not bind or
activate a real Vapi assistant, do not change tenant agents, and do not execute a live
booking. Those gates remain in Phases 135-136.

## Known Environment Traps

- Full suite baseline: 30 failing files / 52 failing tests, unrelated to this
  workstream. Do not attempt to fix them inside this phase.
- Production build needs `NODE_OPTIONS=--max-old-space-size=8192`.
- Never junction `node_modules` into a git worktree.
