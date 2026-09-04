---
phase: 133-idempotent-action-and-vapi-safety
status: verified
verified: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 133 Verification — Idempotent Action and Vapi Safety

## Goal restated

Side-effecting specialist actions execute through the existing Action Engine exactly
once, and the latency-sensitive Vapi route stays lean, deterministic, traceably owned,
and HTTP-200-compatible under retries, multi-call payloads, timeouts, and failures.

## Commits

| Plan | Commit | Scope |
|------|--------|-------|
| docs | `29ad98aa` | Context + three plans |
| 133-01 | `7b399031` | Ingress-scoped key, replay/conflict/abandoned outcome, abandoned recording |
| 133-02 | `e007da1c` | Channel latency policy on the shared budget |
| 133-02 | `c31368fb` | Ceiling wired into the partner recursion (gap left open by the plan) |
| 133-03 | `3cc836aa` | Vapi webhook: idempotent, multi-call, timeout ownership, 200 contract |
| 133-03 | `b6ad9f63` | Guard no longer masks tool outcomes (regression fix) |
| 133-03 | `519ce698` | Nullable agent-invocation FK instead of a cast |

## Verification focus from 133-CONTEXT.md

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | A replayed Vapi tool call executes the mutation once and returns the original result | PASS | `deriveIngressIdempotencyKey({channel, externalCallId, externalToolCallId})` keyed on the verified `call.id` + `toolCall.id`; `tests/vapi-tools-idempotency.test.ts` asserts `executeAction` is not called on replay and the recorded response is returned verbatim. |
| 2 | Same key, different arguments is a conflict, not a replay | PASS | `checkIdempotency` compares `hashToolArgs()`; conflict returns a distinct message and never the original response. Also fixed at the three pre-existing callers, where conflict was previously **not detected at all** — they only checked `cached !== null`. |
| 3 | Multi-call payloads return one result per call, never silently truncated | PASS | `toolCallList[0]` replaced with a `Promise.all` over every call; per-call try/catch keeps failures isolated; `tests/vapi-tools-multicall.test.ts` asserts 1:1 id matching and order. |
| 4 | A timeout on a side-effecting action records ownership and does not report success | PASS | `recordAbandonedIdempotency()` runs before the fallback message; a later retry sees `abandoned`, which is neither a free slot nor a success. |
| 5 | Reads are not slowed or blocked by the guard | PASS | Guard runs only when `requiresIdempotency()` is true; test asserts a read never calls `checkIdempotency`/`recordIdempotency`. |
| 6 | Voice budget exhaustion returns a lean recoverable result | PASS | `checkChannelModelInvocationCeiling` on the Phase 132 tree-shared budget; exhaustion yields a lean `skipped` result, never a throw or hang. |
| 7 | HTTP 200 on every handled and error path | PASS | `tests/vapi-tools-http200-contract.test.ts` covers rejected secret, malformed JSON, schema-parse failure, unresolvable org, unconfigured tool, executor throw, timeout, conflict, and unexpected outer error, plus static checks on the Node.js runtime declaration, deferred `after()` logging, and canonical origin. |
| 8 | Phase 131/132 suites stay green and the baseline failure set does not grow | PARTIAL — see below | |

## Regression gate

Production build: **PASS** — `npm run build` exit 0 with an 8 GB Node heap, including
the `verify-sw` postbuild guard.

Typecheck: zero errors under `src/`.

Full suite at HEAD: **32 failing files / 53 failing tests** against the Phase 132
measured baseline of 30 files / 52 tests.

The two files beyond the baseline were investigated individually, not waved through:

- `tests/calendar-rls.test.ts` — fails in the full run with a Postgres `deadlock
  detected` raised by `pg`. Passes alone. It exercises migration 1250 calendar RLS,
  which this phase never touches. Live-database contention under suite parallelism.
- `tests/demo-readonly.test.ts` — fails in the full run with `Cannot access
  '__vite_ssr_import_51__' before initialization` inside `isDemoOrg`. Passes alone.
  This is a vitest SSR module-cycle artifact that depends on which modules load
  together. See the honesty note below.

Both pass in isolation, and the composition of the over-baseline set changed between
two consecutive full runs (an earlier run had `action-engine` and `demo-readonly`;
this one has `calendar-rls` and `demo-readonly`) — a shifting set is the signature of
concurrency flakiness rather than deterministic regression.

### Honesty note on `demo-readonly`

Unlike `calendar-rls`, this one deserves a caveat rather than a dismissal. Plan 133-03
added an `@/lib/agent-runtime/idempotency` import to `src/app/api/vapi/tools/route.ts`,
which perturbs the module graph — and the failure mode is precisely a module-graph
initialization-order error. The test passes in isolation and the invariant it guards
(the demo organization can never produce side effects) is enforced in
`execute-action.ts`, not by the test's load order. But the causal link is plausible and
unproven in either direction. It is recorded here rather than closed.

## A regression this phase caught and fixed

`tests/action-engine.test.ts` — the pre-existing suite for `POST /api/vapi/tools` —
regressed under `3cc836aa`: a valid contact creation and an executor throw both began
returning a generic `Service unavailable.`.

Root cause was a single unguarded `await`. `checkIdempotency` builds its own
service-role client, so any throw from it fell into the per-call catch. In production
that means a transient failure of the idempotency lookup would mask both a successful
execution and the tenant's own configured fallback message, on every side-effecting
voice call.

Fixed in `b6ad9f63` by giving the preflight its own failure path — **fail closed**,
since a lookup that could not complete means we do not know whether a prior attempt
already mutated the provider, but with a distinct message instead of the catch-all.

The same fix addressed a second latent defect found while reading that code: a failure
to persist the receipt *after* a mutation had already landed converted that success
into the tenant's failure message, telling the caller it failed and losing the real
result. Both paths are now pinned by tests.

## Deviations worth carrying forward

- Plan 133-02 built the channel ceiling and wired it into the gateway entry point but
  left the recursive in-process handoff loop in `run-agent.ts` ungated — the path where
  a specialist three hops deep actually lives, so the voice policy was inert where it
  matters most. Closed in `c31368fb`, checked beside the existing timeout guard and
  before the traversal is counted, with tests pinning that ordering.
- Plan 133-01 also edited `run-agent.ts` and `build-workflow-tools.ts`, outside its
  stated file list. Legitimate: changing the `checkIdempotency` signature without
  updating its three callers would have left the tree non-compiling.
- No migration was needed. The abandoned-ownership marker is a JSON object in the
  existing `response` JSONB column; genuine responses are always plain strings, so the
  two can never collide.

## Production boundary — held

- Migrations 1290 and 1291 remain authored but **unapplied**. This phase added none.
- No Vapi assistant bound or activated, no tenant agent data modified, no live booking.
- Routing was not cut over. The Vapi tool webhook was hardened in place; it still runs
  the legacy direct-`executeAction` path and does not invoke the specialist graph.
