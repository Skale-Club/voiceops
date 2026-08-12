# Phase 138 - Existing Pattern Map

| New responsibility | Closest existing analog | Reuse / correction |
|--------------------|-------------------------|--------------------|
| Xcraper company projection | `supabase/migrations/1247_prospect_rows_view.sql` | Reuse account email/phone mapping; add compliance fields from base tables. |
| Prospect API ingestion | `src/app/api/v1/prospects/route.ts` | Preserve API-key org scope; merge custom fields/source payload on existing company. |
| Meta hashing/batching | `src/lib/meta/custom-audiences.ts` | Reuse primitives; validate current API schema/version and redaction. |
| Tenant Meta credentials | `src/app/api/ads/meta/callback/route.ts`, `src/app/(dashboard)/ads/capi/actions.ts` | Reuse encrypted `ads_connections` lookup/decrypt pattern. |
| Sync job | `scripts/meta-audience-sync.ts` | Replace contacts-only watermark scan with ledger-backed reconciliation. |
| Per-org config actions | `src/app/(dashboard)/settings/integrations/meta-audience/actions.ts` | Preserve authenticated RLS context; move to multiple config rows and explicit selected connection. |
| Opt-out | `src/app/api/v1/optout/route.ts` | Treat DND, engagement unsubscribe, and suppression consistently; match account custom-field email. |
| Saved prospect segments | `src/app/(dashboard)/prospects/actions.ts` | Map saved audience/list definitions to optional Meta configurations. |
| Scheduled automation | `.github/workflows/meta-audience-sync.yml` | Keep reconciliation schedule; remove false-green missing-config behavior. |
| UI status/history | Existing integration cards and status forms | Link route, add preflight counts, dry run, history, and recovery actions. |
