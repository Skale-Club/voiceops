---
gsd_state_version: 1.0
milestone: v3.5
milestone_name: milestone
status: complete_pending_live_walkthrough
stopped_at: Phases 131-139 executed and verified; a real booking proved the mesh; the Vapi assistant is pushed from Xphere; one live template walkthrough outstanding
last_updated: "2026-09-05T04:40:00.000Z"
last_activity: 2026-09-04
progress:
  total_phases: 9
  completed_phases: 9
  total_plans: 33
  completed_plans: 33
  percent: 100
  phase_note: 131-136 are the closed v3.5 milestone; 137-139 were opened afterwards from production findings and the duplicability requirement, and are executed and verified
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (last updated 2026-07-03)

**Core value:** Voice and text must reach the correct tenant-scoped specialist and execute business actions through the Action Engine quickly, safely, and observably.
**Current focus:** nothing autonomous remains. One human item: install the mesh into a real second tenant through `Settings → Organization Templates`.

## Current Position

Phase: 139 (agent-mesh-as-a-template) — 8 of 8 plans executed and verified
Next: the live walkthrough. Everything below that line is built, tested and deployed.
**Milestone:** v3.5 Omnichannel Agent Orchestration
**Phase:** 139 of 139 (9 of 9)
**Plan:** 8 of 8 in the final phase
**Status:** Complete; two human-gated items remain
**Last Activity:** 2026-09-05
**Last Activity Description:** Voice prompt pushed from Xphere with the engine-rendered location rule; deep re-analysis found and fixed three more never-reached mechanisms (runtime token rendering, missing customerAddress field, dropped tool routing)

## Progress

**Phases Complete:** 9 of 9
**Progress:** [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 33
- Phases: 9 (131-136 as the planned v3.5 milestone, 137-139 opened afterwards)

**By Phase:**

| Phase | Plans | Status |
|-------|-------|--------|
| 131 | 3 | Complete |
| 132 | 4 | Complete |
| 133 | 3 | Complete (SAFE-01 partial) |
| 134 | 3 | Complete (ROLL-02 partial) |
| 135 | 3 | Complete |
| 136 | 3 | Complete — ROLL-03 closed by booking #471 |
| 137 | 3 | Complete — MESH-04 closed by booking #471 |
| 138 | 3 | Complete — migrations applied; voice prompt pushed with the engine-rendered rule |
| 139 | 8 | Complete in code; live walkthrough outstanding |

## Accumulated Context

### Decisions

Recent decisions affecting current work:

- Vapi continues to own telephony, STT, TTS, and its live conversation loop.
- Xphere owns tenant resolution, internal agent orchestration, workflows, and actions.
- Voice and text reuse the same specialist definitions with channel-specific policies.
- All Xphere generative inference goes through OpenRouter.
- The Action Engine remains the only provider execution substrate.
- Cuts & Culture is the first tenant canary; its specialist graph is not a universal product default.
- A template carries behaviour; a tenant supplies its facts. Cross-tenant binding is by
  stable key, never by id, and installing never activates routing.
- The engine, not the prompt author, decides whether a booking collects an address.

### Pending Todos

Both are human-gated and outward-facing; neither is autonomous work.

- Install the mesh into a real second organization through `Settings → Organization Templates`.
  Every guarantee is proven against in-memory fakes; none of it substitutes for one real install.
- ~~Push a rendered config to the Vapi assistant~~ Done 2026-09-04 from a dry-run-first script;
  the assistant now carries the engine-rendered service location rule. The operator button
  (139-07) remains the way to re-push after a settings change.

### Blockers/Concerns

- Preserve the Node.js, lean-payload, deferred-side-effect, always-HTTP-200 Vapi contract.
- 24 write action types (`send_whatsapp_message`, `send_email`, the pipeline surface) are
  still unclassified and bypass the idempotency guard. Deliberately out of scope; recorded in
  `FINDINGS-OUTSIDE-SCOPE.md`.
- Production schema has drifted from the repo before (migration 1295 reconciled one function).
  A wider audit was not done.
- Test booking #471 (2026-09-08 10:30) is real and sits in the demo calendar.
- The widget mesh cannot answer a cold availability question inside its 30s turn budget
  (measured 31s; `check_availability` 13.9s cold, ~6s of unmeasured runtime overhead before the
  first delegation). Levers ranked in `FINDINGS-OUTSIDE-SCOPE.md` item 9; nothing changed yet.
- Vapi still carries a hardcoded, currently inert `firstMessage`; transcriber and speaking plans
  are Vapi defaults (items 6-7).

## Session Continuity

**Last session:** 2026-09-04
**Stopped at:** Milestone complete. Nothing autonomous remains.
**Resume file:** none — see Pending Todos above.
