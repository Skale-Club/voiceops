# Roadmap: Meta Custom Audiences for Xcraper Prospects

## Overview

This workstream makes every eligible email and phone collected by Xcraper available to Meta Custom Audiences through the correct Xphere organization and Meta ad account. It replaces the disconnected, contacts-only, global-token prototype with an organization-scoped, consent-aware, observable synchronization pipeline.

## Phases

- [ ] **Phase 138: Tenant-Safe Meta Prospect Audiences** - Build, deploy, and prove the complete Xcraper -> Xphere -> Meta Custom Audience lifecycle for the Skale Club tenant. (DATA-01..03, TEN-01..03, AUD-01..03, SYNC-01..04, COMP-01..03, UX-01..03, OPS-01..03, TEST-01..03, LAUNCH-01..03)

## Phase Details

### Phase 138: Tenant-Safe Meta Prospect Audiences

**Goal**: Every eligible Xcraper identifier for Skale Club is deterministically included in the intended Meta Custom Audience, withdrawals and data changes are reconciled safely, and operators can prove the result without exposing raw personal data.

**Depends on**: Nothing

**Requirements**: DATA-01, DATA-02, DATA-03, TEN-01, TEN-02, TEN-03, AUD-01, AUD-02, AUD-03, SYNC-01, SYNC-02, SYNC-03, SYNC-04, COMP-01, COMP-02, COMP-03, UX-01, UX-02, UX-03, OPS-01, OPS-02, OPS-03, TEST-01, TEST-02, TEST-03, LAUNCH-01, LAUNCH-02, LAUNCH-03

**Success Criteria**:

1. A dry run for Skale Club selects exactly the eligible `source_type = 'xcraper'` company/person prospects, including email from `accounts.custom_fields.email` and phone from `accounts.phone`, without selecting unrelated CRM contacts.
2. The sync uses the Meta connection and selected ad account owned by the Skale Club organization; an expired, missing, or cross-organization token fails closed before any upload.
3. The system supports a tenant master audience and optional saved-segment audiences, hashes normalized identifiers locally, and records only safe counts/errors in operational logs.
4. Adds, identifier changes, DND, unsubscribe, suppression, and deletion produce deterministic Meta ADD/REMOVE operations; the successful watermark never advances after a partial or failed run.
5. Xcraper ingestion updates enrichment fields on existing company prospects and marks affected audiences dirty; an hourly reconciliation remains as a recovery path.
6. Operators can preview membership, enable/disable sync, run a manual dry run, request a real sync, inspect history and actionable errors, and identify token/terms problems from Xphere.
7. Automated tests cover normalization, membership, deduplication, tenant isolation, opt-out removal, retry/idempotency, account enrichment updates, and Meta request contracts.
8. Production deployment applies migrations and secrets safely, reconnects the Skale Club Meta account, creates the intended audience, and records a successful controlled backfill of the current eight Xcraper businesses.

---

*Workstream created: 2026-08-11*
