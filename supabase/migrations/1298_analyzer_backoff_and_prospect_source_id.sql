-- =============================================================================
-- Migration 1298: Website Analyzer backoff (Fase 33 — Xphere part)
--
-- Evidence: the analyzer cron retried `https://gubarbershop.com` -- which does
-- not resolve DNS (`net::ERR_NAME_NOT_RESOLVED`) -- 432 times in three days,
-- every 10 minutes, occupying one of the ~10 analyzer slots per tick. Today's
-- Boston run added five more parked `.top` domains that would do the same.
-- Nothing distinguished a permanently broken domain from a one-off network
-- hiccup, and each attempt was a brand-new row with no memory of prior
-- failures.
--
-- This migration:
--   1. Adds `attempts` and `next_attempt_at` to website_analyses so retry
--      state survives across the fresh row each cron tick inserts.
--   2. Adds a `dead` terminal status alongside the existing
--      pending/running/completed/failed, for permanent failures and for
--      transient failures that exhausted their retry budget.
--   3. Teaches `reclaim_stale_website_analyses` (migration 1273) the same
--      backoff schedule the TS side uses (src/services/website-analyzer/
--      retry-classification.ts): a stale/crashed-worker reclaim is a
--      transient failure, retried up to 3 times with backoff of 10, 60, then
--      360 minutes, then `dead`.
--   4. Rewrites `website_analyzer_candidates` (migration 1273) to exclude
--      accounts whose latest analysis row is `dead` (permanent, never retry)
--      or `failed` with `next_attempt_at` still in the future (waiting out
--      backoff), and to skip prospects whose web_presence_type is anything
--      other than `owned_website` (Xcraper now classifies junk TLDs and
--      directory/booking-platform domains as something else -- there is
--      nothing to analyze there). It also exposes `last_attempts` so the
--      cron can carry the attempt count forward into the new row it inserts.
-- =============================================================================

-- ----- 1. New columns ---------------------------------------------------------

ALTER TABLE public.website_analyses
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON COLUMN public.website_analyses.attempts IS
  'Cumulative failure count for this account, carried forward across rows by the cron (website_analyzer_candidates.last_attempts). Not reset per-row.';
COMMENT ON COLUMN public.website_analyses.next_attempt_at IS
  'Earliest time this account is eligible for another analysis attempt after a transient failure. NULL means either never attempted, completed, or terminal (dead).';

-- ----- 2. `dead` terminal status ------------------------------------------------
--
-- The original CHECK from migration 1204 had no explicit name, so Postgres
-- assigned the default `<table>_<column>_check`.

ALTER TABLE public.website_analyses
  DROP CONSTRAINT IF EXISTS website_analyses_status_check;

ALTER TABLE public.website_analyses
  ADD CONSTRAINT website_analyses_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'dead'));

-- ----- 3. Support index for the candidate view's per-account "latest row" ------
--
-- website_analyzer_candidates (rewritten below) does a LATERAL "most recent
-- row per account" lookup ordered by created_at DESC; this index makes that
-- an index scan instead of a per-account sort of every row.

CREATE INDEX IF NOT EXISTS idx_website_analyses_account_created_at
  ON public.website_analyses (account_id, created_at DESC);

-- ----- 4. Backoff-aware stale-run reclamation ----------------------------------
--
-- A row reclaimed here means the worker that owned it is presumed gone
-- (crashed or redeployed mid-run) -- not that the domain itself is broken.
-- That is exactly the "transient" failure class from retry-classification.ts,
-- so it gets the same three-strike backoff: attempt 1 -> retry in 10 minutes,
-- attempt 2 -> 60 minutes, attempt 3 -> 360 minutes, attempt 4 -> `dead`.
-- Keep this CASE expression's thresholds in sync with MAX_TRANSIENT_ATTEMPTS
-- and BACKOFF_MINUTES in src/services/website-analyzer/retry-classification.ts.
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
  SET
    attempts = wa.attempts + 1,
    status = CASE WHEN wa.attempts + 1 > 3 THEN 'dead' ELSE 'failed' END,
    next_attempt_at = CASE
      WHEN wa.attempts + 1 > 3 THEN NULL
      WHEN wa.attempts + 1 = 1 THEN now() + interval '10 minutes'
      WHEN wa.attempts + 1 = 2 THEN now() + interval '60 minutes'
      ELSE now() + interval '360 minutes'
    END,
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

