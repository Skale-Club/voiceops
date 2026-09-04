---
phase: 135-release-verification-and-hardening
status: verified
verified: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 135 Verification — Release Verification and Hardening

## Goal restated

The complete omnichannel orchestration path satisfies its security, provider,
idempotency, latency, build, workflow, and human-validation gates before any specialist
routing is enabled for production traffic.

## Commits

| Plan | Commit | Scope |
|------|--------|-------|
| docs | `423fe91a` | Context + three plans |
| — | `d0a162bf` | Xkedule booking mutations added to the idempotency guard |
| — | `711adfa0` | Migration 1295: cross-org leak fix + findings record |
| 135-01 | `ded9a6e9` | Release gate declaration + safety-critical coverage pins |
| 135-02 | `3e3def04` | p95 latency measurement against a written profile |
| 135-03 | `0ff28a3e` | CI workflow, gate documentation, UAT checklist |

## Verification focus from 135-CONTEXT.md

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | Every TEST-02 area is asserted by a suite the gate runs, and the gate fails if one is removed | PASS | Membership is explicit data in `scripts/release-gate.ts`; `tests/release-gate.test.ts` asserts every declared member exists on disk and every TEST-02 area maps to at least one member. |
| 2 | The coverage of safety-critical sets is pinned so the Xkedule class of gap cannot recur | PASS | `tests/coverage-pins.test.ts` parses the 48 `case` labels out of `execute-action.ts` rather than retyping them, and fails on any action type in no bucket. Verified by an actual red/green cycle. |
| 3 | The timed test produces a p95 against a written profile and fails when the target is missed | PASS | `docs/agents/latency-profile.md` was written before the test. Measured p95 across five runs: 1410, 1657, 1631, 1406, 1348 ms against a 5000 ms target. The failure path was verified by temporarily setting the target to 1 ms. |
| 4 | Build and workflow validation are part of the gate | PARTIAL, deliberately | `npm run workflows:validate` runs in the gate (33/33). `npm run build` is deliberately excluded — 8 GB heap, 10-30 minutes — and `build-deploy.yml` already builds on every push to main. The rationale is documented rather than the omission being silent. |
| 5 | The UAT checklist is followable by a non-author | PASS | 12 items, each with precondition, exact action, and observable result. |
| 6 | The gate is green at HEAD and does not disturb the baseline | PASS | `npm run release-gate` exits 0: 8 files, 206 tests, plus 33 workflow validations. |

## Two real defects found by building the gate

Building the gate was supposed to be bookkeeping. It found more than the four preceding
phases' own verification did, which is itself the argument for having built it.

### The Xkedule booking mutations were never guarded

`xkedule_create_booking`, `xkedule_cancel_booking` and `xkedule_reschedule_booking` were
absent from `SIDE_EFFECTING_ACTIONS`, so `requiresIdempotency()` returned false at every
call site. Phase 133 built the entire mechanism around the Xkedule mutation SAFE-02 names,
and the Xkedule mutation walked past it. A Vapi retry created a second booking.

Every Phase 133 test passed because every one tested the guard's behavior and none tested
which action types reach it. Fixed in `d0a162bf`; Phase 133's verification carries the
correction.

### A cross-organization data leak was hiding inside the "pre-existing baseline"

`get_org_member_profiles` is `SECURITY DEFINER`, joins `auth.users`, and filtered only on
`organization_id = p_org_id` — never on whether the caller belongs to that organization.
Any authenticated user could enumerate any organization's members, with email and phone.

`tests/security-secdef-isolation.test.ts` had been failing on exactly this case, inside the
30-file set this workstream carried as environmental noise from Phase 132 onward. It was
not noise. Fixed by migration `1295`, **applied 2026-09-04** on the user's explicit instruction. The
suite is green and back in the gate.

Both are recorded in `FINDINGS-OUTSIDE-SCOPE.md`, along with a third: 24 write action types
(email, WhatsApp, ManyChat, Telegram, Google Contacts, tasks, notes, the whole pipeline
surface) are still unclassified and structurally exposed to the same double-execution bug.
They were deliberately not fixed here — that change spans most of the product's integration
surface, the guard fails closed, and misclassifying an action that legitimately repeats
would suppress real work. They sit in a named, pinned bucket that fails the build if it
grows.

## What the gate deliberately does not cover

Stated in `docs/agents/release-gate.md` rather than left implicit:

- The ~30-file live-database and module-resolution baseline. `npm test` is never run whole.
- ~~`tests/security-secdef-isolation.test.ts`~~ — was excluded while red on the leak above;
  1295 is applied and the suite is a gate member again.
- The 24 unclassified write action types.
- `npm run build`, with its rationale.

## Honesty note on the latency claim

The p95 figure measures **orchestration overhead**, not end-to-end wall time against live
vendors. Three simulated boundaries carry injected latencies — Supabase round trips at
30 ms, the specialist model turn at 900 ms, the Xkedule vendor call at 300 ms — and every
one is labelled in the profile document as an assumption with a stated rationale, not as a
measurement. The document says plainly what it does not prove: network transit to Vapi,
real model inference, real provider latency, and database performance under load.

Notably, the profile deliberately does not reuse the 5.1 s cold-cache figure that
`xkedule/client.ts` documents in its own comment, because that number describes the
pathological case which justified a 15 s timeout, not the warm simple-lookup scenario this
profile defines.

## Production boundary — held

- Migrations 1290-1295 were authored during this phase and **applied on 2026-09-04**, after
  the phase closed, on the user's explicit instruction.
- The CI gate does not touch `build-deploy.yml`; the live deploy path is unchanged.
- Nothing was enabled, bound, flipped, or cut over.
