---
phase: 137-shared-specialist-mesh
plan: 01
status: complete
completed: 2026-09-04
requirements: [MESH-01, MESH-03]
---

# Plan 137-01 Summary

## Outcome

The canary graph now describes the tenant that actually exists — six specialists, seven
partner edges, the eight real Xkedule tool names — and `scripts/provision-canary-graph.ts`
wrote those rows against the live Cuts & Culture organization
(`31502b7d-f4bd-4493-91f7-fc6f2738a09d`), reusing the tenant's eight pre-existing workflows
rather than duplicating them.

## Changes

- Reshaped `canary/cuts-and-culture.json` into `CanaryGraph`/`CanaryAgentDef`/
  `CanaryWorkflowDef`/`CanaryEdgeDef`, preserving every system prompt verbatim and using
  only the eight real tool names (`list_services`, `business_info`, `get_quote`,
  `check_availability`, `lookup_customer`, `book_appointment`, `reschedule_appointment`,
  `cancel_appointment`) instead of the five invented ones an earlier revision carried.
- Kept the two specialist-to-specialist edges (booking to customer, booking to
  availability) — seven edges total, not a star topology.
- Extended the script to bind to a tenant's already-existing workflows by `tool_name`
  instead of creating a second row, so a re-run against an organization that already has
  all eight workflows creates zero new workflow rows.
- **Deviation (Rule 2 — auto-add missing critical functionality, not in the original task
  text):** added `direct_tools` to `CanaryAgentDef` and provisioned `agent_tools`
  (direct-ownership) grants. Without this, `resolveEffectiveToolAuthority()`'s
  never-widen intersection (AUTHZ-02) would deny every specialist's own tool call — a
  specialist needs to hold the tool itself, an edge grant alone is not enough.
- Extended `assertOnlyBookingHoldsWriteGrants` to also check direct-ownership write
  grants, not only delegated edge grants, so the write-isolation proof covers both grant
  paths.
- Rewrote `tests/canary-graph-shape.test.ts` for the real tool names, the 7-edge
  topology, and the zero-duplicate-workflow-reuse requirement.

## Execution

Ran the script three times against the live database: a structural preview (no
arguments), a validated dry run (organization id only), then `--apply` against
`31502b7d-f4bd-4493-91f7-fc6f2738a09d`. Verified directly against the live tables:

- 6 new agents + the untouched generalist = 7 agents total.
- 8 workflows, zero duplicates, same workflow ids as before the run.
- 7 partner edges.
- 10 edge grants, only 3 marked write, all three targeting `cc-booking-specialist`.
- 16 `agent_tools` rows (8 new direct grants + the generalist's pre-existing 8).

Re-ran `--apply` a second time: identical counts across every table, confirming the
script is idempotent against a tenant it has already provisioned.

## Verification

- `npx vitest run tests/canary-graph-shape.test.ts`

## Files Modified

- `.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json`
- `scripts/provision-canary-graph.ts`
- `tests/canary-graph-shape.test.ts`

## Known Debt (carried forward, not fixed by this plan)

`scripts/provision-canary-graph.ts` does not create `agent_prompt_versions`. Without an
active prompt version, `resolveAgent()` refuses the agent — this was not caught by this
plan's row-counting verification (see 137-02-SUMMARY.md and 137-03-PLAN.md for how it
surfaced and was worked around by hand for this one tenant). A fresh run against a
different organization today produces six unusable agents.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Specialists had no direct tool grants**
- **Found during:** Task 1 (conforming the graph)
- **Issue:** The plan described edge grants (partner-to-partner delegation) but a
  specialist also needs to hold its own tool directly — `resolveEffectiveToolAuthority()`
  intersects the specialist's own grant with the edge grant, so a specialist with no
  direct grant of its own tool can never execute it regardless of edges.
- **Fix:** Added `direct_tools` to the graph shape and provisioned `agent_tools` rows for
  each specialist's own domain tool(s).
- **Files modified:** `canary/cuts-and-culture.json`, `scripts/provision-canary-graph.ts`,
  `tests/canary-graph-shape.test.ts`
- **Commit:** `ff075161`

## Self-Check: PASSED
