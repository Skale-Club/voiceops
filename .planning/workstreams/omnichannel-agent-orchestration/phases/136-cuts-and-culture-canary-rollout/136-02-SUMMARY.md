---
phase: 136-cuts-and-culture-canary-rollout
plan: 02
subsystem: agent-runtime
tags: [provisioning, canary, supabase, vitest]
requirements-completed: [ROLL-01]
key-files:
  created: [scripts/provision-canary-graph.ts, tests/canary-graph-shape.test.ts]
  modified: [.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json]
completed: 2026-09-03
note: >
  Backfilled 2026-09-04 from 136-02-PLAN.md and commit 5e807969 — this summary
  was never written when the plan executed.
---

# Phase 136 Plan 02: Declare the Cuts & Culture canary graph and its provisioning script — Summary

**Idempotent, dry-run-by-default `scripts/provision-canary-graph.ts` plus a tenant-scoped
`canary/cuts-and-culture.json` graph — entry orchestrator, five specialists, one shared
Availability specialist across voice and widget, Booking the sole Xkedule write grant —
proven by test against a mocked Supabase client, never run against a real organization.**

## Outcome

Landed in commit `5e807969`, 822 lines added across two new files
(`scripts/provision-canary-graph.ts`, `tests/canary-graph-shape.test.ts`). At this point the
graph had five specialists (Services, Pricing, Availability, Customer, Booking) rather than
the six the tenant actually has — that reshape came a full phase later, in 137-01.

- `scripts/provision-canary-graph.ts`: dry run by default; writing requires both `--apply`
  and an explicit `--org=<uuid>`; the script refuses to run against any organization other
  than the one named on the command line and re-validates the named org's slug against the
  graph's declared target before writing.
- `tests/canary-graph-shape.test.ts`: asserts graph shape, channel coverage, the single
  shared Availability specialist by id, and — against a mocked Supabase client, never a
  real organization — that only Booking ends up with an Xkedule write grant, that a dry
  run performs no writes, and that re-applying is a no-op.
- The graph lives under `.planning/.../canary/`, outside `supabase/seeds/workflows/`
  (platform defaults, validated in CI) — asserted by test, not just by placement.

## Attribution Note

`canary/cuts-and-culture.json` itself does not appear in this commit's diff. It had already
been committed with byte-identical content by a concurrent, unrelated commit —
`ded6589c` ("docs(135): verify release verification and hardening") — via a broad `git add`
sweep while this plan's agent still held the file uncommitted. Content was verified
byte-identical to what this plan produced; only the attribution is wrong. This is recorded
in the commit message itself and repeated in `136-VERIFICATION.md`.

## Verification

`npx vitest run tests/canary-graph-shape.test.ts` — passing (136-VERIFICATION.md records
22/22 once 137-01 later expanded the suite; the count at this plan's own commit was
smaller, scoped to five specialists and eight workflows rather than the six/eight the
tenant actually has).

## Deviations from Plan

None recorded against this plan's own scope. The graph shape drifted from "what the plan
declared" to "what the tenant actually has" in the very next phase (137-01: reshaped to six
specialists and the eight real Xkedule tool names, replacing five invented ones) — that is
a later plan's correction, not a deviation of this one.

## What This Plan Did Not Establish (see later phase)

The script was exercised only through tests against an in-memory Supabase double. It was
never invoked from a shell against any organization at the time this plan closed. That
changed in a later phase: commit `ff075161` (plan 137-01) ran it with `--apply` against the
real Cuts & Culture organization. See `136-VERIFICATION.md`'s "Update 2026-09-04" section.

## Self-Check: PASSED

- `scripts/provision-canary-graph.ts` — FOUND
- `tests/canary-graph-shape.test.ts` — FOUND
- `.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json` — FOUND
- Commit `5e807969` — FOUND in `git log --oneline --all`
- Commit `ded6589c` — FOUND in `git log --oneline --all`
