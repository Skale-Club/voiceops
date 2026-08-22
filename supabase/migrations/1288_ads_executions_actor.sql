-- =============================================================================
-- Migration 1288: record WHO performed an ads execution
-- =============================================================================
-- ads_executions already had `executed_by_ai`, which answers "was this a bot?" but not
-- "which operator moved this budget?". Now that dashboard mutations write to
-- this log (they previously wrote nothing at all), the acting user matters:
-- a budget change is a spend decision and the timeline should name its author.
--
-- ON DELETE SET NULL: removing a user must not erase the history of what they
-- changed, only the attribution.
-- =============================================================================

ALTER TABLE public.ads_executions
  ADD COLUMN IF NOT EXISTS executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ads_executions.executed_by IS
  'Operator who triggered the change. NULL for AI-initiated or system actions.';

-- Match the widened platform set from migration 1285 so an execution can be
-- logged for any platform a connection can exist for.
ALTER TABLE public.ads_executions
  DROP CONSTRAINT IF EXISTS ads_executions_platform_check;

ALTER TABLE public.ads_executions
  ADD CONSTRAINT ads_executions_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok', 'linkedin', 'microsoft'));
