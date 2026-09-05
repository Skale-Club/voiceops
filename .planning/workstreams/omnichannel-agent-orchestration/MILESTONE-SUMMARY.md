---
milestone: v3.5 Omnichannel Agent Orchestration
status: complete — one item remains on the human gate
completed: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# v3.5 Omnichannel Agent Orchestration — Milestone Summary

Nine phases, 33 plans, built and verified to their gates. 44 of 45 requirements are done;
SAFE-01 is partial and named below.

The milestone was planned as six phases. Phases 137-139 were opened afterwards — 137 because
voice and text were still two brains, 138 because a prompt that hardcodes “never ask for an
address” breaks the next tenant, and 139 because the mesh had been assembled by hand and could
not be duplicated. **A real appointment (booking #471) was created end to end through the mesh
on 2026-09-04**, which is what closed MESH-04 and ROLL-03 — the requirements no amount of
further code could have satisfied.

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

**137 — Shared Specialist Mesh.** Six specialists and seven edges, provisioned as rows rather
than described in a document, serving both voice and the widget from one set of definitions.
`/api/vapi/tools` can dispatch an explicit tool call to its mapped specialist behind the channel
routing mode, without adding a second inference to a live call. Only the Booking specialist holds
Xkedule write grants. Proven by a real booking against the real calendar.

**138 — Booking Modality.** `business_type` on the organization, set in `Settings → Company Info`,
seeding a `service_location_mode` of `on_premises` / `at_customer` / `either`. The engine renders
the modality into the prompt and transforms the `book_appointment` tool schema: for `at_customer`
the address is *structurally* required, so the model cannot call the tool without one; for
`on_premises` the field is deleted outright rather than left optional. An unrecognised mode fails
closed to the mode that does not ask. Migrations 1296 and 1297 applied; all 350 organizations
landed on the safe defaults with no backfill.

**139 — Agent Mesh as a Template.** An `agents` asset group inside the existing `org_templates`
mechanism: capture one tenant’s agents, prompts, tool grants, partner edges and channel defaults,
and install them into another, bound by `slug` and `tool_name` rather than by id. Install always
creates an active prompt version — the exact bug that left the first hand-provisioned mesh inert.
Prompts carry behaviour and render the tenant’s own facts. Plus the first outbound Vapi sync
(`pushAssistantConfig`), an operator surface for the routing mode, and an end-to-end proof that
crosses the capture seam into a different, empty target.

## The distinction that matters most

**Already on live paths.** Everything phases 132-134 put inside `runAgent` and the
`/api/vapi/tools` route: edge-based least privilege, `kb_scope`, `partner_calls`, denial
recording, redaction, and the idempotency guard. The widget chat route calls `runAgent`
directly, so it inherits all of it today.

**This changed in Phase 137, for one channel.** The widget now runs the mesh for real: booking
#471 went orchestrator → Booking specialist → Action Engine → Xkedule. `/api/vapi/tools:170`
consults `resolveChannelRoutingMode()` on the live voice path, and the agents page writes that
table, so the switch is both read by code and reachable by an operator — which is what retired
ROLL-02’s two named gaps.

**Voice remains on legacy routing.** Flipping it is a deliberate operator action and the runbook
still has the step. The Phase 131 gateway (`invokeAgent`) continues to have zero production
callers; the widget reaches `runAgent` directly.

## Seven defects found that no phase was looking for

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

**The mesh’s own booking path had no idempotency guard at all.** `build-workflow-tools.ts`
applied the guard only to workflows with `kind === 'flow'`, under a comment asserting that
`kind === 'tool'` went through `executeAction`, “which has its own guard”. It does not — and all
three Xkedule mutations are `kind='tool'`. So the path SAFE-02 exists to protect was the one path
it never covered. Found only by making a real booking.

**A slow write told the customer it had failed while it was succeeding.** The Xkedule client had
no per-call timeout; the booking took longer than the client’s patience, the turn aborted, and the
agent reported failure to a customer whose appointment had in fact been created. Fixed with an
explicit 30s write timeout, an abandoned-outcome record, and a completion finalizer that
distinguishes an aborted turn from an empty one.

**Three more on the 2026-09-05 re-analysis**, all on the same day the Vapi push first ran:

- Tokenising the live tenant's prompts (139-06, as designed) left the widget mesh introducing
  itself as “the front desk at {{business_name}}” for about an hour — install-time rendering
  covered a *target* org, nothing covered the *source* org whose rows had just become templates.
  `resolveAgent()` now renders tokens on every channel.
- The live `book_appointment` definition had no `customerAddress` field, so Phase 138’s rule was
  vacuous for this tenant and every template made from it. Field added (workflow version 2); the
  Vapi push now applies the same modality transform to schemas that the widget applies.
- The first push replaced every tool without its `server` block: for ninety minutes the phone
  robot’s tool calls had nowhere to go (no real call in the window). Routing restored with a 30s
  per-tool timeout; the pusher now carries routing through and refuses to push unrouted tools.

Seven occurrences of one pattern — a mechanism correct about what it renders and silent about
what it discards or never reaches — is not seven accidents. It is the argument for verifying a
change against what it replaced, not against its own output, and for testing which callers reach
a guard rather than only that the guard works. `FINDINGS-OUTSIDE-SCOPE.md` items 8 and 9 carry
the detail, including the measured widget latency trace and the ranked levers.

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
- **No tenant has actually been templated.** The capture → install pipeline is proven against
  in-memory fakes, which is the right place to prove it, and none of it substitutes for one real
  install through `Settings → Organization Templates`.

## Where to start

One human item, outward-facing, not code:

1. **Install the mesh into a real second organization** — `Settings → Organization Templates`,
   capture Cuts & Culture, install into the target. This is the difference between “the pipeline
   is correct” and “a second tenant is running”.

The Vapi push has been done once, from a dry-run-first script, on 2026-09-04. After any change
to the voice prompt or to `service_location_mode`, re-push from the kebab menu on the assistant
row — the dialog names the assistant and warns it may be answering a real phone number.

`docs/agents/canary-activation-runbook.md` remains the reference for flipping voice from legacy
to specialist routing: six ordered steps, each with a precondition, an exact action, an observable
signal, and an abort step.

Note: test booking **#471** (2026-09-08 10:30) is real and sits in the demo calendar.
