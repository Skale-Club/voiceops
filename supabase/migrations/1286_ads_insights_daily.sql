-- =============================================================================
-- Migration 1286: ads_insights_daily — durable per-campaign daily metrics
-- =============================================================================
-- Every ads view and every AI tool call reads live from the Graph API / Google
-- Ads API. That means: no period-over-period comparison that survives a rate
-- limit, no data at all once an account is disconnected, no baseline to detect
-- an anomaly against, and platform latency in front of every Copilot answer.
--
-- This table is the module's own record. A nightly cron writes one row per
-- (org, platform, account, campaign, day); the dashboard reads trends from it
-- instead of re-querying 90 days of history on every render.
--
-- Money is stored in minor units (cents / equivalent) as BIGINT alongside the
-- account currency, never as a float — summing spend across a quarter in
-- floating point drifts, and the currency has to travel with the number or the
-- UI guesses (it used to guess "$").
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ads_insights_daily (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform          TEXT        NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok', 'linkedin', 'microsoft')),
  ad_account_id     TEXT        NOT NULL,
  campaign_id       TEXT        NOT NULL,
  campaign_name     TEXT,
  stat_date         DATE        NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'USD',

  impressions       BIGINT      NOT NULL DEFAULT 0,
  clicks            BIGINT      NOT NULL DEFAULT 0,
  reach             BIGINT      NOT NULL DEFAULT 0,
  -- Minor units of `currency` (cents for USD/BRL/EUR, whole units for JPY).
  spend_minor       BIGINT      NOT NULL DEFAULT 0,
  -- Google reports fractional conversions (view-through attribution), so this
  -- one genuinely is a decimal — NUMERIC, not float.
  conversions       NUMERIC(14,2) NOT NULL DEFAULT 0,
  leads             BIGINT      NOT NULL DEFAULT 0,

  -- Raw platform payload for the day, so a later metric can be backfilled from
  -- history instead of re-fetching from an account that may be gone.
  raw               JSONB       NOT NULL DEFAULT '{}'::jsonb,

  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per campaign per day. The snapshot re-runs over a trailing window
  -- (platforms restate recent days), so the writer upserts on this key.
  UNIQUE (org_id, platform, ad_account_id, campaign_id, stat_date)
);

-- The dominant read is "this account's rows across a date window", ordered by
-- day for charting.
CREATE INDEX IF NOT EXISTS idx_ads_insights_daily_window
  ON public.ads_insights_daily(org_id, platform, ad_account_id, stat_date DESC);

CREATE INDEX IF NOT EXISTS idx_ads_insights_daily_campaign
  ON public.ads_insights_daily(org_id, campaign_id, stat_date DESC);

ALTER TABLE public.ads_insights_daily ENABLE ROW LEVEL SECURITY;

-- Reads are org-scoped like every other ads table. Writes come from the cron
-- via the service-role client, which bypasses RLS, so no write policy for
-- authenticated users is needed (and none is wanted — this is derived data).
CREATE POLICY "ads_insights_daily_select" ON public.ads_insights_daily
  FOR SELECT TO authenticated
  USING (org_id = public.get_current_org_id());

CREATE TRIGGER ads_insights_daily_updated_at
  BEFORE UPDATE ON public.ads_insights_daily
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- ─── Aggregate helper ────────────────────────────────────────────────────────
-- Totals for a window, from stored history rather than a live API call. Used
-- for the period-over-period comparison on the overview and by anomaly checks.

CREATE OR REPLACE FUNCTION public.get_ads_daily_totals(
  p_platform      TEXT,
  p_ad_account_id TEXT,
  p_from          DATE,
  p_to            DATE
)
RETURNS TABLE (
  impressions BIGINT,
  clicks      BIGINT,
  reach       BIGINT,
  spend_minor BIGINT,
  conversions NUMERIC,
  leads       BIGINT,
  currency    TEXT,
  days        BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(d.impressions), 0)::BIGINT,
    COALESCE(SUM(d.clicks), 0)::BIGINT,
    COALESCE(SUM(d.reach), 0)::BIGINT,
    COALESCE(SUM(d.spend_minor), 0)::BIGINT,
    COALESCE(SUM(d.conversions), 0)::NUMERIC,
    COALESCE(SUM(d.leads), 0)::BIGINT,
    COALESCE(MIN(d.currency), 'USD')::TEXT,
    COUNT(DISTINCT d.stat_date)::BIGINT
  FROM public.ads_insights_daily d
  WHERE d.org_id = public.get_current_org_id()
    AND d.platform = p_platform
    AND d.ad_account_id = p_ad_account_id
    AND d.stat_date BETWEEN p_from AND p_to;
$$;

GRANT EXECUTE ON FUNCTION public.get_ads_daily_totals(TEXT, TEXT, DATE, DATE) TO authenticated;
