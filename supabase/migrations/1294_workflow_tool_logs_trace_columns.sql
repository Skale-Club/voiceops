-- =============================================================================
-- Migration 1294: workflow_tool_logs — stop discarding trace_id / agent_invocation_id
-- (Phase 134 Plan 03 — OBS-01, added scope found after the plan was written)
--
-- Migration 1255 (file 1255_tool_run_logging.sql, whose own header comment
-- still says "1249_tool_run_logging.sql" — the number drifted from the file
-- once before; do not trust the header, trust the actual file name) defined
-- workflow_tool_logs as workflow_runs (kind='tool') UNION ALL action_logs.
-- Its workflow_runs branch hardcodes:
--
--   NULL::uuid AS agent_invocation_id,
--   NULL::uuid AS trace_id,
--
-- because neither column existed on workflow_runs at the time. Migration
-- 1292 (Phase 134 Plan 01) added both columns for real, and Phase 134 Plan
-- 03's executeWorkflowTool()/logToolRun() wiring now populates them for
-- agent-triggered tool runs. Left unchanged, this view would keep silently
-- discarding that linkage on every read — the workflow_runs branch would
-- always report NULL even for rows that have real values, and the join
-- this whole plan exists to make visible (agent_invocations -> workflow
-- run -> Action Engine execution) would stay invisible on the read side.
--
-- This migration replaces the view so the workflow_runs branch selects the
-- real columns. Every other column and the legacy action_logs branch are
-- preserved byte-for-byte from migration 1255 — only the two NULL::uuid
-- literals become real column references.
--
-- Idempotent (CREATE OR REPLACE VIEW). Must NOT be applied in this phase
-- (134-CONTEXT.md "Human/Production Boundary") — migrations 1290-1293 are
-- already unapplied; this one joins them.
-- =============================================================================

CREATE OR REPLACE VIEW public.workflow_tool_logs
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.org_id                              AS organization_id,
  NULL::uuid                            AS tool_config_id,
  r.workflow_id,
  COALESCE(r.vapi_call_id, '')          AS vapi_call_id,
  COALESCE(r.tool_name, '')             AS tool_name,
  CASE r.status
    WHEN 'succeeded' THEN 'success'
    WHEN 'timeout'   THEN 'timeout'
    ELSE 'error'
  END                                   AS status,
  COALESCE(
    r.execution_ms,
    GREATEST(0, (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000))::integer,
    0
  )                                     AS execution_ms,
  r.trigger_payload                     AS request_payload,
  r.state                               AS response_payload,
  r.error                               AS error_detail,
  r.agent_invocation_id                 AS agent_invocation_id,
  r.trace_id                            AS trace_id,
  r.created_at,
  'run'::text                           AS source
FROM public.workflow_runs r
WHERE r.kind = 'tool'
UNION ALL
SELECT
  a.id,
  a.organization_id,
  a.tool_config_id,
  NULL::uuid                            AS workflow_id,
  a.vapi_call_id,
  a.tool_name,
  a.status,
  a.execution_ms,
  a.request_payload,
  a.response_payload,
  a.error_detail,
  a.agent_invocation_id,
  a.trace_id,
  a.created_at,
  'legacy'::text                        AS source
FROM public.action_logs a;

GRANT SELECT ON public.workflow_tool_logs TO authenticated, service_role;

-- =============================================================================
-- Footer
--   workflow_tool_logs (workflow_runs branch) -- agent_invocation_id and
--     trace_id now select the real migration-1292 columns instead of
--     NULL::uuid. The action_logs branch, every other column, both
--     branches' shapes, and the security_invoker view option are unchanged
--     from migration 1255.
-- =============================================================================
