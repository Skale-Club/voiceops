---
phase: 136-cuts-and-culture-canary-rollout
status: verified_to_the_human_gate
verified: 2026-09-03
updated: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 136 Verification — Cuts & Culture Canary Rollout

## Status is deliberately not "verified"

ROLL-03 says a **live** canary proves the shared specialist and a **real** booking
completes. Neither has happened. What is verified is everything up to the human gate:
the graph, its isolation, the routing switch, the provisioning path, and the runbook.
Marking this phase plainly "verified" would claim the canary ran. It did not.

## Commits

| Plan | Commit | Scope |
|------|--------|-------|
| docs | `bd532825` | Context + three plans |
| 136-01 | `a8e78e97` | `invokeAgentWithChannelRouting()` at the trusted boundary |
| 136-02 | `5e807969` | Provisioning script + shape tests (graph JSON landed in `ded6589c`) |
| 136-03 | `785b0726` | Activation runbook and its human gate |

## Verification focus from 136-CONTEXT.md

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | With no routing row, every channel resolves to legacy | PASS | Six fail-to-legacy cases tested: absent row, read error, unrecognised string, malformed value, explicit `legacy`, and specialist-mode-with-no-intent. Each asserts the untouched entry agent is used and the `agents` table is never queried. |
| 2 | Legacy behavior is byte-for-byte unchanged | PASS | A test calls `invokeAgent()` and `invokeAgentWithChannelRouting()` with a fixed trace and idempotency key and asserts full result equality. `invokeAgent`'s own body was not modified. |
| 3 | Channels move independently | PASS | Voice to specialist leaves widget on legacy, and the reverse. |
| 4 | The mode is resolved once per invocation | PASS | Asserted by counting table reads; `invokeInternalSpecialist` does not re-resolve, so in-turn delegation does not repeat the lookup. |
| 5 | The graph is the entry orchestrator plus five named specialists | PASS | One orchestrator, five specialists, five edges, eight Xkedule workflows (five read, three write). |
| 6 | Only Booking holds an Xkedule write grant | PASS | Proven twice, and the second proof is the one that matters: not by reading the JSON, but by joining `agent_partner_workflow_grants → workflows` and `→ agent_partners → agents` on the rows a mocked provisioning run actually writes, then asserting every write-tool grant belongs to the Booking agent and no other. |
| 7 | Voice and widget share one Availability specialist | PASS | Asserted by id against the provisioned rows: exactly one agent row with that slug, exactly one edge referencing it, `allowed_channels` covering both. |
| 8 | The script is dry-run by default and refuses a non-target org | PASS | No arguments performs zero network calls. `--apply` without `--org` throws before any call. Both paths re-check the organization's slug. `parseArgs` reads only argv — verified by polluting the environment and confirming no effect. |
| 9 | The platform seed path is untouched | PASS | The graph lives under `.planning/.../canary/`, never in `supabase/seeds/workflows/`. |
| 10 | Phases 131-135 stay green and the release gate passes | PASS | 104/104 across the phase's suites; `npm run release-gate` exit 0. |

## The fact that reframes the whole milestone (as it stood on 2026-09-03 — see Update below)

`invokeAgent` has **no production callers**. Verified by grep across `src/app`. This part
is still true today: the widget chat route (`src/app/api/chat/[token]/route.ts`) still
calls `runAgent()` directly, never `invokeAgent()`, and `src/lib/agent-runtime/index.ts`
still re-exports only `invokeAgent`, not `invokeAgentWithChannelRouting()`.

At the time this was written, `/api/vapi/tools` called `executeAction` directly with no
routing consultation at all, so `invokeAgentWithChannelRouting()` was not on any request
path and flipping a routing row changed nothing at all. **That specific claim is now
superseded for the voice ingress route** — see "Update 2026-09-04" below. It still holds
for the widget: the widget was never routed through this switch and is not routed through
it now either; the widget's mesh access (once it arrived) came from `runAgent`'s
pre-existing Phase 132 delegation plus real data, not from this switch.

This is not a defect — no phase was authorized to cut over — but it must not be misread.
The milestone splits cleanly:

**Already on live paths.** Everything Phases 132-134 put inside `runAgent` and the Vapi
tools route: edge-based least privilege, `kb_scope` enforcement, `partner_calls`, denial
recording, redaction before persistence, and the idempotency guard including the Xkedule
booking mutations. The widget uses `runAgent`, so it inherits all of it today.

**Beside the live paths, not in them (as of 2026-09-03).** The Phase 131 gateway, Phase 132
trusted specialist routing, and the Phase 134 channel routing switch. One of these three —
the routing switch itself, `resolveChannelRoutingMode()` — moved onto a live path the next
day; see the Update section. `invokeAgentWithChannelRouting()` specifically, the function
this phase's Plan 01 built, is still beside the live path: no route calls it by name, even
now.

The runbook therefore carried an explicit Step 5.0 — a human changes an ingress route to
consult the routing switch before any routing flip. That step has now happened for voice
(see Update below), by a route calling `resolveChannelRoutingMode()` and
`invokeInternalSpecialist()` directly rather than through the `invokeAgentWithChannelRouting()`
wrapper — a different shape than the runbook assumed, but the same switch, and it went
through its own PR/CI/deploy cycle as the runbook required.

## Provisioning was never run (as of 2026-09-03 — corrected below)

The script was exercised only through tests against an in-memory Supabase double. As of
this document's original writing it had never been invoked from a shell against any
organization, real or otherwise. **This is no longer true — see "Update 2026-09-04."**

## Attribution note

