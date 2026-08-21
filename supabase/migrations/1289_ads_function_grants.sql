-- =============================================================================
-- Migration 1289: tighten EXECUTE grants on the ads SECURITY DEFINER functions
-- =============================================================================
-- PostgreSQL grants EXECUTE on every new function to PUBLIC by default, and
-- PostgREST exposes each one at /rest/v1/rpc/<name>. That means an
-- unauthenticated caller could invoke get_ads_attribution and
-- get_ads_daily_totals — both SECURITY DEFINER, i.e. running with the owner's
-- privileges rather than the caller's.
--
-- No data actually leaked: both functions filter on get_current_org_id(), which
-- resolves to NULL without a session, so an anon call returns zero rows. But
-- "the body happens to be safe" is not an access control, and the linter is
-- right to flag it (0009_anon_security_definer_function_executable). Reachable
-- surface should match intent: these are dashboard reads for a signed-in user.
--
-- Also pins the search_path on the ads_connections updated_at trigger function,
-- which has been mutable since migration 1108. A SECURITY INVOKER trigger is a
-- much smaller concern than the two above, but it is a one-line fix in the same
-- module and the linter flags it too (0011_function_search_path_mutable).
-- =============================================================================

REVOKE ALL ON FUNCTION public.get_ads_attribution(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ads_daily_totals(TEXT, TEXT, DATE, DATE)             FROM PUBLIC, anon;

-- Re-assert the intended callers. service_role bypasses RLS and is used by the
-- cron and the AI tool layer; authenticated is the dashboard.
GRANT EXECUTE ON FUNCTION public.get_ads_attribution(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ads_daily_totals(TEXT, TEXT, DATE, DATE)             TO authenticated, service_role;

-- Pin the trigger function's search_path so it cannot be resolved through a
-- caller-controlled schema.
CREATE OR REPLACE FUNCTION public.update_ads_connections_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
