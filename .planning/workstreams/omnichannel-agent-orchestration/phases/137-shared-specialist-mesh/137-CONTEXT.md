---
phase: 137-shared-specialist-mesh
status: ready_for_execution
created: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 137 Context — Shared Specialist Mesh for Voice and Text

## Goal

Voice and text stop being two brains. Both enter the same Xphere agent mesh: an entry
orchestrator that delegates to specialists, specialists that can call each other under an
authorized graph, only Booking able to write to the calendar, every Xphere inference
through OpenRouter, and the Action Engine as the single executor.

This is the architecture the operator specified. Phases 131-136 built the platform
capability for it. This phase makes it real for Cuts & Culture and puts the Vapi route
through it.

## Measured facts that constrain the design

Measured against the live tenant on 2026-09-04, not assumed:

| Call | Latency |
|---|---|
| `list_services` | 0.7 - 1.9 s |
| `check_availability`, any staff | **6.5 - 8.3 s** |
| `check_availability`, `staffId` pinned | **4.5 s** |
| Same call repeated | no faster — there is no cache |
| Date range width | no effect — cost is per call |

`check_availability` alone blows the 5 s voice p95 target before any model runs. The
existing single agent already shows a 26 s median invocation and a 41 s maximum.

**This is the single most important design constraint in the phase**, and it is on the
Xkedule side, not ours. Stacking a specialist model call in front of every voice tool call
would make the demo worse, not better.

## The design that follows from it

Hybrid, as the operator's own analysis proposed:

- **Explicit intent** — the Vapi function name already identifies the domain
  (`check_availability`, `get_quote`, …) and the arguments are complete. Route straight to
  that domain's specialist without an orchestrator model call. One inference, not two.
- **Ambiguous request** — route to the entry orchestrator, which delegates.
- **Purely deterministic** — when a call carries everything the tool needs and no judgement
  is required, the specialist adds latency and no value. Keep the direct Action Engine path
  available and use it.
- Voice permits at most one internal specialist model call per turn (the Phase 133 channel
  ceiling already enforces this). Text may chain further.

## Existing foundation — reuse, do not rebuild

- `agent_partners` + `agent_partner_workflow_grants` (migration 1291, applied): typed edges
  with per-edge channel, budget and delegated-workflow grants.
- `resolvePartnerEdge()`: fail-closed preflight — org, active endpoints, channel, depth,
  call count, timeout, grants.
- `resolveEffectiveToolAuthority()`: specialist's own grant ∩ edge grant ∩ channel. The
  orchestrator does NOT need to own a specialist's tools. This was the operator's key
  objection to the old model and it is already fixed.
- `invokeAgent` / `invokeAgentWithChannelRouting` (Phases 131/136): the trusted boundary.
- `resolveSpecialistRoute()` (Phase 132): explicit intent → specialist, no router model call.
- Ingress-scoped idempotency keyed on `call.id` + `toolCall.id`, covering the three Xkedule
  booking mutations.
- `scripts/provision-canary-graph.ts`: dry-run-first, org-locked, idempotent, 22 tests.

## Tenant reality — verified from the live database

Organization `cuts-culture-barbershop`, id `31502b7d-f4bd-4493-91f7-fc6f2738a09d`.

Eight workflows already exist. **These are the real tool names** — an earlier revision of
the canary graph invented five that do not exist:

| tool_name | workflow id | access |
|---|---|---|
| `list_services` | `63949bef-aa86-438d-98c1-86765db2e932` | read |
| `business_info` | `d2ed7a95-369a-4b73-97a4-1b4e6d2170e7` | read |
| `get_quote` | `33583c25-8dfe-4ac7-8cba-409058c65df4` | read |
| `check_availability` | `a63f6e19-04ea-4a1d-96ed-cbef27bb04a6` | read |
| `lookup_customer` | `cc8aa58c-5ede-4860-976c-2363061e4176` | read |
| `book_appointment` | `cf1671ef-5d1e-4682-8ec4-3abe346260e3` | **write** |
| `reschedule_appointment` | `3f4c3760-7eb8-456b-8a8d-f180fd724b0c` | **write** |
| `cancel_appointment` | `cba0e6f1-1cb5-4bd9-9777-e3838cf30480` | **write** |

Also present: one generalist agent `cuts-culture-booking-agent-en` (`web_widget` only, all
eight tools attached); Vapi assistant `99518fa7-09f1-4c76-b7c8-58cd8a92105c` answering
`+1 (224) 551-6131` with the same eight tool names pointed at
`https://xphere.app/api/vapi/tools`; `assistant_mappings.entry_agent_id` **null**; zero
`agent_partners` rows; Xkedule and OpenRouter integrations active; a Vapi credential was
added on 2026-09-04, shared with Skale Club for cost-centre reasons.

## Locked decisions

- The existing generalist stays in place and active until the mesh is proven. It is the
  fallback for a live demo, and removing it before the mesh works would be reckless.
- Only Booking holds write grants — enforced by edge grants, asserted against provisioned
  rows, not against the JSON.
- Voice and text share the SAME specialist rows. No per-channel duplicates.
- Every Xphere inference goes through OpenRouter.
- The Action Engine remains the sole executor. Specialists reason; Xkedule is the source of
  truth for every price, slot and booking.
- No specialist may invent a fact a tool did not return.

## Verification focus

- The same Availability specialist row is reachable from voice and from the widget, by id.
- A specialist can call another specialist within the authorized graph, and cannot outside it.
- The orchestrator holds no direct write tool and can still cause a booking through Booking.
- Only Booking's edge carries write grants, proven against the rows a provisioning run writes.
- A Vapi tool call with an explicit intent reaches its specialist with ONE internal model call.
- The Vapi route still returns HTTP 200 on every path and stays idempotent.
- A real end-to-end run: Vapi ingress → agent → specialist → Action Engine → Xkedule, with
  one trace showing the whole tree.
- The release gate stays green.

## Production boundary

Provisioning writes to the live database for this demo tenant, which the operator has
authorized. Still forbidden without a further explicit instruction: deleting or deactivating
the existing generalist agent, changing any other organization, and cancelling or modifying
a real customer's existing appointment.
