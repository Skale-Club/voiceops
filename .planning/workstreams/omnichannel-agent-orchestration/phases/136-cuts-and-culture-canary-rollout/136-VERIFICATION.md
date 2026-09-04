---
phase: 136-cuts-and-culture-canary-rollout
status: verified_to_the_human_gate
verified: 2026-09-03
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

## The fact that reframes the whole milestone

`invokeAgent` has **no production callers**. Verified by grep across `src/app`.

The live widget chat route calls `runAgent` directly, and `/api/vapi/tools` calls
`executeAction` directly. So `invokeAgentWithChannelRouting()` is not on any request path
either, and flipping a routing row today changes nothing at all.

This is not a defect — no phase was authorized to cut over — but it must not be misread.
The milestone splits cleanly:

**Already on live paths.** Everything Phases 132-134 put inside `runAgent` and the Vapi
tools route: edge-based least privilege, `kb_scope` enforcement, `partner_calls`, denial
recording, redaction before persistence, and the idempotency guard including the Xkedule
booking mutations. The widget uses `runAgent`, so it inherits all of it today.

**Beside the live paths, not in them.** The Phase 131 gateway, Phase 132 trusted specialist
routing, and the Phase 134 channel routing switch.

The runbook therefore carries an explicit Step 5.0 — a human changes an ingress route to
call `invokeAgentWithChannelRouting()` — before any routing flip. That is a code change
going through PR, CI and deploy, and no phase has made it.

## Provisioning was never run

The script was exercised only through tests against an in-memory Supabase double. It was
never invoked from a shell against any organization, real or otherwise.

## Attribution note

`canary/cuts-and-culture.json` was swept into commit `ded6589c` by my own broad `git add`
while the 136-02 agent still held it uncommitted. Content verified byte-identical to what
that plan produced; only the attribution is wrong. Second occurrence of this pattern in the
milestone — the first was `src/types/database.ts` between 134-01 and 134-02.

## Production boundary — held

Migrations 1290-1295 authored, **none applied**. No assistant bound. No routing row
flipped. No ingress route rewired. No booking placed. No organization changed.
