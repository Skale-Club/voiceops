-- =============================================================================
-- Migration 1281: campaign_recipients unique (campaign_id, contact_id)
--
-- campaign_recipients has no write path today (nothing enrolls recipients),
-- so this migration closes that gap defensively: a unique index makes
-- enrollment idempotent (INSERT ... ON CONFLICT DO NOTHING) so a repeated
-- launch (or a retried enrollment call) can never double-enroll a contact
-- into the same campaign.
--
-- ASSUMPTION (stated per orchestrator instruction, not re-derived here):
-- production currently has ZERO rows in campaign_recipients — nothing has
-- ever written to this table — so no pre-migration dedup step is needed.
-- If that assumption ever stops holding, add a dedup CTE (keep earliest
-- `created_at` per (campaign_id, contact_id)) before creating the index.
--
-- Plain (non-partial) unique index. contact_id is nullable (ON DELETE SET
-- NULL), but a standard btree unique index already treats every NULL as
-- distinct from every other NULL, so multiple (campaign_id, NULL) rows stay
-- legal without a WHERE clause. Keeping it non-partial also matters for
-- enroll-recipients.ts: it upserts with `onConflict: 'campaign_id,contact_id'`
-- + ignoreDuplicates, and Postgres can only infer a partial index as an
-- ON CONFLICT arbiter when the statement repeats that index's WHERE clause
-- (which supabase-js's upsert() has no option to do) — so a plain index is
-- what the idempotent insert actually needs.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_contact_unique
  ON public.campaign_recipients (campaign_id, contact_id);
