---
phase: 138
slug: tenant-safe-meta-prospect-audiences
date: 2026-08-11
status: in_progress
---

# Phase 138 - Validation Strategy

## Automated Gates

| Gate | Command / evidence | Blocking |
|------|--------------------|----------|
| Targeted unit/integration tests | `npx vitest run` over new Meta audience, prospect ingest, opt-out, and RLS suites | Yes |
| Full test suite | `npm test` | Yes |
| Lint | `npm run lint` | Yes |
| Production build | `npm run build` | Yes |
| Migration verification | Apply idempotently to a disposable/linked database, then run schema/RLS assertions | Yes |
| Secret scan | Assert logs/fixtures contain no raw token and Meta transport receives only hashes | Yes |

## Required Behavioral Proofs

1. Skale Club preview selects Xcraper accounts/contacts only and excludes unrelated CRM contacts.
2. Account company email is read from `custom_fields.email`; re-import updates it without null clobbering.
3. An expired/wrong-tenant Meta connection prevents all Graph requests.
4. A changed identifier produces REMOVE(old hash) followed by ADD(new hash).
5. DND, unsubscribed, suppressed, archived, or deleted records are removed.
6. A batch failure leaves successful membership state/watermark unchanged and is retryable.
7. Two concurrent runs result in one owner and one safe skip/queue outcome.
8. An unchanged rerun sends zero membership mutations.

## Production Checkpoints

### Checkpoint A - Database

- Backup/record current `meta_audience_config` state.
- Apply the new migration.
- Verify constraints, indexes, RLS, and compatibility migration.
- Do not enable any audience yet.

### Checkpoint B - Meta connection

- Reconnect Meta from the Skale Club tenant.
- Explicitly select `Skale Club | U$` or record the operator-approved alternative.
- Validate token expiry/access and ad-account ownership through a read-only call.

### Checkpoint C - Dry run

- Preview and dry-run the master Xcraper audience.
- Expected pre-suppression baseline at planning time: 8 entities, 8 unique phones, 4 unique emails.
- Investigate every difference before enabling writes.

### Checkpoint D - Controlled real sync

- Create/use `Skale Club - Xcraper Prospects`.
- Submit the controlled backfill.
- Record remote audience ID and safe accepted/invalid counts.
- Run immediate reconciliation; expected diff is zero.

### Checkpoint E - Recovery and monitoring

- Prove a controlled suppression/opt-out removal or equivalent non-production fixture.
- Observe the next scheduled reconciliation.
- Confirm failure alerting for token expiry/misconfiguration.

## Completion Evidence

- Test/build/lint output.
- Applied migration identifiers.
- Redacted screenshots or structured safe output for preview, dry run, first sync, Meta status, and zero-diff rerun.
- Confirmation that no raw email, phone, or access token appears in logs/history.
- Final Skale Club configuration and selected ad account recorded without credential values.

## Execution Record (2026-08-11)

| Gate | Result | Evidence / disposition |
|------|--------|------------------------|
| Phase-targeted tests | PASS | 66/66 across 11 Meta audience, Xcraper ingest, opt-out, provider, schema, and reconciliation files. |
| Targeted lint | PASS | Every file changed by Plans 138-01 through 138-06 passes ESLint with zero warnings. |
| Production build | PASS | Next.js production build completed and both operator routes compiled. |
| Secret scan | PASS | Gitleaks commit hooks found no leaks; preview/history contracts return counts only. |
| Full repository tests | BASELINE BLOCKED | Safe no-database run reports 56 failures outside Phase 138, primarily stale Supabase mocks. Live-DB mode is not repeated because `.env.local` points at a non-disposable database. |
| Full repository lint | BASELINE BLOCKED | 269 errors and 191 warnings across legacy files; no Phase 138 changed file is implicated. |
| Migration verification | PENDING | Static migration/RLS tests pass; production schema is confirmed pre-1271 and no disposable linked database is currently configured. |

The two repository-wide baseline gates require an explicit operator decision:
fix the unrelated global backlog before rollout, or approve a phase-scoped waiver
based on the green targeted tests, lint, secret scan, and production build. No
production DDL or Meta write occurs before that decision.
