---
phase: 136-cuts-and-culture-canary-rollout
plan: 03
subsystem: docs
tags: [runbook, canary, human-gate]
requirements-completed: [ROLL-03]
key-files:
  created: [docs/agents/canary-activation-runbook.md]
completed: 2026-09-03
note: >
  Backfilled 2026-09-04 from 136-03-PLAN.md and commit 785b0726 — this summary
  was never written when the plan executed.
---

# Phase 136 Plan 03: Write the canary activation runbook and its human gate — Summary

**`docs/agents/canary-activation-runbook.md` (366 lines): the ordered, abort-annotated,
human-only sequence that takes the canary live — and the discovery, disclosed in the
runbook itself, that flipping a routing row changes nothing until an ingress route is
rewired to call it.**

## Outcome

Landed in a single commit, `785b0726`. The runbook orders the production sequence: apply
migrations 1290-1294 (later 1295 was added as an independent security fix, noted in the
runbook); dry-run then apply the 136-02 provisioning script; bind the Vapi assistant; wire
an ingress route to `invokeAgentWithChannelRouting` (called out as **Step 5.0**, not
previously done by any prior plan); flip voice routing, observe, then widget routing; place
one real booking and follow its trace end to end. Every step states precondition, exact
command, observable success signal, and an abort step that reverses only that step.

The runbook states plainly, in its own words, that `invokeAgent`/
`invokeAgentWithChannelRouting` had no production callers at the time it was written, so
flipping a routing row alone would change nothing until Step 5.0 shipped as its own
PR/CI/deploy cycle — this is the finding that both `136-VERIFICATION.md` and the later
independent verification single out as the most consequential in the phase.

Closes with the proven-by-test vs. unproven-until-live split for ROLL-03: graph shape,
the only-Booking-writes grant, the shared Availability specialist, legacy-by-default
routing, and idempotent booking mutations are proven by test in-repo; a real widget and a
real Vapi interaction reaching the same specialist in production, and a real booking
completing idempotently with a complete trace, remain unproven until the canary actually
runs.

## Files Modified

- `docs/agents/canary-activation-runbook.md` — new, 366 lines

## Verification

`test -f docs/agents/canary-activation-runbook.md` (plan's own verify command; content
verified by review against 136-CONTEXT.md's human/production boundary and the Phase 135
UAT checklist it references rather than duplicates).

## Deviations from Plan

None recorded against this plan's own scope. Documenting Step 5.0 was not itself a
deviation — the plan's Task 1 already anticipated "flip the voice routing mode ... and
observe" as a step requiring a prior ingress wiring change; the runbook made that
prerequisite explicit rather than assuming it.

## What This Plan Did Not Establish (see later phases)

ROLL-03 remained blocked when this plan closed, and — per the explicit scope of this
backfill task — still is: no booking has ever been created, by voice or by chat;
availability was only ever read. What did change in a later phase: commit `b693602e`
(plan 137-02) shipped Step 5.0 for the voice ingress route (`/api/vapi/tools`, gated behind
the same routing mode), and `agent_channel_defaults.web_widget` was pointed at
`cc-entry-orchestrator` in production, so the widget channel now runs on the mesh live.
Voice routing itself is still `legacy`. See `136-VERIFICATION.md`'s "Update 2026-09-04"
section for the current state and what remains unproven.

## Self-Check: PASSED

- `docs/agents/canary-activation-runbook.md` — FOUND
- Commit `785b0726` — FOUND in `git log --oneline --all`
