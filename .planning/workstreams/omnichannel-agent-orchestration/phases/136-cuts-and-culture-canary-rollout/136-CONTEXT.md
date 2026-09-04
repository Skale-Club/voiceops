---
phase: 136-cuts-and-culture-canary-rollout
status: ready_for_detailed_planning
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 136 Context — Cuts & Culture Canary Rollout

## Goal

Cuts & Culture alone runs the first production specialist graph across voice and widget,
proving shared specialization, real idempotent booking, and complete tracing without
installing tenant-specific behavior as a platform default.

## Requirements

ROLL-01, ROLL-03.

## The Line This Phase Runs Into

This is the first phase whose success criteria cannot be fully met by writing code. ROLL-03
says "a live canary proves" and "a real booking completes". That requires production
access, a bound Vapi assistant, applied migrations, and a real mutation against a real
tenant's scheduling provider.

So this phase splits cleanly, and the split must be stated up front rather than discovered
at the end:

**Deliverable now** — everything that makes the canary possible, reviewable, and reversible:
the routing wiring, the tenant graph as an idempotent provisioning artifact that has not
been run, the tests proving the graph's shape and isolation, and the activation runbook.

**Deliverable only by a human** — applying migrations 1290-1294, running the provisioning
script against production, binding the Vapi assistant, flipping the routing mode, and
placing the real booking. Each is outward-facing and irreversible in a way that no amount
of test coverage substitutes for.

## Carried-Forward Gap

ROLL-02 was marked done in Phase 134, and it is done as a mechanism: storage, a
safe-defaulting resolver, and proof that flipping it destroys nothing. But plan 134-02
deliberately said "build the resolver only, do not wire it into any live route", so
**nothing reads the switch today**. An operator can flip it and observe no difference.

Wiring it is cutting over routing, which is why it was deferred to here. It is the first
task of this phase, and it must land in a state where legacy remains the default for every
organization, so merging the wiring changes nobody's behavior until someone deliberately
flips a row.

## Existing Foundation to Reuse

- `resolveChannelRoutingMode()` (Phase 134) — the switch, safe-defaulting to legacy.
- `resolveTrustedAgentRoute()` and `resolveSpecialistRoute()` (Phase 132) — explicit intent
  to specialist without a router model call.
- `invokeAgent` / `invokeInternalSpecialist` (Phases 131-133) — the trusted boundary and
  the voice ceiling.
- `agent_partners` + `agent_partner_workflow_grants` (Phase 132) — the typed edges and the
  per-edge delegated capability grants that make "only Booking can write to Xkedule"
  expressible rather than aspirational.
- The idempotency guard now covering the Xkedule booking mutations (`d0a162bf`).
- Tenant-scoped provisioning scripts are an established house pattern — see
  `scripts/seed-demo-org.ts` and the several `*-skaleclub-workflows.ts` scripts.

## Constraints That Shape the Design

- **`supabase/seeds/workflows/` is for platform defaults and is validated in CI. The Cuts &
  Culture graph must not go there.** The locked decision is that this tenant is an isolated
  canary, not a product default, and CLAUDE.md is explicit that one client's playbook must
  not become product-wide behavior.
- Only the Booking specialist may hold Xkedule write capability. Services, Pricing,
  Availability and Customer are read-only. This is enforceable through the Phase 132 edge
  grants and must be asserted, not merely configured.
- Voice and widget must reach the **same** Availability specialist definition — that is the
  whole point of the shared graph. Two channel-specific copies would satisfy the letter of
  ROLL-03 and defeat its purpose.
- The provisioning artifact must be idempotent and safe to re-run, and must refuse to touch
  any organization other than its target.

## Confirmed Gaps

- Nothing reads `resolveChannelRoutingMode()`. Verified by grep at the start of this phase.
- No Cuts & Culture agent graph exists in the repository in any form.
- No activation runbook exists. The Phase 135 UAT checklist covers what a human should
  observe; it does not cover the ordered, reversible sequence of production steps that gets
  the tenant there, nor how to abort midway.

## Locked Decisions

- Legacy stays the default after the wiring lands. Merging this phase changes no
  organization's behavior.
- The canary configuration is tenant-scoped and lives outside the platform seed path.
- "Only Booking writes" is proven by a test against the provisioned graph's grants, not by
  reading the config and trusting it.
- The provisioning script defaults to a dry run and requires an explicit flag plus an
  explicit organization identifier to write anything.
- This phase does not apply a migration, run the script against production, bind an
  assistant, flip a routing row, or place a booking.

## Verification Focus

- With no routing row present, every channel still resolves to the legacy path — proven by
  a test, since this is the property that makes merging safe.
- Flipping voice to specialist changes voice and leaves widget alone, and vice versa.
- The provisioned graph has exactly the entry orchestrator plus Services, Pricing,
  Availability, Customer and Booking.
- Only Booking holds an Xkedule write grant; the other four hold none, asserted against the
  grant rows.
- Voice and widget resolve to the same Availability specialist row, by id.
- The provisioning script is idempotent, is a dry run by default, and refuses a
  non-target organization.
- No other organization gains the graph, and the platform seed path is untouched.
- Phases 131-135 suites stay green, and the Phase 135 release gate passes.

## Human/Production Boundary — the explicit handover

Everything below requires a person, in this order. The runbook this phase produces must
carry it with the abort step for each:

1. Apply migrations 1290, 1291, 1292, 1293, 1294 via `npx supabase db push`.
2. Run the provisioning script against the Cuts & Culture organization, first as a dry run.
3. Bind the Vapi assistant to the entry orchestrator.
4. Flip the voice routing mode to specialist, observe, then the widget channel.
5. Place one real booking and confirm the trace end to end.

Nothing in this phase performs any of these.

## Known Environment Traps

- Full suite fails 30-32 files / 52-53 tests for unrelated reasons; membership beyond the
  core 30 shifts between runs. Check any newcomer in isolation.
- Production build needs `NODE_OPTIONS=--max-old-space-size=8192`, and currently fails
  locally during static generation of two admin pages on a Redis connection timeout — an
  environment issue, not a code regression. Compile and TypeScript stages pass.
- Never junction `node_modules` into a git worktree.
