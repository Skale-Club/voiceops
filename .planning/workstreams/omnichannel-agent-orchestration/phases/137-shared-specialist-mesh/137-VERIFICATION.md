---
phase: 137-shared-specialist-mesh
status: partially_verified_booking_unproven
verified: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 137 Verification — Shared Specialist Mesh for Voice and Text

## Status is deliberately not "verified"

`137-CONTEXT.md`'s own goal is a shared mesh that both channels use to complete real work.
No booking has ever been created through this mesh — by voice or by chat. The mesh reads
Xkedule data correctly and the widget dispatches through it, but the thing the phase exists
to prove (a caller or chat visitor gets an appointment on the calendar) has not happened.
Marking this "verified" would claim that. It has not run.

## Commits

Two planned commits, then six unplanned ones the same day, all against the same tenant:

| Plan | Commit | Scope |
|------|--------|-------|
| docs | `ec07620b` | Context + two plans, corrected tool names from an earlier revision |
| 137-01 | `ff075161` | Conform canary graph to the tenant; provision six agents, seven edges, direct tool grants |
| 137-02 | `b693602e` | `resolveSpecialistForTool()` + gated dispatch in `/api/vapi/tools` |
| 137-03 (retroactive) | `92a375a7` | Live probe finds the mesh inert (no prompt versions) and fixes it by hand |
| 137-03 (retroactive) | `cb5882eb` | Tighten specialist output; reject a faster model that hallucinated a slot |
| 137-03 (retroactive) | `8a58cb3d` | Redesign voice prompt after a conversational-failure call (zero tool calls) |
| 137-03 (retroactive) | `1c8ce4d0` | Discover service from caller's words; gate booking on price acceptance |
| 137-03 (retroactive) | `abc3c4f3` | Grant `list_services` directly to Availability/Pricing/Booking, 31.8s timeout to 28.4s |
| 137-03 (retroactive) | `3c7fd967` | Accept Vapi's real nested tool-call shape (first real call's tool calls silently failed) |
| 137-03 (retroactive) | `3150adc9` | Stop empty/aborted turns reporting success on both channels; gate the regressions |
| 137-03 (retroactive) | `f41b021c` | Vapi-native spoken lines while slow tools run; record full per-tool latency table |

`137-03-PLAN.md` documents the six unplanned commits as a retroactive plan. It was written
after the fact, from the commits themselves, because the work was real, tested, and shipped
but never had a plan of its own.

