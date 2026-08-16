-- Expose canonical Xcraper/Analyzer web-presence signals in the unified
-- prospect list. Values remain in accounts.custom_fields so this upgrade is
-- backward-compatible and does not add sparse columns to every CRM account.

DROP VIEW IF EXISTS public.prospect_rows;

CREATE VIEW public.prospect_rows
WITH (security_invoker = true) AS
SELECT
  c.id, c.org_id, 'person'::text AS kind,
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name) AS name,
  c.email, c.phone, c.company,
  NULL::text AS website, NULL::text AS domain,
  NULLIF(TRIM(CONCAT_WS(', ', c.custom_fields->>'city', c.custom_fields->>'state')), '') AS city,
  c.tags, c.source, c.source_type, c.source_id,
  c.engagement_status, c.intent_level, c.qualification_status, c.recommended_channel,
  c.score, c.last_contacted_at, c.last_replied_at,
  c.email_status, c.email_verified_at, c.email_verification_provider, c.email_risk,
  NULL::boolean AS has_owned_website,
  NULL::text AS web_presence_type,
  NULL::text AS web_presence_url,
  NULL::text AS web_presence_platform,
  NULL::text AS booking_platform,
  NULL::text AS booking_url,
  c.created_at, c.updated_at
FROM public.contacts c
WHERE c.lifecycle_stage = 'prospect'
  AND c.identity_status <> 'archived_duplicate'

UNION ALL

SELECT
  a.id, a.org_id, 'company'::text AS kind,
  a.name,
  a.custom_fields->>'email' AS email,
  a.phone,
  COALESCE(a.domain, a.website) AS company,
  COALESCE(a.domain, a.website) AS website,
  a.domain,
  NULLIF(TRIM(CONCAT_WS(', ', a.custom_fields->>'city', a.custom_fields->>'state')), '') AS city,
  a.tags, a.source, a.source_type, a.source_id,
  a.engagement_status, a.intent_level, a.qualification_status, a.recommended_channel,
  a.score, a.last_contacted_at, a.last_replied_at,
  a.email_status, a.email_verified_at, a.email_verification_provider, a.email_risk,
  CASE
    WHEN LOWER(a.custom_fields->>'has_owned_website') IN ('true', 'false')
      THEN (a.custom_fields->>'has_owned_website')::boolean
    WHEN a.domain IS NOT NULL AND a.domain <> '' THEN true
    ELSE NULL
  END AS has_owned_website,
  a.custom_fields->>'web_presence_type' AS web_presence_type,
  a.custom_fields->>'web_presence_url' AS web_presence_url,
  a.custom_fields->>'web_presence_platform' AS web_presence_platform,
  a.custom_fields->>'booking_platform' AS booking_platform,
  a.custom_fields->>'booking_url' AS booking_url,
  a.created_at, a.updated_at
FROM public.accounts a
WHERE a.lifecycle_stage = 'prospect';

GRANT SELECT ON public.prospect_rows TO authenticated, anon;

COMMENT ON VIEW public.prospect_rows IS
  'Unified prospect-stage contacts and accounts. SECURITY INVOKER preserves base-table RLS. Includes email verification and structured web-presence/booking signals as of migration 1276.';
