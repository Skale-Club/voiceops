-- =============================================================================
-- Migration 1282: Cron heartbeats
--
-- Context: scheduled cron triggers are moving off GitHub Actions onto a small
-- container on the Hetzner/Coolify VPS (`skale-cron`). Each tick reports a
-- heartbeat here so a job that silently stops running can be detected instead
-- of discovered days later.
--
-- Design notes:
--   1. This is a PLATFORM-OPS table, not tenant-scoped. It deliberately has no
--      `org_id` column. Cron jobs are a property of the deployment, not of any
--      one organization, so forcing an org scope here would be artificial and
--      would break `get_current_org_id()`-based RLS anyway (there is no
--      "current org" in a cron container). This is the one intentional
--      exception to the repo's usual org-scoping rule.
--   2. RLS is enabled with NO policies. That is intentional, not an oversight:
--      with RLS on and zero policies, `anon`/`authenticated` get zero access
--      and only `service_role` (which bypasses RLS entirely) can read or
--      write. The heartbeat endpoint always uses the service-role client, so
--      this is the correct lockdown for an internal ops table. Do not "fix"
--      this by adding a permissive policy.
--   3. The failure counter is incremented via a SECURITY DEFINER function
--      (`record_cron_heartbeat`) rather than read-then-write from the API
--      route, so concurrent ticks for the same job (retries, overlapping
--      runs) can't race and drop an increment. A single INSERT ... ON
--      CONFLICT DO UPDATE is atomic per row in Postgres.
-- =============================================================================

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE public.cron_heartbeats (
  job_name text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz,
  last_status integer,
  last_duration_ms integer,
  last_error text,
  expected_interval_seconds integer NOT NULL DEFAULT 300,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_heartbeats IS
  'Platform-ops table (intentionally no org_id — see migration 1282 header). '
  'Tracks the last tick of every scheduled job run by the skale-cron service, '
  'so a job that goes silent can be detected. RLS is enabled with no policies: '
  'only service_role can read/write this table, by design.';
COMMENT ON COLUMN public.cron_heartbeats.job_name IS
  'Stable identifier for the cron job (e.g. "obs-alerts"). Primary key.';
COMMENT ON COLUMN public.cron_heartbeats.last_run_at IS
  'Timestamp of the most recent tick, successful or not.';
COMMENT ON COLUMN public.cron_heartbeats.last_ok_at IS
  'Timestamp of the most recent tick that reported a 2xx status. Null if the job has never succeeded.';
COMMENT ON COLUMN public.cron_heartbeats.last_status IS
  'Status code reported by the last tick (HTTP-style; 2xx = success).';
COMMENT ON COLUMN public.cron_heartbeats.last_duration_ms IS
  'Wall-clock duration of the last tick, in milliseconds.';
COMMENT ON COLUMN public.cron_heartbeats.last_error IS
  'Error message from the last non-2xx tick, truncated to 300 chars. Cleared on the next success.';
COMMENT ON COLUMN public.cron_heartbeats.expected_interval_seconds IS
  'How often this job is expected to report a heartbeat. Used by alerting to flag a job gone silent.';
COMMENT ON COLUMN public.cron_heartbeats.consecutive_failures IS
  'Count of consecutive non-2xx ticks, reset to 0 on the next success. Maintained via record_cron_heartbeat() for atomicity under concurrent ticks.';

-- Enable RLS with no policies: locks the table to service_role only.
-- (No policies added on purpose — see header comment above.)
ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

-- ── 2. Atomic upsert function ────────────────────────────────────────────────
-- Called by POST /api/cron/heartbeat via supabase.rpc('record_cron_heartbeat', …)
-- using the service-role client. SECURITY DEFINER with a locked-down
-- search_path so it can't be tricked by a session-local search_path, and
-- execute is granted to service_role only.

CREATE OR REPLACE FUNCTION public.record_cron_heartbeat(
  p_job_name text,
  p_status integer,
  p_duration_ms integer,
  p_expected_interval_seconds integer DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS public.cron_heartbeats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_ok boolean := p_status >= 200 AND p_status < 300;
  v_row public.cron_heartbeats;
BEGIN
  INSERT INTO public.cron_heartbeats AS ch (
    job_name,
    last_run_at,
    last_ok_at,
    last_status,
    last_duration_ms,
    last_error,
    expected_interval_seconds,
    consecutive_failures,
    updated_at
  )
  VALUES (
    p_job_name,
    now(),
    CASE WHEN v_ok THEN now() ELSE NULL END,
    p_status,
    p_duration_ms,
    CASE WHEN v_ok THEN NULL ELSE left(p_error, 300) END,
    coalesce(p_expected_interval_seconds, 300),
    CASE WHEN v_ok THEN 0 ELSE 1 END,
    now()
  )
  ON CONFLICT (job_name) DO UPDATE SET
    last_run_at = now(),
    last_ok_at = CASE WHEN v_ok THEN now() ELSE ch.last_ok_at END,
    last_status = p_status,
    last_duration_ms = p_duration_ms,
    last_error = CASE WHEN v_ok THEN NULL ELSE left(p_error, 300) END,
    expected_interval_seconds = coalesce(p_expected_interval_seconds, ch.expected_interval_seconds),
    consecutive_failures = CASE WHEN v_ok THEN 0 ELSE ch.consecutive_failures + 1 END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$func$;

REVOKE ALL ON FUNCTION public.record_cron_heartbeat(text, integer, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cron_heartbeat(text, integer, integer, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_cron_heartbeat(text, integer, integer, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_cron_heartbeat(text, integer, integer, integer, text) TO service_role;

COMMIT;
