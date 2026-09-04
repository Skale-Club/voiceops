---
phase: 136-cuts-and-culture-canary-rollout
plan: 01
subsystem: agent-runtime
tags: [routing, feature-flag, vitest]
requirements-completed: [ROLL-02]
key-files:
  created: [tests/channel-routing-wiring.test.ts]
  modified: [src/lib/agent-runtime/invocation-gateway.ts, src/lib/agent-runtime/routing-mode.ts]
completed: 2026-09-03
note: >
  Backfilled 2026-09-04 from 136-01-PLAN.md and commit a8e78e97 — this summary
  was never written when the plan executed.
---

# Phase 136 Plan 01: Consult the routing mode at the trusted boundary — Summary

**`invokeAgentWithChannelRouting()` added to `invocation-gateway.ts`: resolves
`resolveChannelRoutingMode()` once per invocation and dispatches to `invokeAgent()`
unchanged on `legacy`, or through `resolveTrustedAgentRoute()` first on `specialist`.**

## Outcome

Plan objective was to make the Phase 134 routing switch (`resolveChannelRoutingMode()`)
actually gate something, while guaranteeing that merging it changes no organization's
behavior. Both tasks landed in a single commit, `a8e78e97`.

- Legacy branch is byte-for-byte `invokeAgent()`'s existing behavior — asserted by a test
  that calls both functions with a fixed trace/idempotency key and diffs the results.
- Specialist path is reachable only on an explicit `'specialist'` mode value. Absence, a
  read error, an unrecognised or malformed value, and an explicit `'legacy'` all take the
  same legacy branch — six fail-to-legacy cases asserted in
  `tests/channel-routing-wiring.test.ts`.
- Mode is resolved once per invocation (asserted by counting table reads), not re-resolved
  on internal delegation.
- Voice and widget channels move independently — flipping one leaves the other on legacy in
  both directions.
- Updated a stale comment in `routing-mode.ts` ("not wired into any live route yet") since
  it was no longer accurate at the library level.

## Files Modified

- `src/lib/agent-runtime/invocation-gateway.ts` — new `invokeAgentWithChannelRouting()`
- `src/lib/agent-runtime/routing-mode.ts` — comment update only
- `tests/channel-routing-wiring.test.ts` — new, 255 lines

## Verification

`npx vitest run tests/channel-routing-wiring.test.ts tests/agent-invocation-gateway.test.ts
tests/channel-routing-mode.test.ts tests/agent-delegation.test.ts` — all passing per
136-VERIFICATION.md's item-by-item table.

## Deviations from Plan

None recorded against this plan's own scope.

## What This Plan Did Not Establish (see later phase)

This plan wired the switch at the **library** boundary only. At the time this plan
executed, `invokeAgentWithChannelRouting()` had zero callers under `src/app` — no ingress
route consulted it, so flipping a routing row changed nothing in production. That gap
persisted through 136-VERIFICATION.md and was closed for the voice ingress route in a later
phase: commit `b693602e` (plan 137-02) gated `/api/vapi/tools` behind this same routing
mode. See `136-VERIFICATION.md`'s "Update 2026-09-04" section for the current state.

## Self-Check: PASSED

- `src/lib/agent-runtime/invocation-gateway.ts` — FOUND
- `src/lib/agent-runtime/routing-mode.ts` — FOUND
- `tests/channel-routing-wiring.test.ts` — FOUND
- Commit `a8e78e97` — FOUND in `git log --oneline --all`
