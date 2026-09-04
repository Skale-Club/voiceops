-- =============================================================================
-- Migration 1292: Workflow Run Trace Linkage (Phase 134 Plan 01 — OBS-01)
--
-- `workflow_runs` has `trigger_type`, `tool_name`, `vapi_call_id`, and
-- `execution_ms` — but no `trace_id` and no `agent_invocation_id`.
-- `logToolRun()`'s input accepts no trace or invocation identifier either.
-- So an operator can follow channel ingress -> entry agent -> nested
-- specialist invocations through `agent_invocations`, and can see that a
-- workflow ran, but cannot join the two. `vapi_call_id` correlates only for
-- voice, and only for the legacy route. This migration closes that one gap:
-- a nullable `trace_id` (same domain as `agent_invocations.trace_id` and
-- `action_logs.trace_id`, migration 037) and a nullable, same-organization
-- `agent_invocation_id` reference.
--
-- Both columns stay NULLABLE and are NOT backfilled: cron, campaign, and
-- manual workflow runs legitimately have no agent invocation, and existing
-- rows must keep working untouched (134-CONTEXT.md "Locked Decisions").
--
-- This migration deliberately performs no data backfill and must NOT be
-- applied in Phase 134 (source-only; see 134-CONTEXT.md
-- "Human/Production Boundary"). Migrations 1290 and 1291 are already
-- unapplied; this one joins them.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. Composite same-organization unique key for agent_invocations ────────
-- A composite FK must reference a matching UNIQUE constraint. Mirrors
-- uniq_agents_organization_id_id (1290) and
-- uniq_agent_partners_organization_id_id (1291).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uniq_agent_invocations_organization_id_id'
      AND conrelid = 'public.agent_invocations'::regclass
  ) THEN
    ALTER TABLE public.agent_invocations
      ADD CONSTRAINT uniq_agent_invocations_organization_id_id
      UNIQUE (organization_id, id);
  END IF;
END $$;

-- ── 2. Trace + invocation columns on workflow_runs ──────────────────────────

ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS trace_id UUID,
  ADD COLUMN IF NOT EXISTS agent_invocation_id UUID;

-- Composite FK constrains the invocation reference to the SAME organization
-- as the run (mirrors the 1290 assistant_mappings / 1291 agent_partners
-- pattern) — a cross-tenant reference is impossible at the database
-- boundary, not just enforced by RLS on authenticated writes.
--
-- ON DELETE SET NULL: if the invocation row is later removed, the run keeps
-- the rest of its history and simply loses the back-reference. It must never
-- block deleting the invocation, and must never be left as a dangling
-- reference to a row that no longer exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workflow_runs_agent_invocation_same_org_fkey'
      AND conrelid = 'public.workflow_runs'::regclass
  ) THEN
    ALTER TABLE public.workflow_runs
      ADD CONSTRAINT workflow_runs_agent_invocation_same_org_fkey
      FOREIGN KEY (org_id, agent_invocation_id)
      REFERENCES public.agent_invocations(organization_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Indexes for the joins this column exists to serve ───────────────────

-- Cross-table trace correlation, mirrors idx_action_logs_trace (037):
-- the same trace_id appears on the agent_invocations row, on every
-- action_logs row from that turn, and now on the workflow_runs row it
-- caused.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_trace_id
  ON public.workflow_runs (trace_id)
  WHERE trace_id IS NOT NULL;

-- Direct join to the causing invocation row, and keeps the FK's
-- ON DELETE SET NULL cheap to enforce.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent_invocation_id
  ON public.workflow_runs (agent_invocation_id)
  WHERE agent_invocation_id IS NOT NULL;

COMMENT ON COLUMN public.workflow_runs.trace_id IS
  'Phase 134 (OBS-01): cross-table trace correlation. Same trace_id as the causing agent_invocations row (and any action_logs rows from the same turn). NULL for cron, campaign, and manual runs with no agent origin.';

COMMENT ON COLUMN public.workflow_runs.agent_invocation_id IS
  'Phase 134 (OBS-01): back-reference to the agent_invocations row that caused this run. NULL for cron, campaign, manual, and legacy direct-workflow (no entry agent) runs. Composite FK constrains it to the same organization; ON DELETE SET NULL so a removed invocation never blocks deletion or leaves a dangling reference.';

-- =============================================================================
-- Footer
--   uniq_agent_invocations_organization_id_id -- UNIQUE (organization_id, id),
--     backs the composite FK below.
--   workflow_runs.trace_id -- nullable UUID, no FK (trace_id is a
--     correlation value, not a row reference); indexed.
--   workflow_runs.agent_invocation_id -- nullable UUID, composite
--     same-organization FK to agent_invocations, ON DELETE SET NULL; indexed.
-- =============================================================================
