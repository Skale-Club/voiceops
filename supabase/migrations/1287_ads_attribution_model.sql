-- =============================================================================
-- Migration 1287: get_ads_attribution — explicit single-touch attribution model
-- =============================================================================
-- Bug: revenue was counted once per campaign a contact ever touched.
--
-- The previous body built `all_contacts` as (campaign × contact) for EVERY
-- campaign whose session identified that contact, then joined opportunities
-- onto it. `deduped_opps` deduplicated by (campaign, opp_id) — so a single
-- $10k opportunity from a contact who clicked three campaigns produced three
-- rows of $10k each. Each row was defensible on its own as "influenced
-- revenue", but the caller sums the rows to build the totals, so the headline
-- revenue read 3× the real pipeline. The same applied to identified_contacts
-- and the opportunity count.
--
-- Fix: credit each contact to exactly ONE campaign, so the rows partition the
-- population and summing them is correct by construction. The model is now a
-- parameter instead of an accident:
--
--   'last_touch'  (default) — the most recent identifying session in the window
--   'first_touch'           — the earliest identifying session in the window
--
-- Both are additive. A multi-touch / influence view is deliberately NOT folded
-- in here: it needs fractional credit per campaign to stay additive, which is a
-- different return shape and belongs in its own function.
--
-- Note on the window: attribution only considers sessions inside [p_from,p_to].
-- A contact whose first click predates the window is credited to the earliest
-- session visible in it, not to their true first touch.
-- =============================================================================

-- The old 3-argument signature must go, or PostgreSQL keeps it as a separate
-- overload and every existing 3-arg caller silently keeps the buggy body. The
-- new 4-arg version defaults p_model, so those callers resolve to it unchanged.
DROP FUNCTION IF EXISTS public.get_ads_attribution(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.get_ads_attribution(
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ,
  p_platform  TEXT DEFAULT NULL,          -- 'meta' | 'google' | NULL (all paid)
  p_model     TEXT DEFAULT 'last_touch'   -- 'last_touch' | 'first_touch'
)
RETURNS TABLE (
  utm_source           TEXT,
  utm_medium           TEXT,
  utm_campaign         TEXT,
  sessions             BIGINT,
  identified_contacts  BIGINT,
  opportunities        BIGINT,
  revenue              NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org AS (
    SELECT get_current_org_id() AS id
  ),

  filtered_sessions AS (
    SELECT id, utm_source, utm_medium, utm_campaign, visitor_id, started_at
    FROM analytics_sessions
    WHERE organization_id = (SELECT id FROM org)
      AND started_at BETWEEN p_from AND p_to
      AND utm_campaign IS NOT NULL
      AND (
        p_platform IS NULL
        OR (p_platform = 'meta'   AND utm_source IN ('meta','facebook','instagram','fb'))
        OR (p_platform = 'google' AND utm_source IN ('google','adwords','google-ads'))
      )
  ),

  -- Signal 1: the session's visitor is linked to a contact.
  visitor_signal AS (
    SELECT fs.utm_source, fs.utm_medium, fs.utm_campaign,
           fs.id AS session_id, fs.started_at, av.contact_id
    FROM filtered_sessions fs
    JOIN analytics_visitors av ON av.id = fs.visitor_id
     AND av.contact_id IS NOT NULL
  ),

  -- Signal 2: an identifying event fired during the session.
  event_signal AS (
    SELECT fs.utm_source, fs.utm_medium, fs.utm_campaign,
           fs.id AS session_id, fs.started_at, ae.contact_id
    FROM filtered_sessions fs
    JOIN analytics_events ae ON ae.session_id = fs.id
     AND ae.contact_id IS NOT NULL
  ),

  contact_touches AS (
    SELECT * FROM visitor_signal
    UNION
    SELECT * FROM event_signal
  ),

  -- One winning touch per contact. When p_model = 'first_touch' the first sort
  -- key is the timestamp ascending and decides; otherwise that key is a
  -- constant NULL for every row, so ordering falls through to most-recent-first.
  -- session_id breaks exact ties deterministically.
  ranked_touches AS (
    SELECT
      ct.*,
      ROW_NUMBER() OVER (
        PARTITION BY ct.contact_id
        ORDER BY
          CASE WHEN p_model = 'first_touch' THEN ct.started_at END ASC,
          ct.started_at DESC,
          ct.session_id DESC
      ) AS touch_rank
    FROM contact_touches ct
  ),

  contact_attribution AS (
    SELECT contact_id, utm_source, utm_medium, utm_campaign
    FROM ranked_touches
    WHERE touch_rank = 1
  ),

  campaign_contacts AS (
    SELECT utm_source, utm_medium, utm_campaign,
           COUNT(*) AS contact_count          -- already one row per contact
    FROM contact_attribution
    GROUP BY utm_source, utm_medium, utm_campaign
  ),

  -- Each opportunity now belongs to exactly one campaign, because its contact
  -- does. No cross-campaign fan-out, so no dedup step is required.
  campaign_revenue AS (
    SELECT
      ca.utm_source, ca.utm_medium, ca.utm_campaign,
      COUNT(o.id)                       AS opp_count,
      COALESCE(SUM(COALESCE(o.value, 0)), 0) AS total_revenue
    FROM contact_attribution ca
    JOIN opportunities o
      ON o.contact_id = ca.contact_id
     AND o.org_id = (SELECT id FROM org)
    GROUP BY ca.utm_source, ca.utm_medium, ca.utm_campaign
  ),

  campaign_sessions AS (
    SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS session_count
    FROM filtered_sessions
    GROUP BY utm_source, utm_medium, utm_campaign
  )

  SELECT
    cs.utm_source,
    cs.utm_medium,
    cs.utm_campaign,
    cs.session_count                AS sessions,
    COALESCE(cc.contact_count, 0)   AS identified_contacts,
    COALESCE(cr.opp_count, 0)       AS opportunities,
    COALESCE(cr.total_revenue, 0)   AS revenue
  FROM campaign_sessions cs
  LEFT JOIN campaign_contacts cc
    ON  cc.utm_source   IS NOT DISTINCT FROM cs.utm_source
    AND cc.utm_medium   IS NOT DISTINCT FROM cs.utm_medium
    AND cc.utm_campaign IS NOT DISTINCT FROM cs.utm_campaign
  LEFT JOIN campaign_revenue cr
    ON  cr.utm_source   IS NOT DISTINCT FROM cs.utm_source
    AND cr.utm_medium   IS NOT DISTINCT FROM cs.utm_medium
    AND cr.utm_campaign IS NOT DISTINCT FROM cs.utm_campaign
  ORDER BY revenue DESC, sessions DESC
  LIMIT 500
$$;

COMMENT ON FUNCTION public.get_ads_attribution(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) IS
  'Single-touch UTM attribution (last_touch default, first_touch optional). Each contact and opportunity is credited to exactly one campaign, so rows are additive. Capped at 500 UTM combinations.';

GRANT EXECUTE ON FUNCTION public.get_ads_attribution(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