`canary/cuts-and-culture.json` was swept into commit `ded6589c` by my own broad `git add`
while the 136-02 agent still held it uncommitted. Content verified byte-identical to what
that plan produced; only the attribution is wrong. Second occurrence of this pattern in the
milestone — the first was `src/types/database.ts` between 134-01 and 134-02.

## Update 2026-09-04

Everything above this section is left as originally written, dated 2026-09-03, except for
the two inline corrections marked above. This section records what changed the next day,
in Phase 137, and why it does not move ROLL-03's grade.

**ROLL-01 is now done, not partial.** The independent verifier
(`136-INDEPENDENT-VERIFICATION.md`) correctly flagged that this document proved the graph's
shape and grant claims but never stated in so many words that "Cuts & Culture is
configured" was not yet true of any real organization — because the script had never been
run. On 2026-09-04, commit `ff075161` (plan 137-01) ran
`scripts/provision-canary-graph.ts --apply` against the real organization
`cuts-culture-barbershop` (`31502b7d-f4bd-4493-91f7-fc6f2738a09d`). The graph itself was
first reshaped to match the tenant's actual eight Xkedule tool names and six specialists
(the version this document verified above declared five specialists and five invented tool
names — that mismatch was found and fixed in the same commit, not by this phase).
Independently verified against the live tables afterward:

- 6 new specialist agents plus the untouched pre-existing generalist = 7 agents total.
- 7 partner edges, including the two specialist-to-specialist edges (Booking→Customer,
  Booking→Availability) — not a star topology.
- 10 edge grants, exactly 3 marked write, all three targeting `cc-booking-specialist`.
  No other agent holds a write grant, by edge or by direct ownership.
- Zero duplicate workflow rows — the script bound to the tenant's eight pre-existing
  workflows by `tool_name` instead of creating new ones.
- A second `--apply` run produced identical counts across every table, confirming the
  idempotency this phase's tests only proved against a mock.

`REQUIREMENTS.md` has already been updated (commit `09522eda`, outside this phase's scope)
to reflect ROLL-01 as done. This document is corrected to stop contradicting it.

**A debt this phase's script leaves behind, now visible.** `scripts/provision-canary-graph.ts`
does not create `agent_prompt_versions`. `resolveAgent()` refuses to load an agent with no
active prompt version, so the six agents this script provisions come up inert until someone
inserts prompt versions by hand — which is exactly what happened for this one tenant,
discovered only when Phase 137 tried to actually invoke the mesh live (not by this phase's
row-counting tests, which could not have caught it). A fresh run of this same script against
a second tenant today would reproduce the same six-unusable-agents outcome. Fixing the
script is out of this phase's scope; it is recorded here as debt this phase's artifact
still carries.

**The routing switch gained a real production caller — for voice tool calls, not for the
switch's own wrapper function.** Commit `b693602e` (plan 137-02) changed
`src/app/api/vapi/tools/route.ts` to resolve `resolveChannelRoutingMode()` once per request
and, in `specialist` mode, dispatch an explicit-intent READ tool call to its specialist
through `invokeInternalSpecialist()` (a Phase 133 function, not the
`invokeAgentWithChannelRouting()` wrapper this phase built — that wrapper still has zero
callers under `src/app` as of this update). Writes always keep the direct Action Engine
path regardless of mode, so the ingress-scoped idempotency guard remains the sole guarantee
against a double booking. This means flipping the voice routing row is no longer a no-op —
but the row is still set to `legacy` in production. Commit `92a375a7` found the provisioned
agents were inert (see the prompt-version debt above) before this could even be observed;
commits `cb5882eb`, `8a58cb3d`, `1c8ce4d0`, `abc3c4f3`, `3c7fd967`, `3150adc9`, and
`f41b021c` (plan 137-03) then hardened the mesh and the voice prompt against real phone
calls, all still with voice on `legacy`.

**The widget now runs on the mesh in production, by a different mechanism than the
switch.** `agent_channel_defaults.web_widget` was pointed at `cc-entry-orchestrator` after
137-01 provisioned it. The widget route was never touched — it still calls `runAgent()`
directly, unrelated to `resolveChannelRoutingMode()` or `invokeAgentWithChannelRouting()`.
It reaches the mesh because `runAgent()`'s own Phase 132 trusted-specialist delegation
(already a live path per the "already on live paths" list above) now has a real entry
orchestrator and real partner edges to delegate through, where before it had none. This is
data becoming real, not new wiring.

**ROLL-03 is still blocked, and this update does not change that.** No booking has ever
been created, by voice or by chat — availability was only ever read, per `137-03-PLAN.md`'s
own "what this plan does not claim" section. Voice routing is `legacy`. A live widget
interaction reaching a real specialist is now plausible in production but has not been
independently confirmed end-to-end with a full trace as ROLL-03 requires. The phase status
below stays `verified_to_the_human_gate`, not `verified`.

**The attribution note above still stands unmodified**: `canary/cuts-and-culture.json`
landing in commit `ded6589c` instead of `5e807969` was real and is unrelated to anything in
this update.

## Production boundary — held

Migrations 1290-1295 were **applied on 2026-09-04** on the user's explicit instruction —
the only production action taken in this milestone as of 2026-09-03's writing. Since then,
per the Update above, the user separately authorized: running the provisioning script with
`--apply` against `cuts-culture-barbershop`, wiring `/api/vapi/tools` to the routing switch,
and pointing `agent_channel_defaults.web_widget` at the entry orchestrator. No booking has
been placed. No other organization has been changed. Voice routing is still `legacy`.
