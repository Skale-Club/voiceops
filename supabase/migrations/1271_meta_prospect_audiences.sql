-- 1271: Tenant-safe Meta prospect audiences.
--
-- Evolves the original one-audience-per-org prototype without replacing the
-- table, then adds a hash-only membership ledger and auditable sync runs.
-- Raw email addresses, phone numbers, and access tokens are intentionally not
-- persisted in any audience synchronization table.

-- ----- Evolve meta_audience_config without losing existing rows -------------

ALTER TABLE public.meta_audience_config
  ADD COLUMN IF NOT EXISTS ads_connection_id uuid,
  ADD COLUMN IF NOT EXISTS audience_kind text NOT NULL DEFAULT 'xcraper_master',
  ADD COLUMN IF NOT EXISTS source_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_accepted_by uuid,
  ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS dirty_at timestamptz,
  ADD COLUMN IF NOT EXISTS dirty_reason text,
  ADD COLUMN IF NOT EXISTS next_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_claim_id uuid,
  ADD COLUMN IF NOT EXISTS sync_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text;

-- The legacy migration made org_id globally unique. Remove any single-column
-- uniqueness constraint on org_id regardless of its generated name.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public.meta_audience_config'::regclass
      AND c.contype = 'u'
      AND cardinality(c.conkey) = 1
      AND a.attname = 'org_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.meta_audience_config DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_audience_config_ads_connection_id_fkey'
      AND conrelid = 'public.meta_audience_config'::regclass
  ) THEN
    ALTER TABLE public.meta_audience_config
      ADD CONSTRAINT meta_audience_config_ads_connection_id_fkey
      FOREIGN KEY (ads_connection_id)
      REFERENCES public.ads_connections(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_audience_config_terms_accepted_by_fkey'
      AND conrelid = 'public.meta_audience_config'::regclass
  ) THEN
    ALTER TABLE public.meta_audience_config
      ADD CONSTRAINT meta_audience_config_terms_accepted_by_fkey
      FOREIGN KEY (terms_accepted_by)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_audience_config_audience_kind_check'
      AND conrelid = 'public.meta_audience_config'::regclass
  ) THEN
    ALTER TABLE public.meta_audience_config
      ADD CONSTRAINT meta_audience_config_audience_kind_check
      CHECK (audience_kind IN ('xcraper_master', 'prospect_segment'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meta_audience_config_operational_status_check'
      AND conrelid = 'public.meta_audience_config'::regclass
  ) THEN
    ALTER TABLE public.meta_audience_config
      ADD CONSTRAINT meta_audience_config_operational_status_check
      CHECK (operational_status IN (
        'draft', 'ready', 'dirty', 'syncing', 'synced',
        'paused', 'misconfigured', 'error'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_audience_config_org_id_id
  ON public.meta_audience_config (org_id, id);

CREATE INDEX IF NOT EXISTS idx_meta_audience_config_org_status
  ON public.meta_audience_config (org_id, sync_enabled, operational_status);

CREATE INDEX IF NOT EXISTS idx_meta_audience_config_due
  ON public.meta_audience_config (next_sync_at)
  WHERE sync_enabled = true AND dirty_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_audience_config_remote_audience
  ON public.meta_audience_config (org_id, meta_ad_account_id, custom_audience_id)
  WHERE custom_audience_id IS NOT NULL;

-- ----- Durable successful membership -----------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_audience_memberships (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  audience_config_id      uuid        NOT NULL,
  entity_type             text        NOT NULL CHECK (entity_type IN ('contact', 'account')),
  entity_id               uuid        NOT NULL,
  submitted_email_hash    text,
  submitted_phone_hash    text,
  eligibility_fingerprint text        NOT NULL,
  last_synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_audience_memberships_config_fkey
    FOREIGN KEY (org_id, audience_config_id)
    REFERENCES public.meta_audience_config(org_id, id)
    ON DELETE CASCADE,
  CONSTRAINT meta_audience_memberships_entity_unique
    UNIQUE (audience_config_id, entity_type, entity_id),
  CONSTRAINT meta_audience_memberships_identifier_check
    CHECK (num_nonnulls(submitted_email_hash, submitted_phone_hash) > 0),
  CONSTRAINT meta_audience_memberships_email_hash_check
    CHECK (submitted_email_hash IS NULL OR submitted_email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT meta_audience_memberships_phone_hash_check
    CHECK (submitted_phone_hash IS NULL OR submitted_phone_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT meta_audience_memberships_fingerprint_check
    CHECK (eligibility_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_meta_audience_memberships_org_config
  ON public.meta_audience_memberships (org_id, audience_config_id);

CREATE INDEX IF NOT EXISTS idx_meta_audience_memberships_entity
  ON public.meta_audience_memberships (org_id, entity_type, entity_id);

-- ----- Auditable, retryable runs ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_audience_sync_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  audience_config_id uuid        NOT NULL,
  trigger_source     text        NOT NULL DEFAULT 'scheduled'
    CHECK (trigger_source IN ('manual', 'scheduled', 'ingestion', 'retry')),
  dry_run            boolean     NOT NULL DEFAULT false,
  status             text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  claim_id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  target_count       integer     NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  add_count          integer     NOT NULL DEFAULT 0 CHECK (add_count >= 0),
  remove_count       integer     NOT NULL DEFAULT 0 CHECK (remove_count >= 0),
  unchanged_count    integer     NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  invalid_count      integer     NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  suppressed_count   integer     NOT NULL DEFAULT 0 CHECK (suppressed_count >= 0),
  retry_count        integer     NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at      timestamptz,
  error_code         text,
  error_message      text,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_audience_sync_runs_config_fkey
    FOREIGN KEY (org_id, audience_config_id)
    REFERENCES public.meta_audience_config(org_id, id)
    ON DELETE CASCADE,
  CONSTRAINT meta_audience_sync_runs_claim_unique UNIQUE (claim_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_audience_sync_runs_org_config
  ON public.meta_audience_sync_runs (org_id, audience_config_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_audience_sync_runs_retry
  ON public.meta_audience_sync_runs (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- ----- Updated-at triggers ---------------------------------------------------

DROP TRIGGER IF EXISTS meta_audience_memberships_updated_at
  ON public.meta_audience_memberships;
CREATE TRIGGER meta_audience_memberships_updated_at
  BEFORE UPDATE ON public.meta_audience_memberships
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

DROP TRIGGER IF EXISTS meta_audience_sync_runs_updated_at
  ON public.meta_audience_sync_runs;
CREATE TRIGGER meta_audience_sync_runs_updated_at
  BEFORE UPDATE ON public.meta_audience_sync_runs
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- ----- Tenant isolation ------------------------------------------------------

ALTER TABLE public.meta_audience_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_audience_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_audience_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_audience_config_select ON public.meta_audience_config;
DROP POLICY IF EXISTS meta_audience_config_insert ON public.meta_audience_config;
DROP POLICY IF EXISTS meta_audience_config_update ON public.meta_audience_config;
DROP POLICY IF EXISTS meta_audience_config_delete ON public.meta_audience_config;

CREATE POLICY meta_audience_config_select ON public.meta_audience_config
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_config_insert ON public.meta_audience_config
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_config_update ON public.meta_audience_config
  FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_config_delete ON public.meta_audience_config
  FOR DELETE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS meta_audience_memberships_select ON public.meta_audience_memberships;
DROP POLICY IF EXISTS meta_audience_memberships_insert ON public.meta_audience_memberships;
DROP POLICY IF EXISTS meta_audience_memberships_update ON public.meta_audience_memberships;
DROP POLICY IF EXISTS meta_audience_memberships_delete ON public.meta_audience_memberships;

CREATE POLICY meta_audience_memberships_select ON public.meta_audience_memberships
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_memberships_insert ON public.meta_audience_memberships
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_memberships_update ON public.meta_audience_memberships
  FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_memberships_delete ON public.meta_audience_memberships
  FOR DELETE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS meta_audience_sync_runs_select ON public.meta_audience_sync_runs;
DROP POLICY IF EXISTS meta_audience_sync_runs_insert ON public.meta_audience_sync_runs;
DROP POLICY IF EXISTS meta_audience_sync_runs_update ON public.meta_audience_sync_runs;
DROP POLICY IF EXISTS meta_audience_sync_runs_delete ON public.meta_audience_sync_runs;

CREATE POLICY meta_audience_sync_runs_select ON public.meta_audience_sync_runs
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_sync_runs_insert ON public.meta_audience_sync_runs
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_sync_runs_update ON public.meta_audience_sync_runs
  FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
CREATE POLICY meta_audience_sync_runs_delete ON public.meta_audience_sync_runs
  FOR DELETE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.meta_audience_memberships IS
  'Last successfully submitted hash-only membership for deterministic Meta audience diffs.';
COMMENT ON TABLE public.meta_audience_sync_runs IS
  'Safe operational history for dry-run and real Meta audience reconciliation.';
