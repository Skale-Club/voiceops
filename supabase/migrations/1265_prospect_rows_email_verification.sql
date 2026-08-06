-- =============================================================================
-- Migration 1265: Expose email verification columns on the prospect_rows view
--
-- Migration 1264 added email_status / email_verified_at /
-- email_verification_provider / email_risk to contacts + accounts, but the
-- unified prospect_rows view (migration 1247) lists its columns explicitly
-- rather than `SELECT *`, so those new columns never reached the Prospects
-- list. Re-create the view (same shape otherwise) with the four columns
-- added to both branches of the UNION ALL.
--
-- Companies have no direct `email` column (see 1264's comment — the scraped
-- address lives in custom_fields.email), but the verification STATUS columns
-- are real columns on accounts too, so they carry through unchanged here.
-- =============================================================================

DROP VIEW IF EXISTS public.prospect_rows;

CREATE VIEW public.prospect_rows
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.org_id,
  'person'::text                                                            AS kind,
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name)
                                                                             AS name,
  c.email,
  c.phone,
  c.company,
  NULL::text                                                                AS website,
  NULL::text                                                                AS domain,
  NULLIF(TRIM(CONCAT_WS(', ', c.custom_fields->>'city', c.custom_fields->>'state')), '')
                                                                             AS city,
  c.tags,
  c.source,
  c.source_type,
  c.source_id,
  c.engagement_status,
  c.intent_level,
  c.qualification_status,
  c.recommended_channel,
  c.score,
  c.last_contacted_at,
  c.last_replied_at,
  c.email_status,
  c.email_verified_at,
  c.email_verification_provider,
  c.email_risk,
  c.created_at,
  c.updated_at
FROM public.contacts c
WHERE c.lifecycle_stage = 'prospect'
  AND c.identity_status <> 'archived_duplicate'

UNION ALL

SELECT
  a.id,
  a.org_id,
  'company'::text                            AS kind,
  a.name,
  a.custom_fields->>'email'                  AS email,
  a.phone,
  COALESCE(a.domain, a.website)              AS company,
  COALESCE(a.domain, a.website)              AS website,
  a.domain,
  NULLIF(TRIM(CONCAT_WS(', ', a.custom_fields->>'city', a.custom_fields->>'state')), '')
                                              AS city,
  a.tags,
  a.source,
  a.source_type,
  a.source_id,
  a.engagement_status,
  a.intent_level,
  a.qualification_status,
  a.recommended_channel,
  a.score,
  a.last_contacted_at,
  a.last_replied_at,
  a.email_status,
  a.email_verified_at,
  a.email_verification_provider,
  a.email_risk,
  a.created_at,
  a.updated_at
FROM public.accounts a
WHERE a.lifecycle_stage = 'prospect';

GRANT SELECT ON public.prospect_rows TO authenticated, anon;

COMMENT ON VIEW public.prospect_rows IS
  'Unified read-only view of prospect-stage contacts + accounts for the Prospects list. RLS inherits from base tables via SECURITY INVOKER -- never filter by org_id manually against this view. Includes email verification columns as of migration 1265.';
