---
phase: 138-tenant-safe-meta-prospect-audiences
plan: "03"
subsystem: meta-credentials-and-transport
tags: [meta, oauth, graph-api, encryption, tenant-isolation]
requires: []
provides:
  - Fail-closed tenant Meta OAuth credential provider
  - Centralized Graph API v26.0 transport contract
  - Typed and redacted provider and Graph errors
affects: [meta-audience-reconciliation, meta-audience-operator-ui, ads-oauth]
tech-stack:
  added: []
  patterns: [explicit tenant connection lookup, decrypt-at-execution, typed safe provider errors]
key-files:
  created:
    - tests/meta-audience-provider.test.ts
  modified:
    - src/lib/meta/audience-provider.ts
    - src/lib/meta/graph.ts
    - src/lib/ads/meta-oauth.ts
    - src/lib/meta/custom-audiences.ts
    - tests/meta-custom-audiences.test.ts
    - supabase/migrations/1271_meta_prospect_audiences.sql
    - src/types/database.ts
key-decisions:
  - "Tenant OAuth rejects unknown expiry as well as expired credentials so writes fail closed."
  - "The agency system-user token remains usable only through explicit AgencySystemUserProvider selection."
  - "Graph v26.0 and CustomerFileSource USER_PROVIDED_ONLY are pinned from Meta's official SDK contract verified 2026-08-10."
patterns-established:
  - "Credential errors expose stable codes and never include database/decrypt details."
  - "Graph errors redact exact tokens and every 64-character hash before crossing the transport boundary."
requirements-completed: [TEN-01, TEN-02, OPS-01, TEST-02]
duration: 5min
completed: 2026-08-10
---

# Phase 138 Plan 03: Tenant Meta Credentials and Graph v26 Summary

**Explicit organization-owned OAuth resolution now gates every audience write, while Graph v26 transport returns typed errors with token and identifier redaction**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-11T03:02:15Z
- **Completed:** 2026-08-11T03:07:45Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added strict lookup by connection ID, organization, platform, and selected ad account.
- Rejected inactive, expired, expiry-unknown, inaccessible, missing, and undecryptable credentials before Graph access.
- Upgraded the shared Meta version from v20.0 to current v26.0 based on Meta's official Business SDK v26.0.0 release.
- Aligned Custom Audience creation with the current `CustomerFileSource` enum and added safe Graph error mapping.

## Task Commits

1. **Implement OrgOAuthProvider with strict ownership and expiry checks** - `94aace37` (feat)
2. **Validate and pin the current Meta Custom Audience API contract** - `e8c97882` (feat)

## Files Created/Modified

- `src/lib/meta/audience-provider.ts` - Tenant and explicit agency credential providers with safe error codes.
- `tests/meta-audience-provider.test.ts` - Ownership, status, expiry, decrypt, fallback, and pre-Graph tests.
- `src/lib/ads/meta-oauth.ts` - Central Graph v26.0 constant and verification date.
- `src/lib/meta/graph.ts` - Typed safe Graph failures and redaction.
- `src/lib/meta/custom-audiences.ts` - Current CustomerFileSource and exact v26 request path.
- `tests/meta-custom-audiences.test.ts` - Request, hashing, current enum, and redaction tests.
- `supabase/migrations/1271_meta_prospect_audiences.sql` - Current consent enum compatibility migration.
- `src/types/database.ts` - Current consent enum type.

## Decisions Made

- A tenant OAuth connection without an auditable expiration is treated as unusable and must be reconnected.
- v26.0 is the sole Graph version constant; no audience module owns a second version string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated the pending migration and manual types for Meta's current consent enum**
- **Found during:** Task 2 API contract validation
- **Issue:** The prototype persisted `CUSTOMER_FILE_WITH_CONSENT`, while Meta's official v26 SDK exposes only `USER_PROVIDED_ONLY`, `PARTNER_PROVIDED_ONLY`, and `BOTH_USER_AND_PARTNER_PROVIDED`.
- **Fix:** Migrated the legacy value, changed the default, added a constraint, and narrowed the TypeScript type.
- **Files modified:** `supabase/migrations/1271_meta_prospect_audiences.sql`, `src/types/database.ts`
- **Verification:** Schema and Custom Audience transport tests pass.
- **Committed in:** `e8c97882`

---

**Total deviations:** 1 auto-fixed (1 correctness bug).
**Impact on plan:** Necessary compatibility correction before the still-unapplied migration reaches production.

## Issues Encountered

- Meta's developer documentation returned HTTP 429 during direct retrieval. The current version and enum were verified against Meta's official `facebook-nodejs-business-sdk` v26.0.0 release and generated source instead.

## User Setup Required

None in code. The expired Skale Club tenant connection still requires operator reconnection during Plan 138-07.

## Next Phase Readiness

- Reconciliation can request exactly one tenant-owned connection and receive a safe operational error when it cannot write.
- Operator UI can map provider error codes to reconnect guidance without exposing secrets.

## Self-Check: PASSED

- Provider test file exists and both task commits are present.
- `npx vitest run tests/meta-custom-audiences.test.ts tests/meta-audience-provider.test.ts tests/meta-audience-schema.test.ts`: 23/23 passed.
- Targeted ESLint passed with zero warnings after cleanup.

---
*Phase: 138-tenant-safe-meta-prospect-audiences*
*Completed: 2026-08-10*