## Verification focus from 137-CONTEXT.md

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | Same Availability specialist reachable from voice and widget, by id | PARTIAL | The row exists once, `allowed_channels` covers both (proven in `137-01`'s test suite against the provisioned rows). But voice never calls it: routing mode for `voice` is `legacy` throughout the whole phase, so the shared row is reachable in principle, not exercised in fact, from the phone. |
| 2 | A specialist can call another within the authorized graph, not outside it | PASS | Booking→Customer and Booking→Availability edges provisioned and asserted (`ff075161`); `resolvePartnerEdge()` fail-closed checks (org, channel, depth, grants) are Phase 132/136 code, unmodified here, and this phase's tests exercise them against the real edge rows. |
| 3 | Orchestrator holds no direct write tool, still causes a booking through Booking | UNPROVEN | Grant isolation is proven (see #4). A booking caused *through the orchestrator* has never been run — no booking has been created via any path, widget or voice, in this phase. |
| 4 | Only Booking's edge carries write grants, proven against provisioned rows | PASS | `assertOnlyBookingHoldsWriteGrants` extended in `137-01` to check both edge grants and direct-ownership grants (a gap the original 136 assertion didn't need, since 136 had no direct grants). Live count: 10 edge grants (3 write, all on `cc-booking-specialist`) plus direct grants added in `abc3c4f3`; zero write grants outside Booking in either grant path. |
| 5 | Explicit-intent Vapi call reaches its specialist with ONE internal model call | LIVE-PROVEN ON WIDGET ONLY | `resolveSpecialistForTool()` + `invokeInternalSpecialist()` tested against mocks in `137-02`, then exercised live in `92a375a7`/`3150adc9`: widget probe took one delegation hop after the orchestrator-hands-named-service fix in `3150adc9`. Voice tool calls in this phase never take this path — `voice` stayed `legacy` end to end, so this focus is proven for the widget and not exercised for voice. |
| 6 | Vapi route returns HTTP 200 on every path and stays idempotent | PASS, WITH A REAL DEFECT FOUND AND FIXED FIRST | `3c7fd967` found and fixed a real production defect: the nested `toolCallList` shape Vapi actually sends was rejected by the flat-only schema, so the route silently returned `{results: []}` before logging — the HTTP 200 contract held, but the *content* was wrong and untraceable (zero `workflow_runs` rows). Proven fixed by a live post-deploy probe returning `results=1` with the correct `toolCallId` for three tool types. `3150adc9` separately closed a related gap: malformed argument strings had been decoding silently to `{}`, which could have executed a write with fields dropped; they now return a correlated error result. Idempotency guard itself (`call.id` + `toolCall.id`) is unchanged Phase 133 code and was pinned by regression tests through both fixes. |
| 7 | Real end-to-end run: Vapi ingress → agent → specialist → Action Engine → Xkedule, one trace | PARTIAL | Achieved on the **widget**: a live chat probe in `3150adc9` shows the orchestrator handing a named service straight to Availability and returning real slots in one hop, with `traceId`/`conversationId`/`sessionId` now propagated into the recursive call so the trace is actually followable (it was not, before that commit — child invocations carried unrelated trace ids). Not achieved on **voice**: voice runs `legacy` routing, so a phone call never enters the specialist mesh at all; it goes straight from Vapi to the Action Engine, the same as before this phase. |
| 8 | The release gate stays green | PASS | `226/226` deterministic tests, `33/33` workflow validations, exit 0, at HEAD (`d3c9eaa5`, one commit ahead of this phase's work — a docs-only backfill for unrelated phases). Manual probes (`tests/manual/*`, all the live-hitting tests this phase added) are deliberately excluded from the gate and opt-in via `npm run test:manual`, formalized in `3150adc9` after review found `tests/manual` had been reachable by the default Vitest glob. |

## What changed after the two planned commits

`137-01` and `137-02` shipped a mesh that passed every test against a mocked Supabase
double. Nothing in either plan's own verification called a live specialist. The retroactive
work in `137-03-PLAN.md` exists because doing that immediately surfaced two defects no
row-count or mocked-unit-test could have found:

1. **The provisioned agents were inert.** `scripts/provision-canary-graph.ts` never creates
   an `agent_prompt_version` row. `resolveAgent()` refuses an agent with no active prompt
   version, so all six agents `137-01` provisioned were unusable until fixed by hand for
   this one tenant. **The script itself is still not fixed** — see Production Boundary below.
2. **A real phone call exposed a payload-shape bug the mocked route tests never could,
   because the mocks used the flattened shape the tests were written against**, not the
   nested shape Vapi's live infrastructure actually sends. Fixed in `3c7fd967`, proven by a
   live post-deploy probe.

Two further rounds of real-world friction, both from actual phone calls, drove the prompt
redesign (`8a58cb3d`, `1c8ce4d0`) and the per-tool spoken-latency messages (`f41b021c`) —
none of which were anticipated by either plan, because neither plan modeled what an actual
caller does with an open microphone.

## The facts that reframe the phase's central design constraint

`check_availability` is the phase's own stated bottleneck (`137-CONTEXT.md`: "the single
most important design constraint"). Measured across this phase's work, cold-to-warm:

| Tool | Cold | Warm (<60s repeat) |
|---|---|---|
| `business_info` | 0.15–1.9s | — |
| `list_services` | 0.19–0.7s | — |
| `lookup_customer` | 1.5–2.1s | — |
| `get_quote` | ~2.0s | no warm effect observed |
| `check_availability` | **7.5–8.0s** | 0.14s |
| `check_availability` + `staffId` pinned | 4.5s | 0.15s |

Pre-warming seven days of availability in parallel cost 8.2s wall clock and **did not
persist** — re-asking each day afterward still cost ~7.5s (`f41b021c`). So the brief warm
window is not a cache the design can build on; the phase's chosen mitigation is spoken
reassurance during the wait, not a faster read.

A realistic booking conversation — lookup, services, quote, three different days checked —
spends **28s of tool time alone**, with no model inference and no write anywhere in that
figure. This is why the phase rejected a faster model (`google/gemini-2.5-flash-lite`,
606ms vs. haiku-4.5's 1393ms) after it invented a `09:15` slot no tool ever returned and,
separately, failed to call a tool at all — one correct run out of three (`cb5882eb`).
Specialists stayed on `claude-haiku-4.5` for the whole phase.

On the widget, through the mesh: a services question measured 18.7s, an availability
question 28.4s. After the orchestrator-hands-named-service fix (`3150adc9`, building on the
direct-grant fix in `abc3c4f3`), a live probe answered the same kind of question in 35s with
real slots (9:00, 2:15, 4:30) and one delegation hop instead of two. The mesh's advantage
over the pre-existing generalist (26s median) is structural — fewer wrong branches, a
traceable tree — not raw speed; nothing measured this phase shows the mesh answering faster
than the generalist it is meant to replace.

## Production boundary

Held, with one exception the operator explicitly authorized: provisioning wrote agents,
edges, and grants to the live Cuts & Culture organization (`31502b7d-…`), and later commits
patched the live Vapi assistant's prompt and tool messages by hand (Vapi has no inbound
sync from this repo — see Phase 138). No other organization was touched. The existing
generalist agent (`cuts-culture-booking-agent-en`) was never deactivated and remains the
demo fallback. No customer's real appointment was read, modified, or cancelled — every
`check_availability` call in every measurement above was a read; no `book_appointment`,
`reschedule_appointment`, or `cancel_appointment` call has ever executed against this
tenant, live or in a test that touches production, for the entire phase.

## What is NOT proven — read this before calling the phase done

- **No booking has ever been created**, by voice or by chat, at any point in this phase.
  Every measurement of `check_availability` above, live or in a probe, was a read.
- **Voice runs on `legacy` routing for the entire phase.** The mesh built in `137-01` and
  dispatched-to in `137-02` is live on the widget only. Every voice-channel focus item above
  is marked PARTIAL or unproven for exactly this reason, not because the code is untested —
  it is untested *on voice* because voice never took the path.
- **On voice, in specialist mode, write tools still bypass the Booking specialist** and go
  direct to the Action Engine (deliberate, per `137-02`'s summary, to keep the ingress-scoped
  idempotency key intact). So "only Booking writes" — verification focus #4 — is proven
  against the provisioned rows, but it only *bites in production* on the widget; a live
  voice write, if one ever runs, does not currently pass through Booking at all.
- **Only one real phone call has completed** since the credential fix that made calls
  possible at all, and it was a conversational failure: zero tool calls in three turns, an
  open-ended greeting, and agreement with mistranscribed caller input. That call is what
  drove the `8a58cb3d` prompt redesign. The payload-shape defect fixed in `3c7fd967` was
  found by a *second* real call (`01a06de4…`) whose tool calls both came back "No result
  returned"; no further real call has been placed and logged against the fixed code as of
  this verification.
- **`scripts/provision-canary-graph.ts` still does not create `agent_prompt_versions`.** The
  tenant's rows were inserted by hand after `92a375a7` found the gap. A fresh run of this
  script against any other tenant produces agents `resolveAgent()` will refuse. This is the
  single highest-priority piece of debt this phase leaves behind — it makes the mesh
  non-reusable outside this one hand-patched organization.

## Attribution note

`8a58cb3d`, `1c8ce4d0`, `abc3c4f3`, and `3c7fd967` carry `Co-Authored-By: Claude Fable 5.1`
rather than the Claude Opus 5 identity on the phase's other commits — a different agent
picked up the unplanned work partway through the day. Content and authorship are otherwise
as recorded in each commit; noted here only so the mixed trailer isn't mistaken for an error.
