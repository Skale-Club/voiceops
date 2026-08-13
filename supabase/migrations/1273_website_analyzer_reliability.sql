-- =============================================================================
-- Migration 1273: Website Analyzer reliability
--
-- Addresses three defects in the Website Analyzer (Playwright) pipeline:
--
-- 1. No guard against duplicate in-flight analyses for the same account. Two
--    scheduler ticks (or a manual re-trigger racing a scheduled run) can both
--    insert a 'pending'/'running' row for the same account_id, wasting a
--    browser run and leaving the "current analysis" ambiguous between two
--    concurrent rows. Fixed with a partial unique index that allows at most
--    one active (pending/running) row per account.
--
-- 2. No recovery from a crashed/redeployed worker. If the Node process dies
--    mid-run (deploy, OOM, crash) a row is left stuck in 'running' forever,
--    which — once (1) is in place — would permanently block that account from
--    ever being re-analyzed. Fixed with reclaim_stale_website_analyses(), a
--    race-safe RPC a cron sweep calls to fail out stale rows.
--
-- 3. No definition of which accounts are eligible for analysis or in what
--    order, so the scheduler either re-scans everything or hand-rolls ad hoc
--    filtering per call site. Fixed with website_analyzer_candidates, a single
--    view encoding "prospect-stage account with a domain and no in-flight
--    analysis."
-- =============================================================================

-- ----- Cleanup FIRST (mandatory) ---------------------------------------------
--
-- The unique index in step 2 fails outright (unique_violation) if production
-- already holds duplicate active rows for any account_id -- which is exactly
-- the bug this migration fixes. Mark all but the newest active row per
-- account as 'failed' before the index is created, so the CREATE UNIQUE INDEX
-- below has a clean slate to build against.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY account_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM public.website_analyses
  WHERE status IN ('pending', 'running')
)
UPDATE public.website_analyses wa
SET status = 'failed',
    error_message = 'Superseded by a newer analysis attempt for the same account (cleaned up by migration 1273).',
    updated_at = now()
FROM ranked
WHERE wa.id = ranked.id
  AND ranked.rn > 1;

-- ----- One active analysis per account ----------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_website_analyses_account_active
  ON public.website_analyses (account_id)
  WHERE status IN ('pending', 'running');

-- ----- Support indexes ---------------------------------------------------------

-- For the stale-analysis sweep (reclaim_stale_website_analyses): find active
-- rows ordered/filtered by how long they've been sitting untouched.
CREATE INDEX IF NOT EXISTS idx_website_analyses_status_updated_at
  ON public.website_analyses (status, updated_at);

-- For resolving "when was this account last analyzed" per-account, ordered by
-- most recent completed analysis first (website_analyzer_candidates below).
CREATE INDEX IF NOT EXISTS idx_website_analyses_account_status_analyzed
  ON public.website_analyses (account_id, status, analyzed_at DESC);

-- For scanning prospect accounts that have a domain -- the base filter of
-- website_analyzer_candidates.
CREATE INDEX IF NOT EXISTS idx_accounts_prospect_with_domain
  ON public.accounts (lifecycle_stage)
  WHERE domain IS NOT NULL AND domain <> '';

-- ----- Stale-run reclamation (service role only) -------------------------------
--
-- Worst-case single run is ~2.5 minutes: two 45s Playwright navigation
-- timeouts plus settle waits, plus two screenshot uploads. A 10 minute
-- default threshold is roughly 4x that margin, and since the cron sweep is
-- expected to run every 10 minutes, a genuinely crashed run is reclaimed
-- within one or two cron ticks -- not left stuck indefinitely.
--
-- The single atomic `UPDATE ... WHERE ... RETURNING` is race-safe under
-- Postgres MVCC: if two callers (or two overlapping cron ticks) try to
-- reclaim the same row concurrently, the first UPDATE to commit changes the
-- row's status away from 'pending'/'running', so the loser's WHERE clause no
-- longer matches when its own UPDATE evaluates -- each row is reclaimed by
-- exactly one caller, with no explicit locking needed.
--
-- Reclaimed rows always move to 'failed', never back to 'pending' -- the
-- worker that owned the row is presumed gone, and re-queuing is a decision
-- for the scheduler (via website_analyzer_candidates), not this function.
--
-- NOTE: the RETURNS TABLE output columns (id, account_id, org_id) share names
-- with columns on public.website_analyses itself. Inside the function body,
-- an unqualified `id`/`account_id`/`org_id` would be ambiguous between the
-- OUT parameter and the table column. The UPDATE aliases the table as `wa`
-- and the RETURNING clause explicitly qualifies every column as `wa.id`,
-- `wa.account_id`, `wa.org_id` to avoid that ambiguity.
CREATE OR REPLACE FUNCTION public.reclaim_stale_website_analyses(
  p_stale_minutes integer DEFAULT 10,
  p_account_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, account_id uuid, org_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.website_analyses wa
  SET status = 'failed',
      error_message = format(
        'Reclaimed: analysis exceeded %s minute stale threshold (process likely crashed or was redeployed mid-run).',
        p_stale_minutes
      ),
      updated_at = now()
  WHERE wa.status IN ('pending', 'running')
    AND wa.updated_at < now() - make_interval(mins => p_stale_minutes)
    AND (p_account_id IS NULL OR wa.account_id = p_account_id)
  RETURNING wa.id, wa.account_id, wa.org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_stale_website_analyses(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_website_analyses(integer, uuid) TO service_role;

-- ----- Scheduler candidate view (service role only) -----------------------------
--
-- Verified against migration 1204 (public.website_analyses) and 1151/064
-- (public.accounts): accounts.lifecycle_stage, accounts.domain, accounts.name,
-- accounts.org_id, accounts.created_at all exist under those exact names.
--
-- Eligible = prospect-stage account, has a non-empty domain, and has no
-- currently active (pending/running) analysis row -- the same "one active
-- analysis" invariant enforced by idx_website_analyses_account_active above.
CREATE OR REPLACE VIEW public.website_analyzer_candidates AS
SELECT
  a.id            AS account_id,
  a.org_id,
  a.domain,
  a.name,
  a.created_at    AS account_created_at,
  (
    SELECT max(wa.analyzed_at)
    FROM public.website_analyses wa
    WHERE wa.account_id = a.id
      AND wa.status = 'completed'
  )               AS last_analyzed_at
FROM public.accounts a
WHERE a.lifecycle_stage = 'prospect'
  AND a.domain IS NOT NULL
  AND a.domain <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.website_analyses wa2
    WHERE wa2.account_id = a.id
      AND wa2.status IN ('pending', 'running')
  );

REVOKE ALL ON public.website_analyzer_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_analyzer_candidates TO service_role;
