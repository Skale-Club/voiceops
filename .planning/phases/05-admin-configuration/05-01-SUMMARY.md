---
phase: 05-admin-configuration
plan: 01
subsystem: api
tags: [supabase, widget, nextjs, vitest, migration]
requires:
  - phase: 04-widget-embed-script
    provides: public widget asset and Phase 4 UI defaults used for config fallback
provides:
  - append-only organization widget config columns
  - public widget config endpoint keyed by widget token
  - automated coverage for config token handling and default normalization
affects: [phase-05-plan-02, phase-05-plan-03, widget-runtime, organizations]
tech-stack:
  added: []
  patterns: [public widget boot config via lean token-scoped route, org-level widget settings stored on organizations]
key-files:
  created: [supabase/migrations/013_org_widget_config.sql, src/app/api/widget/[token]/config/route.ts, tests/widget-config-route.test.ts]
  modified: [src/types/database.ts]
key-decisions:
  - "Stored widget appearance settings directly on organizations instead of introducing a separate widget table."
  - "Normalized null and blank public config values to the widget's existing Phase 4 defaults so embeds remain safe during partial configuration."
patterns-established:
  - "Public widget configuration is fetched through a dedicated GET route rather than coupling startup UI state to the chat POST endpoint."
  - "Widget token routes expose only public-safe fields and return 401 for invalid or inactive organizations."
requirements-completed: [ADMIN-01]
duration: 9 min
completed: 2026-04-04
---

# Phase 5 Plan 1: Admin Configuration Summary

**Org-backed widget appearance storage with a public-safe token config endpoint and focused fallback tests.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-04T18:40:00Z
- **Completed:** 2026-04-04T18:48:47Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added migration 013 to store per-org widget display name, primary color, and welcome message on `organizations`.
- Implemented `GET /api/widget/[token]/config` as a lean Node.js public endpoint that resolves orgs by `widget_token` and returns only safe widget fields.
- Added focused Vitest coverage for valid token, invalid token, inactive org, and default normalization behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add migration 013 for organization widget config fields** - `0719e0a` (feat)
2. **Task 2: Implement GET /api/widget/[token]/config** - `7fbeb76` (feat)
3. **Task 3: Add automated coverage for config route behavior** - `09ab657` (test)
4. **Deviation fix: remove invalid route export** - `b528757` (fix)

**Plan metadata:** pending

## Files Created/Modified
- `supabase/migrations/013_org_widget_config.sql` - append-only schema change for org-scoped widget UI settings
- `src/types/database.ts` - organization row, insert, and update types for new widget columns
- `src/app/api/widget/[token]/config/route.ts` - public config endpoint with safe defaults and 401 handling
- `tests/widget-config-route.test.ts` - focused route tests for token handling and fallback normalization

## Decisions Made
- Stored widget appearance settings directly on the existing `organizations` record, matching the phase context and avoiding a new widget table.
- Kept the config route token-scoped and separate from chat handling so widget boot configuration remains lean and decoupled from message execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed a non-route export that broke Next.js build typing**
- **Found during:** Overall verification after Task 3
- **Issue:** Exporting `DEFAULT_WIDGET_CONFIG` from the App Router route caused Next.js route type validation to fail during `npm run build`.
- **Fix:** Kept the default config constant internal to the route and updated the test to assert the explicit default payload instead of importing it.
- **Files modified:** `src/app/api/widget/[token]/config/route.ts`, `tests/widget-config-route.test.ts`
- **Verification:** `npx vitest run tests/widget-config-route.test.ts`; `npm run build`
- **Committed in:** `b528757`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was required for a valid Next.js route module and did not change the planned API contract.

## Issues Encountered
- `npm run build` initially failed because App Router route modules cannot export arbitrary constants. Resolved by keeping the default config constant private to the route file.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend storage and public config foundations for `ADMIN-01` are complete and ready for the dashboard form/page work in `05-02`.
- The widget runtime can consume the new config endpoint in `05-03` without touching the chat route contract.

---
*Phase: 05-admin-configuration*
*Completed: 2026-04-04*

## Self-Check: PASSED
- Verified files exist: `.planning/phases/05-admin-configuration/05-01-SUMMARY.md`, `supabase/migrations/013_org_widget_config.sql`, `src/app/api/widget/[token]/config/route.ts`, `tests/widget-config-route.test.ts`
- Verified commits exist: `0719e0a`, `7fbeb76`, `09ab657`, `b528757`
