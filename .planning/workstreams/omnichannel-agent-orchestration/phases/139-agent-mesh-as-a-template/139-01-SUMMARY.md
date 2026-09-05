---
phase: 139-agent-mesh-as-a-template
plan: 01
status: complete
completed: 2026-09-04
requirements: [TMPL-01]
---

# Plan 139-01 Summary

## Outcome

`org-templates` gains an `agents` asset group with a full capture half: a source org's
agents, active prompts, direct tool grants, partner edges, delegated workflow grants, and
channel defaults can be read into a structure-only snapshot keyed by `slug`/`tool_name`
rather than database ids — the precondition for installing the same mesh shape into a
different organization's ids in a later plan (139-05).

## Changes

Two commits implement this plan's single declared wave:

- `22086548` — `src/lib/org-templates/types.ts`: `ASSET_GROUPS` gains `'agents'` with a
  label (`'Agents (mesh: prompts, tools, delegation, channel defaults)'`); the
  Organization Templates settings page's checkbox list renders it with zero UI changes
  because it already derives generically from `ASSET_GROUPS`. New types:
  `SnapshotAgent`, `SnapshotAgentPartnerEdge`, `SnapshotAgentChannelDefault`, added to
  `OrgTemplateSnapshot`. `InstallCounts`/`emptyCounts()` gain five agent-shaped counters,
  all zero-initialized.
- `b7b6fb24` — `src/lib/org-templates/snapshot.ts`: `captureAgents()` reads `agents`,
  each agent's active `agent_prompt_versions` row, workflow-sourced `agent_tools` (rows
  whose grant traces to a `workflow_id`; rows sourced from a per-org `tool_config_id`
  integration config are silently skipped — not portable across tenants), `agent_partners`
  + `agent_partner_workflow_grants`, and `agent_channel_defaults` — resolving every
  cross-reference to a stable name (agent `slug`, workflow `tool_name`) before returning.
  `role` (`'orchestrator' | 'specialist'`) is derived from whether the agent has any
  `direct_tools`, informational only. Wired into `captureOrgSnapshot()` behind
  `want.has('agents')`, running concurrently with the other five groups.

## Verification

- `npx vitest run tests/org-templates-agents-capture.test.ts` — 7 tests, independently
  re-run at verification time as part of a combined 51-test run alongside the other
  139-0x test files (all passed).
- Independently confirmed at verification time: `captureAgents()` and `installAgents()`
  (139-05) both bind exclusively by `slug`/`tool_name` — no organization-specific UUID
  appears in either module's cross-references (checked by direct read, not test-only).

## Files Modified

- `src/lib/org-templates/types.ts`
- `src/lib/org-templates/snapshot.ts`
- `tests/org-templates-agents-capture.test.ts`

## Commits

- `22086548` — `feat(139-01): declare agents org-template asset-group contract`
- `b7b6fb24` — `feat(139-01): capture the agent mesh into an org-template snapshot`

## Self-Check: PASSED (reconstructed independently from commits `22086548`/`b7b6fb24` and
the live source tree; this SUMMARY was not written by the executing agent and is being
added retroactively during verification)
