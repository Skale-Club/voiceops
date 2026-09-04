---
phase: 135-release-verification-and-hardening
status: ready_for_detailed_planning
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 135 Context — Release Verification and Hardening

## Goal

The complete omnichannel orchestration path satisfies its security, provider,
idempotency, latency, build, workflow, and human-validation gates before any specialist
routing is enabled for production traffic.

## Requirements

TEST-02, TEST-03, TEST-04.

## What This Phase Is Not

It is not a second round of feature work. Phases 131-134 built the behavior; this phase
proves it, in one place, repeatably, and makes the proof a gate rather than an activity
someone remembers to perform.

## Existing Foundation to Reuse

TEST-02 names seven areas. Six already have real coverage — the work is aggregation and
gap-filling, not writing them again:

| TEST-02 area | Existing coverage |
|---|---|
| Tenant isolation | `agent-partner-edge-authz` (cross-org denial, composite same-org FKs), `agent-schema-rls-smoke`, `security-secdef-isolation` |
| Direct versus delegated authorization | `agent-delegation` GATE-04, rewritten in Phase 132 to the edge model, 11 denial cases |
| Cross-agent calls | `agent-delegation`, `agent-partner-edge-authz` |
| Cycle and depth limits | `agent-delegation` (`delegation_cycle`, `delegation_depth_exceeded`, per-edge and global) |
| Handoff injection resistance | `agent-handoff-contract`, 41 tests including nested arrays, prototype pollution, anchored-match false positives |
| OpenRouter-only generation | `openrouter-provider-policy`, construction-not-import drift guard |
| Xkedule idempotency | `idempotency-ingress-key`, `vapi-tools-idempotency`, and `agent-delegation`'s action-set pins — **see the gap below** |

## Confirmed Gaps

Verified against source, per the standing rule for this workstream.

### The Xkedule idempotency gap was real and is now closed

`xkedule_create_booking`, `xkedule_cancel_booking` and `xkedule_reschedule_booking` were
absent from `SIDE_EFFECTING_ACTIONS`, so `requiresIdempotency()` returned false for them
at every call site. Every piece of Phase 133's machinery was correct, and the Xkedule
booking mutations walked straight past it — a Vapi retry created a second booking.

Fixed in `d0a162bf` while preparing this phase, with the five Xkedule reads pinned as
deliberately excluded. Phase 133's verification document carries the correction.

The lesson shapes this phase: Phase 133 tested the guard's behavior thoroughly and never
tested which action types reach it. A release gate must assert **coverage**, not only
mechanism.

### No timed integration test exists

Nothing in `tests/` measures latency. `agent-runtime-integration.test.ts` is functional.
TEST-03 needs a realistic timed path — Vapi ingress through specialist to tool result —
with a p95 target of 5 seconds and, critically, a **documented test profile**, since a
p95 without a stated profile is not a reproducible claim. Decide and write down what is
mocked, what is real, how many iterations, and on what hardware assumption.

### No automated release gate

`.github/workflows/` has fifteen workflows and **none of them run the test suite**.
`build-deploy.yml` goes straight from build to deploy. So TEST-04's "build, focused
suites, workflow validation, and UAT checklist pass before enabling" is today entirely
manual and unenforced.

Note the constraint that shapes the design: the full suite has 30 pre-existing failing
files driven by live-database dependencies and module-resolution gaps, so a gate cannot
simply run `npm test`. It must run a named, deterministic subset that is expected to be
green at all times, and fail loudly if any member of that subset regresses.

`npm run workflows:validate` already exists and must be part of the gate.

### No UAT checklist

TEST-04 requires a documented voice and text UAT checklist. None exists. It must be
executable by a human without reading the codebase, and must cover both channels
reaching the same specialist.

## Locked Decisions

- The release gate runs a named deterministic subset, never the full suite. Membership
  is explicit and reviewed, not inferred by glob.
- A gate that cannot fail is not a gate: the subset must be wired somewhere that blocks,
  and its failure must be loud.
- The p95 claim is only meaningful with its profile written down beside it.
- Coverage assertions belong next to mechanism assertions. Where a set drives a security
  or safety guard, pin the set.
- This phase enables nothing. It does not flip routing, apply a migration, or bind an
  assistant.

## Verification Focus

- Every TEST-02 area is asserted by a named suite that the gate actually runs, and the
  gate fails if any of them is removed or regresses.
- The action-type coverage of every safety-critical set is pinned, so the Xkedule class
  of gap cannot recur silently.
- The timed test produces a p95 figure against a written profile, and fails when the
  target is missed rather than merely reporting.
- `npm run build` and `npm run workflows:validate` are part of the gate.
- The UAT checklist is followable by someone who has not read this repository.
- The gate is green at HEAD, and the pre-existing 30-file baseline is untouched by it.

## Human/Production Boundary

Migration files may be authored and tested but must not be applied. Do not bind or
activate a real Vapi assistant, do not change tenant agents, do not execute a live
booking, and do not enable specialist routing for any organization. Phase 136 owns the
canary, and even there the activation itself is a human gate.

## Known Environment Traps

- Full suite fails 30-32 files / 52-53 tests for unrelated reasons; membership beyond
  the core 30 shifts between runs. Check any newcomer in isolation.
- Production build needs `NODE_OPTIONS=--max-old-space-size=8192`.
- Never junction `node_modules` into a git worktree.
