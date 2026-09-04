---
milestone: v3.5 Omnichannel Agent Orchestration
status: built — remaining work is on the human gate
completed: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# v3.5 Omnichannel Agent Orchestration — Milestone Summary

All six phases are built and verified to their gates. 31 of 32 requirements are done;
ROLL-03 cannot be satisfied without a live canary and is blocked on a human.

## Final gate

| Check | Result |
|---|---|
| Full suite | 30 failing files at the time of measurement — exactly the pre-existing baseline, zero beyond it. Applying migration 1295 afterwards turned `security-secdef-isolation` green, so the baseline is now 29. |
| Passing | 2898 |
| Release gate (`npm run release-gate`) | exit 0 — 8 suites, 206 tests, 33 workflow validations |
| Typecheck | zero errors under `src/` |
| Production build | exit 0, including the `verify-sw` postbuild guard |

## What each phase delivered

**131 — Trusted Omnichannel Invocation Foundation.** A shared gateway for voice and text,
with tenant and agent identity resolved server-side and protected against malicious
metadata. Added the voice channel and the Vapi assistant to entry-agent binding.

**132 — Authorized Specialist Orchestration.** Replaced the ancestor-intersection
authorization model with edge-based least privilege: effective authority is the
specialist's own grant, intersected with the current edge's grant and the channel policy.
Added typed handoff contracts with allow-listed fields, a typed specialist result union,
per-edge channel and budget policy with same-organization foreign keys, `kb_scope`
enforcement in both blocking and streaming paths, and centralized OpenRouter access with a
drift guard that fires on client construction rather than on imports.

**133 — Idempotent Action and Vapi Safety.** Ingress-scoped idempotency keys that survive a
channel retry, a discriminated replay/conflict/abandoned outcome, and a Vapi tool webhook
that no longer truncates multi-call payloads to the first call, records ownership when a
side-effecting action is abandoned mid-flight, and keeps HTTP 200 on every path. Plus a
voice latency ceiling counted on the shared invocation budget.

**134 — Traceability and Reversible Routing.** `partner_calls` went from a dead column to a
record of the delegation that actually happened. Every denial class from 132 and 133 is now
recorded as a denial rather than an error. Redaction runs before persistence. Workflow runs
carry the trace and invocation that caused them, and the view that had been discarding those
columns was fixed. A per-channel routing mode that defaults to legacy and rolls back without
destroying anything.

**135 — Release Verification and Hardening.** A named, deterministic release gate wired into
CI, coverage pins that derive action types from source so a new one fails until classified, a
p95 latency measurement against a written profile, and a UAT checklist a non-author can
execute.

**136 — Cuts & Culture Canary Rollout.** The routing switch consulted at the trusted
boundary with legacy still the default, the tenant graph declared outside the platform seed
path with only Booking holding Xkedule write grants, a dry-run-first provisioning script
that was never run, and an activation runbook with an abort step per stage.

## The distinction that matters most

**Already on live paths.** Everything phases 132-134 put inside `runAgent` and the
`/api/vapi/tools` route: edge-based least privilege, `kb_scope`, `partner_calls`, denial
recording, redaction, and the idempotency guard. The widget chat route calls `runAgent`
directly, so it inherits all of it today.

**Beside the live paths, not in them.** The Phase 131 gateway, Phase 132 specialist routing,
and the Phase 134 channel switch. `invokeAgent` has zero production callers. Flipping a
routing row today changes nothing — which is why the runbook has an explicit step for a
human to rewire an ingress route before any flip.

No phase was authorized to cut over, so this is by design. It is recorded prominently
because the checked boxes could otherwise be misread.

## Two defects found that no phase was looking for

**The Xkedule booking mutations never reached the idempotency guard.** Phase 133 built the
entire mechanism around the mutation SAFE-02 names, and `xkedule_create_booking` was absent
from `SIDE_EFFECTING_ACTIONS`, so a Vapi retry created a second booking. Every Phase 133 test
passed because each tested the guard's behavior and none tested which action types reach it.
Fixed in `d0a162bf`.

**A cross-organization data leak was hiding inside the "pre-existing baseline" — now fixed.**
`get_org_member_profiles` is `SECURITY DEFINER`, joins `auth.users`, and never checked
whether the caller belongs to the organization it was asked about — any authenticated user
could enumerate any organization's members with their emails and phones. The test had been
failing on exactly this case since before Phase 132, inside the 30-file set this workstream
treated as environmental noise. Fixed by migration 1295, applied 2026-09-04; the suite is
green and is a gate member again.

That second one changed how the baseline should be read: a stable set of failing tests is
where real defects hide. It was found only because Phase 135 forced an audit of what the
gate actually covers.

## Still open

- **The migration directory has drifted from production.** `get_org_member_profiles` was
  changed in the database without a migration in this repo — caught only because 1295
  collided with it. One function was reconciled; nothing else was audited. See
  `FINDINGS-OUTSIDE-SCOPE.md` item 3.
- **24 write action types are unclassified** — `send_whatsapp_message`, `send_email`, the
  pipeline surface and others bypass the idempotency guard the way Xkedule did. Deliberately
  not fixed autonomously: the change spans most of the product's integration surface and the
  guard fails closed, so a wrong classification suppresses real work. Pinned in a named
  bucket that fails the build if it grows. See `FINDINGS-OUTSIDE-SCOPE.md`.
- **ROLL-03 is unproven** and stays that way until the canary runs.

## Where to start

`docs/agents/canary-activation-runbook.md`. Six ordered steps, each with a precondition, an
exact action, an observable signal, and an abort step. Nothing in it has been performed.
