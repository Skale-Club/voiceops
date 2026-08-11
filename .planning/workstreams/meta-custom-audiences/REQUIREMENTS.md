# Requirements: Meta Custom Audiences for Xcraper Prospects

**Defined:** 2026-08-11

**Core Value:** Every eligible identifier collected by Xcraper must reach the intended Meta audience through the correct Xphere tenant, with deterministic removals, tenant isolation, and operational proof.

## Data Contract

- [x] **DATA-01**: Audience membership includes organization-scoped Xcraper prospects stored as either `contacts` or `accounts`, reading company email from `accounts.custom_fields.email` and company phone from `accounts.phone`.
- [x] **DATA-02**: Email and phone identifiers are normalized, deduplicated, paired by entity, and SHA-256 hashed inside Xphere before transmission; raw identifiers never appear in Meta requests, job logs, or sync history.
- [x] **DATA-03**: Re-importing an existing Xcraper company updates mergeable enrichment fields, including `custom_fields.email`, website, address/category metadata, and source payload, without overwriting stronger CRM data with nulls.

## Tenant Connection

- [x] **TEN-01**: Meta audience operations resolve credentials from the active `ads_connections` row belonging to the same `org_id` as the audience; the global agency token is not the default runtime path.
- [x] **TEN-02**: The selected Meta ad account is explicit, organization-owned, active, and token-valid; missing, expired, inaccessible, or mismatched credentials fail closed with an actionable status.
- [x] **TEN-03**: RLS, service-role queries, background jobs, and mutations enforce organization scope explicitly and have regression coverage proving one tenant cannot inspect or sync another tenant's audience.

## Audience Model

- [x] **AUD-01**: One organization may configure multiple Meta audiences, including one master Xcraper audience and optional audiences backed by Xphere saved prospect segments/lists.
- [x] **AUD-02**: Audience configuration records Meta audience ID, ad account, name, source rule, consent acceptance, enablement, last successful state, and immutable organization ownership.
- [x] **AUD-03**: Audience creation is idempotent; disabling synchronization pauses writes without deleting the Meta audience, while destructive deletion requires a separate explicit operator action.

## Synchronization

- [x] **SYNC-01**: Successful Xcraper ingestion marks relevant audiences dirty or enqueues an organization-scoped sync; hourly reconciliation repairs missed events and drift.
- [x] **SYNC-02**: Synchronization calculates additions and removals from durable membership state, including identifier changes, and sends Meta operations in bounded retryable batches.
- [x] **SYNC-03**: A run is idempotent, concurrency-safe, retryable, and advances its successful watermark/snapshot only after every required batch succeeds.
- [x] **SYNC-04**: Sync history stores safe counts, run status, timestamps, retry/error codes, and correlation IDs; failures can be retried without duplicating or losing membership.

## Consent and Suppression

- [x] **COMP-01**: DND, `engagement_status = 'unsubscribed'`, email suppression, archived duplicate, and deleted/ineligible records are excluded and removed from previously synchronized audiences.
- [x] **COMP-02**: Customer List Custom Audience terms acceptance is organization-scoped, timestamped, attributable to an authenticated operator, and required before real synchronization.
- [x] **COMP-03**: Membership rules expose email-verification status for preview/filtering but do not silently discard scraped identifiers unless the configured audience rule explicitly requires verified email.

## Operator Experience

- [ ] **UX-01**: Meta Custom Audiences is discoverable from Xphere integrations and prospect audiences rather than existing only as an unlinked route.
- [ ] **UX-02**: Before activation, the operator can preview entity count, unique emails, unique phones, suppressed count, invalid count, source/list scope, and the selected ad account without exposing raw values.
- [ ] **UX-03**: The UI provides save, enable/pause, dry run, manual sync, status/history, token expiry, terms state, and actionable error recovery.

## Operations

- [x] **OPS-01**: The supported Meta Graph/Marketing API version and Customer List request contract are verified against current official documentation before production activation.
- [ ] **OPS-02**: Required secrets and runtime configuration are provisioned in the actual execution environment; scheduled jobs must not report success when synchronization was skipped for missing configuration.
- [x] **OPS-03**: Database migrations are idempotent, applied to production before application rollout, and paired with rollback/recovery instructions that preserve audience membership state.

## Verification

- [x] **TEST-01**: Unit tests cover normalization/hashing, entity projection, eligibility/suppression, membership diffing, batching, retries, and watermark failure behavior.
- [x] **TEST-02**: Integration tests cover company re-import enrichment, per-tenant connection resolution, RLS/service-role scoping, job concurrency, and Meta ADD/REMOVE request contracts with no token or raw PII leakage.
- [ ] **TEST-03**: A production-safe validation path performs a Skale Club dry run, controlled real sync, Meta status check, and reconciliation rerun with unchanged membership.

## Launch

- [ ] **LAUNCH-01**: The Skale Club Meta OAuth connection is refreshed and the intended Skale Club ad account is selected explicitly.
- [ ] **LAUNCH-02**: The master audience is created and the current eight Xcraper companies are backfilled as eight entity rows carrying eight unique phones and four unique emails, subject to final suppression/eligibility preview.
- [ ] **LAUNCH-03**: Post-launch monitoring confirms scheduled reconciliation, zero cross-tenant records, successful opt-out removal, and an operator-visible alert on token expiry or repeated failure.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Creating or launching paid ad campaigns | This workstream creates and maintains audiences only. |
| Inferring legal permission from public availability | The organization must establish the applicable rights, permissions, and lawful basis. |
| Using Icemail mailbox readiness as an audience dependency | Mailbox provisioning affects outbound email, not Meta audience synchronization. |
| Automatically deleting Meta audiences when a config is disabled | Destructive deletion remains an explicit operator action. |

## Traceability

All requirements map to Phase 138.

**Coverage:** 28 requirements, 28 mapped, 0 unmapped.
