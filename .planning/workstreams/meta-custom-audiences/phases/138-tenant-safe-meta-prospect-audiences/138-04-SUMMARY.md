---
phase: 138-tenant-safe-meta-prospect-audiences
plan: "04"
subsystem: prospect-ingestion-and-suppression
tags: [xcraper, meta-audiences, optout, enrichment, tenant-isolation]
requires: [138-01, 138-02]
provides:
  - Non-destructive Xcraper account enrichment on idempotent re-import
  - Organization-scoped durable audience dirty marking
  - Account email opt-out through custom_fields.email
affects: [meta-audience-reconciliation, xcraper-ingestion, prospect-compliance]
tech-stack:
  added: []
  patterns: [deep merge present values, durable dirty queue, service-role double tenant scoping]
key-files:
  created:
    - src/lib/meta/audience-dirty.ts
    - tests/prospect-company-enrichment.test.ts
    - tests/prospect-optout-meta.test.ts
    - tests/meta-audience-dirty.test.ts
  modified:
    - src/app/api/v1/prospects/route.ts
    - src/app/api/v1/optout/route.ts
    - tests/xpot-integration-contract.test.ts
key-decisions:
  - "Null, undefined, and empty-string enrichment values never clobber an existing value."
  - "Email suppression marks every enabled audience in the organization dirty because it may affect membership without a directly matched CRM row."
  - "Dirty discovery and updates both repeat org_id because the service-role client bypasses RLS."
patterns-established:
  - "Nested source payloads such as socials merge recursively while preserving unrelated keys."
  - "A failed entity write never schedules reconciliation; a failed dirty write surfaces so an idempotent re-import can retry it."
requirements-completed: [DATA-03, SYNC-01, COMP-01, TEST-02]
duration: 11min
completed: 2026-08-10
---

# Phase 138 Plan 04: Prospect Ingestion and Opt-out Propagation Summary

**Xcraper re-imports now enrich existing prospect companies without data loss, while ingest and opt-out changes durably schedule the correct tenant's Meta audiences for reconciliation**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-11T03:14:19Z
- **Completed:** 2026-08-11T03:25:36Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added recursive present-value merging for company `custom_fields` and `source_payload`, including email, website, address, category, rating, review count, Maps URL, and nested social profiles.
- Preserved existing enrichment when Xcraper omits a key or sends null/empty data, and kept converted CRM accounts immutable.
- Added a tenant-bounded dirty-marker that selects only enabled matching source/segment scopes and schedules immediate reconciliation.
- Added account opt-out lookup by normalized `custom_fields.email`, deduplicated email/phone account matches, and propagated successful unsubscribe/suppression writes.
- Made failed prospect and opt-out writes observable and prevented them from falsely scheduling successful downstream work.

## Task Commits

1. **Specify enrichment and opt-out propagation behavior (RED)** - `385bdce6` (test)
2. **Implement non-destructive ingest and durable dirty marking (GREEN)** - `fd6aff04` (feat)

## Files Created/Modified

- `src/lib/meta/audience-dirty.ts` - Organization-scoped scope matching and durable reconciliation scheduling.
- `src/app/api/v1/prospects/route.ts` - Safe deep enrichment merge, write error handling, and dirty marking.
- `src/app/api/v1/optout/route.ts` - Account email lookup, write-aware unsubscribe handling, and dirty marking.
- `tests/prospect-company-enrichment.test.ts` - Re-import, null preservation, converted-record, and failed-write tests.
- `tests/prospect-optout-meta.test.ts` - Email-only account opt-out and failed-write propagation tests.
- `tests/meta-audience-dirty.test.ts` - Tenant/source/segment matching and safe failure tests.
- `tests/xpot-integration-contract.test.ts` - Keeps the unrelated Xpot payload contract isolated from audience storage.

## Decisions Made

- A successful email suppression reconciles all enabled scopes in the same organization, while entity changes use exact source and saved-segment matching.
- Both discovery and mutation repeat the organization predicate even though audience tables also have RLS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added direct dirty-marker scope tests**
- **Found during:** Task 2 verification
- **Issue:** Route mocks proved that dirty marking was requested but did not prove the service selected only matching tenant scopes.
- **Fix:** Added `tests/meta-audience-dirty.test.ts` covering organization, enabled-source, saved-segment, and failed-update behavior.
- **Verification:** Targeted phase tests pass 8/8.
- **Committed in:** `fd6aff04`

**2. [Rule 1 - Regression] Isolated the existing Xpot contract test from new audience persistence**
- **Found during:** Compatibility verification
- **Issue:** The Xpot payload test's narrow fake database rejected the newly expected audience table lookup even though that behavior has dedicated tests.
- **Fix:** Mocked the dirty-marker only in the Xpot contract suite; its company-kind contract still passes 2/2.
- **Committed in:** `fd6aff04`

---

**Total deviations:** 2 auto-fixed (1 missing critical test, 1 test regression).
**Impact on plan:** Improved tenant-scope evidence without broadening production behavior.

## Issues Encountered

- The repository-wide Vitest gate remains red from pre-existing mock drift across unrelated Auth, contact, and Zernio suites (59 failed, 2,260 passed). The production build and every targeted phase test pass.

## User Setup Required

None for this plan.

## Next Phase Readiness

- Every relevant Xcraper ingestion or opt-out now creates durable reconciliation work.
- Plan 138-05 can claim dirty configs, compute hash-only diffs, call Meta, and advance the membership ledger only after complete success.

## Self-Check: PASSED

- `npm run build`: passed.
- `npx vitest run tests/prospect-company-enrichment.test.ts tests/prospect-optout-meta.test.ts tests/meta-audience-dirty.test.ts`: 8/8 passed.
- Xpot company-kind compatibility tests: 2/2 passed.
- Targeted ESLint passed with zero warnings.

---
*Phase: 138-tenant-safe-meta-prospect-audiences*
*Completed: 2026-08-10*
