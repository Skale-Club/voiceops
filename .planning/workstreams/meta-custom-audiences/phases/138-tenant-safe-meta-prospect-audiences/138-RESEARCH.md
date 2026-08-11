# Phase 138: Tenant-Safe Meta Prospect Audiences - Research

**Researched:** 2026-08-11
**Confidence:** High for the local architecture and production-state findings; current Meta API version compatibility must be revalidated during execution.

## Summary

Xphere already contains most primitives required to create and update Meta Customer List Custom Audiences, but they are disconnected from the current prospect model and from the tenant-owned Meta OAuth connection. The current hourly worker reads every eligible row in `contacts`, ignores `accounts`, depends on an absent global token, and can advance its watermark after query errors. Xcraper deliberately writes Google Maps businesses as `accounts`, placing email in `custom_fields.email` and phone in `phone`, so the present worker cannot see the eight Skale Club barbershops.

The correct implementation is not a patch that adds a second accounts query to the existing script. It needs a durable, organization-scoped audience model and membership ledger so additions, identifier changes, suppressions, and removals are deterministic and retry-safe. The existing hashing/Graph request primitives can be retained behind a current-version contract test.

## Current Production Findings

- Skale Club has eight `source_type = 'xcraper'` company prospects: eight unique phones and four unique emails.
- Three scraped emails are verified `ok`; one is `unknown`.
- `meta_audience_config` has no row for Skale Club, so no audience is configured or enabled.
- Xphere has an active Meta ads connection named `Skale Club | U$`, but the stored OAuth expiry was 2026-08-02 at audit time.
- The GitHub workflow runs hourly but no-ops because `META_SYSTEM_USER_TOKEN` is absent. `SUPABASE_SERVICE_ROLE_KEY` is also absent from repository secrets even though the job expects it.
- If the current worker were enabled without a source filter, its first run would target approximately 5,624 general CRM contacts rather than the intended Xcraper prospects.

## Recommended Architecture

### 1. Audience configuration and membership ledger

Replace the one-row-per-org constraint with one-row-per-audience. Store `org_id`, selected `ads_connection_id`/ad account, remote audience ID, audience kind (`xcraper_master` or `prospect_segment`), source definition, enabled state, terms audit fields, and operational state.

Add durable membership keyed by `(audience_config_id, entity_type, entity_id)`. Store the last successfully submitted email/phone hashes and an eligibility fingerprint. This ledger makes identifier changes and removals possible even after the source record changes or disappears.

Add durable run history and a concurrency primitive. Each run records start/end/status, target/add/remove/invalid/suppressed counts, retry metadata, and safe error code/message. Never store raw email/phone or access tokens.

### 2. Shared member projector

Build a pure projector that reads an entity and returns either an eligible member or an exclusion reason. It must support both contacts and accounts, normalize identifiers using the canonical contact/phone utilities, apply source/list rules, enforce opt-out/suppression, and emit safe hashes/fingerprints.

Do not reuse `prospect_rows` alone for compliance decisions because it omits DND/suppression fields. It can inform query shape, while eligibility must query the canonical base tables and suppression sources.

### 3. Per-tenant connection provider

Implement an `OrgOAuthProvider` over `ads_connections`: query by the audience's `org_id` and explicit connection/ad account, require `platform = 'meta'` and `status = 'active'`, reject expired tokens, decrypt only at execution time, and return the token without logging it. Keep agency-system-user fallback opt-in and explicit.

### 4. Reconciliation algorithm

For a locked audience:

1. Capture run start and load configuration/credential preconditions.
2. Stream eligible source entities in a stable `(updated_at, id)` order or create a bounded snapshot.
3. Project, normalize, hash, and deduplicate current membership.
4. Diff current membership against the last successful ledger.
5. Submit REMOVEs for stale/changed hashes, then ADDs for new/changed hashes, in bounded batches.
6. Commit ledger and last-success state only after all remote operations succeed.
7. On failure, retain the previous ledger and retryable run state.

Event-driven dirty marking after Xcraper ingestion lowers latency. Hourly full reconciliation is still necessary for missed events, suppressions, and drift.

### 5. Consent and opt-out

The existing opt-out route updates `engagement_status` but the prototype worker removes only `dnd_enabled = true`. The new projector must treat both as exclusions and consult email suppressions. Account email-only opt-out also needs to match `accounts.custom_fields.email`, not just phone.

Meta terms require the advertiser to have the necessary rights, permissions, and lawful basis. The product should require an attributable acceptance record before real sync and make the data scope visible in preflight.

### 6. Operator workflow

The UI should guide the operator through:

1. Reconnect/check Meta credentials.
2. Select the tenant-owned ad account.
3. Choose master Xcraper or saved-segment scope.
4. Review a safe preview of included/excluded counts.
5. Accept terms.
6. Save, dry run, then enable/perform real sync.
7. Inspect run history and repair token/config failures.

The route must be linked from both Integrations and Prospect Audiences. A hidden settings URL is insufficient for production operations.

## Risks and Required Mitigations

| Risk | Mitigation |
|------|------------|
| Cross-tenant upload | Explicit `org_id` on every service-role query plus tenant isolation tests. |
| Uploading the entire CRM | Source rule defaults to `xcraper_master`; preview and tests assert unrelated contacts are excluded. |
| Lost removals after identifier change | Persist last submitted hashes in the membership ledger. |
| Watermark skips after failure | Commit successful state only in the post-success transaction. |
| Expired/wrong Meta token | Resolve explicit tenant connection, fail closed, expose reconnect action. |
| False-green scheduled jobs | Missing configuration yields visible `misconfigured` run/failure, not a successful no-op. |
| Raw PII/token leakage | Hash locally; structured safe logs; tests scan request/log payloads. |
| Duplicate concurrent jobs | Per-audience advisory lock/claim with stale-run recovery. |
| Meta API version drift | Validate current supported version and request schema before deployment. |
| Too-small matched audience | Backfill safely, display Meta status, and communicate that delivery may require more matched people. |

## Validation Architecture

### Automated

- Pure unit tests for normalization, hash pairing, source filters, suppression, deduplication, and membership diffs.
- Route/service tests for Xcraper account updates, org-scoped configuration, preview, enablement, and manual sync authorization.
- Worker tests for lock, retry, batch boundaries, failure-before-commit, identifier-change REMOVE+ADD, and unchanged rerun zero-diff.
- Meta transport tests for POST/DELETE, current API version, redaction, and error mapping.
- Database/RLS tests proving organization isolation and uniqueness/idempotency constraints.

### Production-safe

- Skale Club preview compared with direct source counts.
- Dry run produces no Meta writes and reports expected eight entities before final suppression filtering.
- Controlled real backfill records accepted rows and remote audience ID.
- Immediate unchanged reconciliation produces zero ADD/REMOVE operations.
- Synthetic opt-out test removes one controlled identifier, followed by restoration/cleanup if authorized.
- Scheduled job observation proves the next hourly reconciliation runs and surfaces token/config errors.

## Planning Recommendation

Use seven plans in four waves: schema/ledger and pure projector first; tenant provider, Xcraper enrichment, and reconciliation second; UI/observability third; production rollout and evidence last. Treat the production migration and real Meta synchronization as explicit operator checkpoints after automated gates pass.
