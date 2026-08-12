# Phase 138: Tenant-Safe Meta Prospect Audiences - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning
**Source:** User request plus production/codebase audit

<domain>
## Phase Boundary

Deliver the complete Xcraper-to-Meta Custom Audience lifecycle for the Skale Club organization in Xphere. The phase includes the data model, tenant credential path, eligibility and suppression rules, synchronization engine, operator UI, tests, deployment configuration, and a controlled production backfill. It does not launch paid campaigns or make Icemail mailbox provisioning a dependency.

</domain>

<decisions>
## Implementation Decisions

### Audience scope

- **D-01:** The first production audience is a Skale Club master audience containing eligible Xcraper prospects only; unrelated CRM contacts are never included by default.
- **D-02:** The schema supports multiple audiences per organization from day one, so later saved prospect lists/segments can map to separate Meta audiences without another destructive redesign.
- **D-03:** Xcraper companies remain `accounts`; the solution projects both `accounts` and person-like `contacts` into a shared audience-member shape instead of creating duplicate CRM contacts solely for Meta.

### Identity and data handling

- **D-04:** One source entity produces one audience row with up to two match keys (`EMAIL_SHA256`, `PHONE_SHA256`); missing keys remain empty and duplicate normalized identifiers are collapsed deterministically.
- **D-05:** Company email is read from `accounts.custom_fields.email`, company phone from `accounts.phone`, and contact identity from `contacts.email` plus `contacts.phone_e164 ?? contacts.phone`.
- **D-06:** Raw identifiers may be read only during projection/hashing. Persisted sync membership uses safe fingerprints/hashes and entity references; logs and UI expose counts, never raw values.
- **D-07:** Email verification status is visible in preview and available as an audience rule, but the Skale Club master audience includes all otherwise eligible scraped emails as requested.

### Tenant credentials

- **D-08:** Audience synchronization uses the tenant-owned `ads_connections` Meta connection and selected ad account. `META_SYSTEM_USER_TOKEN` may remain an explicit agency fallback only if later configured, never an implicit default.
- **D-09:** Expired or inaccessible OAuth credentials fail closed. The operator reconnects Meta before launch; the job does not upload through a different tenant or ad account.

### Sync semantics

- **D-10:** Xcraper ingestion marks affected audience scope dirty for low-latency sync, while the hourly job performs reconciliation and recovery.
- **D-11:** Durable membership state drives ADD/REMOVE diffs. Identifier changes remove the old hashes before adding new hashes.
- **D-12:** A run updates successful state only after all batches complete. Partial failures retain retryable work and must not advance a watermark past unsent records.
- **D-13:** Per-audience locking prevents overlapping runs. Repeating an unchanged run produces zero membership operations.

### Consent and removal

- **D-14:** Eligibility excludes DND, unsubscribed, suppressed, archived duplicate, deleted, and rule-ineligible entities. The implementation reconciles the existing mismatch between `dnd_enabled` and `engagement_status = 'unsubscribed'`.
- **D-15:** Real sync requires auditable acceptance of Meta Customer List terms by an authenticated organization operator. Dry-run preview remains available before acceptance.
- **D-16:** Pausing sync never deletes the Meta audience. Destructive deletion is a separate explicit action and is not required for this phase.

### Operator experience

- **D-17:** Meta audiences become discoverable from Integrations and Prospects > Audiences.
- **D-18:** The operator must see a safe preflight preview, selected ad account, credential/expiry status, terms state, last run, counts, and actionable errors before enabling writes.
- **D-19:** Production launch follows dry run -> controlled real sync -> Meta status check -> unchanged reconciliation rerun. The existing eight Xcraper companies are the initial controlled backfill.

### the agent's Discretion

- Exact table and RPC names, provided they remain organization-scoped and idempotent.
- Whether dirty work is represented by an outbox row, queue row, or durable `next_sync_at` field.
- Exact visual layout and wording within existing Xphere design-system conventions.
- Retry schedule and batch size within Meta API limits, provided retries are bounded and observable.

</decisions>

<canonical_refs>
## Canonical References

### Xcraper ingestion

- `C:/Users/Vanildo/Dev/xcraper/backend/src/services/xphere.ts` - Current Xcraper payload and automatic push contract.
- `src/app/api/v1/prospects/route.ts` - Tenant API-key ingestion, company/account storage, and current enrichment-update gap.
- `supabase/migrations/1247_prospect_rows_view.sql` - Existing unified read projection for contact and account prospects.

### Meta audience prototype

- `scripts/meta-audience-sync.ts` - Current contacts-only incremental worker and watermark behavior.
- `src/lib/meta/custom-audiences.ts` - Existing normalization, hashing, batching, ADD, and REMOVE primitives.
- `src/lib/meta/audience-provider.ts` - Current global-token-only provider abstraction.
- `src/lib/ads/meta-oauth.ts` - Existing tenant Meta OAuth and API version.
- `src/app/api/ads/meta/callback/route.ts` - Encrypted per-organization Meta connection persistence.
- `supabase/migrations/1150_meta_audience_config.sql` - Current one-audience-per-org schema.

### Consent and operator UI

- `src/app/api/v1/optout/route.ts` - Existing contact/account opt-out behavior and suppression writes.
- `src/app/(dashboard)/settings/integrations/meta-audience/actions.ts` - Current tenant-scoped configuration actions.
- `src/app/(dashboard)/settings/integrations/meta-audience/meta-audience-form.tsx` - Current unlinked configuration/status UI.
- `src/app/(dashboard)/prospects/actions.ts` - Existing saved prospect audiences and list semantics.

### External contract

- `https://www.facebook.com/legal/terms/customaudience` - Meta Customer List Custom Audiences terms.
- `https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences` - Custom Audience API contract; re-verify current version during execution.

</canonical_refs>

<specifics>
## Specific Ideas

- Initial production audience name: `Skale Club - Xcraper Prospects`.
- Initial tenant: `Skale Club` (`b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5`).
- Initial observed backfill before final suppression preview: eight companies, eight unique phones, four unique emails; email verification states are three `ok` and one `unknown`.
- Current active Meta ad account record is named `Skale Club | U$`, but its OAuth token was expired at audit time and must be reconnected before real sync.
- Current GitHub scheduled workflow reports success while skipping because the global Meta token is absent; the replacement must expose a skipped/misconfigured state as non-successful operational status.

</specifics>

<deferred>
## Deferred Ideas

- Paid campaign creation and budget management.
- Lookalike audience creation after the source audience reaches useful matched volume.
- Cross-platform audience export beyond Meta.
- Automated legal-basis determination.

</deferred>

---

*Phase: 138-tenant-safe-meta-prospect-audiences*
*Context gathered: 2026-08-11*
