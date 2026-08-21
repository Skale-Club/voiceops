-- =============================================================================
-- Migration 1285: Ads connection health + extensible platform set
-- =============================================================================
-- Two problems this fixes.
--
-- 1. Token expiry was invisible. `token_expires_at` was written by the OAuth
--    callback and never read again, and a rejected credential (Meta code 190)
--    surfaced as a generic 502 with `status` left on 'active'. After ~60 days a
--    Meta connection silently stopped working across the dashboard, the Copilot
--    and the CAPI fallback token. These columns give the expiry watcher and the
--    UI something concrete to read.
--
-- 2. `platform` was pinned to ('meta','google') by a CHECK constraint, so any
--    new network required a migration even though the UI already abstracts
--    platforms behind platform-panel-contract.ts. Widen it to the set the
--    product actually plans for.
-- =============================================================================

ALTER TABLE public.ads_connections
  ADD COLUMN IF NOT EXISTS last_error_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ads_connections.last_error_at IS
  'When the platform last rejected this credential. Cleared on recovery.';
COMMENT ON COLUMN public.ads_connections.last_verified_at IS
  'Last successful authenticated call. Used to distinguish stale from broken.';

-- Surfacing "which connections need attention" is a per-org read on every
-- dashboard load; index the states the watcher and the UI banner filter on.
CREATE INDEX IF NOT EXISTS idx_ads_connections_health
  ON public.ads_connections(org_id, platform, status)
  WHERE status IN ('active', 'error');

CREATE INDEX IF NOT EXISTS idx_ads_connections_expiry
  ON public.ads_connections(token_expires_at)
  WHERE token_expires_at IS NOT NULL;

-- Widen the platform set. Existing rows are all 'meta'/'google' so no backfill
-- is needed; the new values simply become legal.
ALTER TABLE public.ads_connections
  DROP CONSTRAINT IF EXISTS ads_connections_platform_check;

ALTER TABLE public.ads_connections
  ADD CONSTRAINT ads_connections_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok', 'linkedin', 'microsoft'));
