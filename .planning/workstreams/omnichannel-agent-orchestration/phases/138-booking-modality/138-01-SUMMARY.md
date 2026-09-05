---
phase: 138-booking-modality
plan: 01
status: complete
completed: 2026-09-04
requirements: [MODAL-01, MODAL-02]
---

# Plan 138-01 Summary

## Outcome

The booking engine's modality vocabulary now exists as contracts only — a migration, a
schema-boundary transform, a prompt renderer, and a fail-closed resolver — with nothing yet
wired into `buildWorkflowTools()` or `runAgent()` (that is 138-02). Voice/Vapi is explicitly
out of scope: no outbound sync to a Vapi assistant exists in this codebase.

## Changes

- `supabase/migrations/1297_organization_service_location_mode.sql` (authored only, not
  applied): `organizations.service_location_mode TEXT NOT NULL DEFAULT 'on_premises'`,
  `CHECK (service_location_mode IN ('on_premises', 'at_customer', 'either'))`. No backfill.
  Modeled on `047_delegation_visibility.sql`'s single-`ALTER TABLE` shape.
- `.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json`:
  `book_appointment.input_schema` gains `customerAddress` (`type: string`,
  `required: false` at this static/default level — the per-org override happens at
  runtime in 138-02). The four existing required fields and `notes` are untouched.
- `src/lib/agent-runtime/service-location-schema.ts`: `ServiceLocationMode` type (the
  module other 138-01/138-02 files import it from) and
  `applyServiceLocationMode(inputSchema, mode, fieldKey='customerAddress')` — deletes the
  field entirely for `on_premises` (the model must not see it can exist), sets
  `required: true` for `at_customer`, keeps `required: false` for `either`. Any
  unrecognised `mode` (including `undefined`/`null`/empty string/typo) behaves exactly
  like `on_premises` — fail closed. A map with no `customerAddress` key is returned
  unchanged for every mode.
- `src/lib/agent-runtime/service-location-prompt.ts`: `renderServiceLocationBlock(mode)` —
  the single source of the ask/never-ask wording. Three distinct, non-empty strings (none
  embedded verbatim in another), an unrecognised mode renders the same text as
  `on_premises`.
- `src/lib/agent-runtime/resolve-service-location-mode.ts`: `resolveServiceLocationMode(organizationId)`,
  modeled on `routing-mode.ts`'s `resolveChannelRoutingMode()`. Creates its own
  service-role client, selects `service_location_mode` for one org, fails closed to
  `on_premises` on a missing organizationId, a read error, a missing row, a null value, or
  any unrecognised string. Never throws.
- `tests/service-location-mode.test.ts`: 42 tests (this SUMMARY's authoring pass counted
  the same file at 42 assertions across migration-shape, canary-schema,
  `applyServiceLocationMode`, `renderServiceLocationBlock`, and
  `resolveServiceLocationMode` — independently re-run at verification time, all passing).

## Verification

- `npx vitest run tests/service-location-mode.test.ts` — all cases passed (re-confirmed
  independently at verification time as part of a combined 89-test run alongside
  138-00/138-02's test files).

## Files Modified

- `supabase/migrations/1297_organization_service_location_mode.sql`
- `src/types/database.ts`
- `.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json`
- `src/lib/agent-runtime/service-location-schema.ts`
- `src/lib/agent-runtime/service-location-prompt.ts`
- `src/lib/agent-runtime/resolve-service-location-mode.ts`
- `tests/service-location-mode.test.ts`

## Commit

`faa86637` — `feat(138-01): booking-modality contracts — schema, prompt, resolver`

## Self-Check: PASSED (reconstructed independently from commit `faa86637` and the live
source tree; this SUMMARY was not written by the executing agent and is being added
retroactively during verification)
