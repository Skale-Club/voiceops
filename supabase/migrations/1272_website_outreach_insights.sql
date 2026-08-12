-- 1272: Persist multilingual, evidence-derived website outreach insights.
-- Keys are BCP-47 language codes; internal field names remain English.

ALTER TABLE public.website_analyses
  ADD COLUMN IF NOT EXISTS outreach_insights jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.website_analyses
  DROP CONSTRAINT IF EXISTS website_analyses_outreach_insights_object;

ALTER TABLE public.website_analyses
  ADD CONSTRAINT website_analyses_outreach_insights_object
  CHECK (jsonb_typeof(outreach_insights) = 'object');

COMMENT ON COLUMN public.website_analyses.outreach_insights IS
  'Factual two-sentence outreach observations keyed by BCP-47 language.';
