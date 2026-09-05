---
phase: 139-agent-mesh-as-a-template
plan: 07
status: complete
completed: 2026-09-04
requirements: [TMPL-01, TMPL-03]
---

# Plan 139-07 Summary

## Outcome

The two mechanisms built in this phase's first wave are now reachable from the UI an
operator actually uses: the Organization Templates page shows an agents count alongside
every other asset-group count, and the Connected Assistants table gets a "Push Config to
Vapi" action — the first and only caller of `pushAssistantConfig()` (139-04) anywhere in
the app — gated behind an explicit confirmation dialog naming the live assistant.

## Changes

- `src/app/(dashboard)/settings/organization-templates/actions.ts`: `snapshotCounts()`
  (previously listing named fields one by one, not looping over `ASSET_GROUPS`) now also
  reports an `agents` figure; `OrgTemplateListItem.counts` carries it.
- `src/components/org-templates/organization-templates-manager.tsx`: the summary line
  that already renders pipeline/tag/workflow counts now also renders the agents count.
- `src/app/(dashboard)/assistants/actions.ts`: `pushAssistantConfigAction(mappingId)` — an
  RLS-scoped server action (uses the authenticated client, not service-role) that resolves
  the `assistant_mappings` row by id, confirms its `organization_id` matches the caller's
  current org (returns a generic "not found" otherwise — no cross-org mapping id can be
  probed), then delegates to `pushAssistantConfig()` (139-04). Documented inline as "must
  only ever run from a deliberate operator click on a specific mapping row, never on
  render, mount, or as a side effect of loading the page."
- `src/components/assistants/assistant-mappings-table.tsx`: adds a per-row "Push Config to
  Vapi" button, gated behind a `Dialog` confirmation naming the specific assistant
  (`mapping.name || mapping.vapi_assistant_id`) before the action fires; a pending/animate
  state while the PATCH is in flight.
- `tests/org-templates-agents-wiring.test.ts`: covers the agents count via
  `listOrgTemplates()` rather than importing `snapshotCounts()` directly — the file's
  `'use server'` directive requires every export to be async, which makes the pure counting
  logic untestable in isolation; the test instead asserts the count surfaces correctly
  through the public server action.

## Verification

- `npx vitest run tests/org-templates-agents-wiring.test.ts` — passed, independently
  re-run at verification time as part of a combined 51-test run.
- Independently confirmed at verification time by direct read of
  `src/app/(dashboard)/assistants/actions.ts` and
  `src/components/assistants/assistant-mappings-table.tsx`: `pushAssistantConfigAction()`
  has exactly one call site (the table component), that call site is inside a confirmation
  dialog's confirm handler (not a click handler that fires immediately), and the action
  itself re-verifies `mapping.organization_id === organization_id` before ever calling
  `pushAssistantConfig()` — a request for a mapping id belonging to a different
  organization is rejected before any Vapi call is made.

## Files Modified

- `src/app/(dashboard)/settings/organization-templates/actions.ts`
- `src/components/org-templates/organization-templates-manager.tsx`
- `src/app/(dashboard)/assistants/actions.ts`
- `src/components/assistants/assistant-mappings-table.tsx`
- `tests/org-templates-agents-wiring.test.ts`

## Commit

`4ddc83ff` — `feat(139-07): surface agent templates and assistant config push`

## Self-Check: PASSED (reconstructed independently from commit `4ddc83ff` and the live
source tree; this SUMMARY was not written by the executing agent and is being added
retroactively during verification)
