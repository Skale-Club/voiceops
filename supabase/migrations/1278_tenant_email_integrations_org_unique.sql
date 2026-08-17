-- Migration 1278: unique index on tenant_email_integrations(org_id)
--
-- The table (1076_tenant_email_integrations.sql) never got a uniqueness
-- constraint on org_id — only the PK on id. Every reader assumes exactly one
-- row per org and uses `.single()` (src/lib/email/resend.ts sendTenantEmail,
-- src/app/(dashboard)/settings/email/actions.ts getTenantEmailIntegration and
-- the save path). A second row for the same org would make `.single()` throw
-- a "multiple rows" error and silently disable email sending for that org.
--
-- Production currently has exactly one row per org (2 orgs, 2 rows), so no
-- dedup step is needed — this is written defensively (IF NOT EXISTS) in case
-- it's re-run or another migration created the index first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_email_integrations_org_id
  ON public.tenant_email_integrations (org_id);
