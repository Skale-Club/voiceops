---
phase: 138-tenant-safe-meta-prospect-audiences
plan: "05"
subsystem: meta-audience-reconciliation
tags: [meta, reconciliation, ledger, cron, retries, concurrency]
requires: [138-01, 138-02, 138-03, 138-04]
provides:
  - Claim-locked hash-only audience reconciliation engine
  - Atomic successful membership/run commit RPCs
  - Tenant OAuth hourly recovery workflow with fail-closed configuration
affects: [meta-audience-operator-ui, production-rollout, compliance]
tech-stack:
  added: []
  patterns: [claim ownership, remove-before-add, atomic ledger replacement, hourly drift recovery]
key-files:
  created:
    - src/lib/meta/audience-reconcile.ts
    - tests/meta-audience-reconcile.test.ts
    - tests/meta-audience-job.test.ts
  modified:
    - supabase/migrations/1271_meta_prospect_audiences.sql
    - scripts/meta-audience-sync.ts
    - .github/workflows/meta-audience-sync.yml
    - tests/meta-audience-schema.test.ts
key-decisions:
  - "REMOVE operations complete before ADD operations, and any remote failure preserves the previous successful ledger."
  - "Four security-definer RPCs are executable only by service_role and own claim, commit, dry-run completion, and failure transitions."
  - "Hourly success schedules the next recovery reconciliation one hour later; dirty changes remain immediately due."
patterns-established:
  - "Source entities, suppressions, and stored memberships are paged in deterministic order before projection and diff."
  - "Dry runs validate tenant credentials and compute exact counts but perform no Graph or successful-ledger mutation."
requirements-completed: [SYNC-01, SYNC-02, SYNC-03, SYNC-04, OPS-02, TEST-01, TEST-02]
duration: 17min
completed: 2026-08-10
---

# Phase 138 Plan 05: Transactional Audience Reconciliation Summary

**A claim-locked reconciler now computes deterministic hash-only diffs, removes before adding, and atomically advances successful state only after every Meta batch succeeds**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-11T03:28:50Z
- **Completed:** 2026-08-11T03:46:03Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Built the shared reconciliation service for manual, ingestion, retry, dry-run, and scheduled execution.
- Added stale-claim recovery and single-owner concurrency through a database claim RPC.
- Added deterministic source pagination across contacts, accounts, suppressions, and prior memberships.
- Enforced remote REMOVE before ADD and rejected partially invalid Meta results without advancing the ledger.
- Added one atomic transaction for membership replacement, successful run completion, watermark, stats, and next hourly recovery.
- Replaced the contacts-only agency-token cron with tenant OAuth reconciliation and explicit `--org`, `--audience`, and `--dry-run` constraints.
- Removed the false-green missing-token path; missing Supabase or encryption configuration now fails the workflow by name.

## Task Commits

1. **Specify transactional reconciliation (RED)** - `2287528d` (test)
2. **Implement locked reconciliation and atomic ledger commit (GREEN)** - `6cdf3d48` (feat)
3. **Specify scheduler and workflow contract (RED)** - `439b4cd1` (test)
4. **Replace prototype cron and false-green workflow (GREEN)** - `deca73ba` (feat)

## Files Created/Modified

- `src/lib/meta/audience-reconcile.ts` - Claim, project, diff, transport, failure mapping, and Supabase store.
- `supabase/migrations/1271_meta_prospect_audiences.sql` - Service-role-only claim/commit/dry-run/failure RPCs.
- `scripts/meta-audience-sync.ts` - Thin tenant-OAuth scheduler with explicit constraints and safe aggregate logs.
- `.github/workflows/meta-audience-sync.yml` - Hourly/manual fail-closed workflow.
- `tests/meta-audience-reconcile.test.ts` - First-run, replacement, partial failure, concurrency, idempotency, and dry-run tests.
- `tests/meta-audience-job.test.ts` - Scheduler/workflow regression contract.
- `tests/meta-audience-schema.test.ts` - Atomic commit and RPC privilege assertions.

## Decisions Made

- A Meta response containing invalid entries is treated as a failed partial run; the prior ledger remains authoritative.
- Remote audience creation is recorded under the active claim immediately so retries reuse the same audience, while membership state still commits only after all batches pass.
- Scheduled runs consider dirty, never-synced, unscheduled, or hourly-due configs; explicit manual constraints always run the selected config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added database RPCs for true atomic success commits**
- **Found during:** Task 1 implementation
- **Issue:** Multiple Supabase writes could not guarantee that membership, run status, and watermark advanced together.
- **Fix:** Extended the pending migration with service-role-only claim, commit, dry-run, and failure functions.
- **Verification:** Static schema test proves the membership/run/config operations share the commit function and are not callable by authenticated/anon roles.
- **Committed in:** `6cdf3d48`

**2. [Rule 1 - Scalability] Paginated all source and ledger reads**
- **Found during:** Production adapter review
- **Issue:** Supabase's default row limit could silently omit identifiers beyond the first page.
- **Fix:** Added deterministic 1,000-row paging for contacts, accounts, suppressions, and stored membership.
- **Committed in:** `6cdf3d48`

---

**Total deviations:** 2 auto-fixed (1 correctness/transactionality, 1 completeness/scalability).
**Impact on plan:** Required to uphold the plan's atomicity and “every identifier” guarantees.

## Issues Encountered

- Production migration execution remains intentionally deferred to the controlled rollout checkpoint in Plan 138-07.

## User Setup Required

- The GitHub repository must expose `NEXT_PUBLIC_SUPABASE_URL` as a variable and `SUPABASE_SERVICE_ROLE_KEY` plus `ENCRYPTION_SECRET` as secrets before enabling the workflow in production.

## Next Phase Readiness

- The operator API/UI can now preview exact membership, request dry/real runs, show safe history, and surface reconnect/terms failures.
- The production rollout has deterministic dry-run and real-run paths using the same engine.

## Self-Check: PASSED

- `npm run build`: passed.
- Reconciliation, scheduler, and schema tests: 17/17 passed.
- Targeted ESLint passed with zero warnings.
- Workflow YAML parses and contains no global Meta system-user token path.

---
*Phase: 138-tenant-safe-meta-prospect-audiences*
*Completed: 2026-08-10*