-- ----- 5. Candidate view: respect dead/backoff + web_presence_type -------------
--
-- Eligible = prospect-stage account, non-empty domain, web_presence_type is
-- either unset or `owned_website` (Xcraper classifies junk TLDs, directories
-- and booking-platform subdomains as something else -- see Fase 33's Xcraper
-- part), and the account's MOST RECENT analysis row (if any) is neither:
--   - pending/running (still in flight -- unchanged from migration 1273), nor
--   - dead (permanent failure -- never retry), nor
--   - failed with next_attempt_at still in the future (backing off).
-- `last_attempts` carries the latest row's attempt count forward so the cron
-- can set it on the new row it inserts, keeping the count cumulative.
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
  )               AS last_analyzed_at,
  COALESCE(latest.attempts, 0) AS last_attempts
FROM public.accounts a
LEFT JOIN LATERAL (
  SELECT wa2.status, wa2.attempts, wa2.next_attempt_at
  FROM public.website_analyses wa2
  WHERE wa2.account_id = a.id
  ORDER BY wa2.created_at DESC
  LIMIT 1
) latest ON true
WHERE a.lifecycle_stage = 'prospect'
  AND a.domain IS NOT NULL
  AND a.domain <> ''
  AND (
    a.custom_fields->>'web_presence_type' IS NULL
    OR a.custom_fields->>'web_presence_type' = 'owned_website'
  )
  AND (latest.status IS NULL OR latest.status NOT IN ('pending', 'running', 'dead'))
  AND (
    latest.status IS DISTINCT FROM 'failed'
    OR latest.next_attempt_at IS NULL
    OR latest.next_attempt_at <= now()
  );

REVOKE ALL ON public.website_analyzer_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_analyzer_candidates TO service_role;

-- =============================================================================
-- Fase 34 (Xphere part) — direct run linkage for prospects_verify
--
-- Evidence: verifying the 98 prospects from three real runs required calling
-- prospects_enroll_in_campaign WITHOUT `confirmed` (a dry run), because that
-- was the only thing that verified anything, and it has no per-run filter —
-- the output had to be split back apart by `created_at` window per run.
--
-- Why the link was missing: `contacts.source_id` / `accounts.source_id` hold
-- the SOURCE's own identifier for the record (e.g. a Google place id for an
-- xcraper scrape) — see migration 1151 — not a reference to the
-- `prospect_sources` row (the RUN) that ingested it. The only existing path
-- from a prospect back to its run is indirect and lossy:
-- `loadSourceRunIdsForEntities` (src/lib/xmail/source-runs.ts) reads the most
-- recent `prospect_engagement_events` row of type 'imported' for the entity
-- and follows `payload.source_run_id` (a `prospect_sources.id`) through to
-- `prospect_sources.external_run_id`. That works ENTITY -> RUN for one
-- prospect at a time, but there is no reverse index to answer "give me every
-- prospect for RUN X" other than scanning that events table per entity or
-- falling back to a `created_at` time window (what the manual verification
-- had to do) -- neither is a query prospects_verify can build a WHERE clause
-- on cheaply or reliably (concurrent runs, backfills, and re-imports all
-- break the time-window heuristic).
--
-- Fix: a direct, nullable FK column on the tables `prospect_rows` reads from
-- (contacts, accounts), populated going forward at ingestion time
-- (POST /api/v1/prospects, src/app/api/v1/prospects/route.ts, which already
-- has `runId` — the `prospect_sources.id` — in hand for every insert/update).
-- Historical rows ingested before this migration keep prospect_source_id NULL;
-- prospects_verify falls back to filtering by `source_type` alone for those.
-- =============================================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS prospect_source_id uuid REFERENCES public.prospect_sources(id) ON DELETE SET NULL;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS prospect_source_id uuid REFERENCES public.prospect_sources(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contacts.prospect_source_id IS
  'The prospect_sources row (run) that ingested this prospect. Populated by POST /api/v1/prospects going forward; NULL for rows ingested before migration 1298. See prospects_verify (src/lib/mcp/tools/prospects.ts).';
COMMENT ON COLUMN public.accounts.prospect_source_id IS
  'The prospect_sources row (run) that ingested this prospect. Populated by POST /api/v1/prospects going forward; NULL for rows ingested before migration 1298. See prospects_verify (src/lib/mcp/tools/prospects.ts).';

CREATE INDEX IF NOT EXISTS idx_contacts_prospect_source_id
  ON public.contacts (prospect_source_id)
  WHERE prospect_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_prospect_source_id
  ON public.accounts (prospect_source_id)
  WHERE prospect_source_id IS NOT NULL;
