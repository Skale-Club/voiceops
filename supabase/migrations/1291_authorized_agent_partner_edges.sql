-- =============================================================================
-- Migration 1291: Authorized Agent Partner Edges (Phase 132, Plan 02)
--
-- 132-CONTEXT.md "Partner-edge tenancy and capability policy": ties
-- agent_partners.agent_id / partner_agent_id to a composite same-organization
-- foreign key (mirrors the 1290 assistant_mappings pattern) so a cross-tenant
-- edge is impossible at the database boundary, not just enforced by RLS on
-- authenticated writes. Adds explicit channel + bounded call/depth/timeout
-- budget columns to the edge itself, and a normalized delegated-workflow
-- grant table whose edge and workflow are constrained to the same
-- organization — delegated workflow authority is never expressed as an
-- unverifiable UUID array.
--
-- Conservative default (132-CONTEXT.md "Authorization semantics" +
-- "Never broaden authority when an edge policy is absent"): existing edges
-- get finite, sane budget defaults but ZERO delegated-workflow grant rows are
-- backfilled. Every legacy edge therefore has no delegated workflow
-- authority until an operator explicitly inserts a grant row — fail-closed
-- for side effects. No tenant-specific inserts are performed.
--
-- This migration deliberately performs no data backfill and must NOT be
-- applied in Phase 132 (source-only; see 132-CONTEXT.md
-- "Human/Production Boundary").
-- =============================================================================

-- ── 1. Composite same-organization FKs for both edge endpoints ─────────────
-- Reuses the uniq_agents_organization_id_id UNIQUE constraint added in 1290.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_partners_agent_same_org_fkey'
      AND conrelid = 'public.agent_partners'::regclass
  ) THEN
    ALTER TABLE public.agent_partners
      ADD CONSTRAINT agent_partners_agent_same_org_fkey
      FOREIGN KEY (organization_id, agent_id)
      REFERENCES public.agents(organization_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_partners_partner_agent_same_org_fkey'
      AND conrelid = 'public.agent_partners'::regclass
  ) THEN
    ALTER TABLE public.agent_partners
      ADD CONSTRAINT agent_partners_partner_agent_same_org_fkey
      FOREIGN KEY (organization_id, partner_agent_id)
      REFERENCES public.agents(organization_id, id);
  END IF;
END $$;

-- ── 2. Explicit channel + bounded budget policy on the edge ────────────────
-- allowed_channels: NULL = every channel the specialist itself allows
-- (legacy default; mirrors the agent_tools.allowed_channels convention).
-- A non-null list further restricts the intersection to those channels.
-- max_calls_per_turn / max_depth / timeout_ms: finite, bounded per-edge
-- traversal budget. These are traversal limits, not workflow authority —
-- they do not by themselves grant any delegated workflow (see section 3).

ALTER TABLE public.agent_partners
  ADD COLUMN IF NOT EXISTS allowed_channels public.agent_channel[],
  ADD COLUMN IF NOT EXISTS max_calls_per_turn integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_depth integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS timeout_ms integer NOT NULL DEFAULT 30000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_agent_partners_max_calls_per_turn_bounded'
      AND conrelid = 'public.agent_partners'::regclass
  ) THEN
    ALTER TABLE public.agent_partners
      ADD CONSTRAINT chk_agent_partners_max_calls_per_turn_bounded
      CHECK (max_calls_per_turn BETWEEN 1 AND 10);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_agent_partners_max_depth_bounded'
      AND conrelid = 'public.agent_partners'::regclass
  ) THEN
    ALTER TABLE public.agent_partners
      ADD CONSTRAINT chk_agent_partners_max_depth_bounded
      CHECK (max_depth BETWEEN 1 AND 5);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_agent_partners_timeout_ms_bounded'
      AND conrelid = 'public.agent_partners'::regclass
  ) THEN
    ALTER TABLE public.agent_partners
      ADD CONSTRAINT chk_agent_partners_timeout_ms_bounded
      CHECK (timeout_ms BETWEEN 1000 AND 120000);
  END IF;
END $$;

COMMENT ON COLUMN public.agent_partners.allowed_channels IS
  'Phase 132 (AUTHZ-01): NULL = every channel the specialist agent itself allows. Non-null further restricts the edge to this explicit list.';
COMMENT ON COLUMN public.agent_partners.max_calls_per_turn IS
  'Phase 132 (AUTHZ-01): bounded per-edge call budget for this turn (1-10).';
COMMENT ON COLUMN public.agent_partners.max_depth IS
  'Phase 132 (AUTHZ-01): bounded per-edge delegation depth budget (1-5).';
COMMENT ON COLUMN public.agent_partners.timeout_ms IS
  'Phase 132 (AUTHZ-01): bounded per-edge invocation timeout budget in milliseconds (1000-120000).';

-- ── 3. Composite unique keys needed by the grant table's FKs ───────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uniq_agent_partners_organization_id_id'
      AND conrelid = 'public.agent_partners'::regclass
  ) THEN
    ALTER TABLE public.agent_partners
      ADD CONSTRAINT uniq_agent_partners_organization_id_id
      UNIQUE (organization_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uniq_workflows_org_id_id'
      AND conrelid = 'public.workflows'::regclass
  ) THEN
    ALTER TABLE public.workflows
      ADD CONSTRAINT uniq_workflows_org_id_id
      UNIQUE (org_id, id);
  END IF;
END $$;

-- ── 4. Normalized delegated-workflow grant table ────────────────────────────
-- Represents "this edge may delegate to this workflow" as a verifiable row,
-- not an unverifiable UUID array on agent_partners. Both the edge and the
-- workflow are constrained to the same organization as the grant row.

CREATE TABLE IF NOT EXISTS public.agent_partner_workflow_grants (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_edge_id UUID         NOT NULL,
  workflow_id     UUID         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agent_partner_workflow_grants UNIQUE (partner_edge_id, workflow_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_partner_workflow_grants_edge_same_org_fkey'
      AND conrelid = 'public.agent_partner_workflow_grants'::regclass
  ) THEN
    ALTER TABLE public.agent_partner_workflow_grants
      ADD CONSTRAINT agent_partner_workflow_grants_edge_same_org_fkey
      FOREIGN KEY (organization_id, partner_edge_id)
      REFERENCES public.agent_partners(organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_partner_workflow_grants_workflow_same_org_fkey'
      AND conrelid = 'public.agent_partner_workflow_grants'::regclass
  ) THEN
    ALTER TABLE public.agent_partner_workflow_grants
      ADD CONSTRAINT agent_partner_workflow_grants_workflow_same_org_fkey
      FOREIGN KEY (organization_id, workflow_id)
      REFERENCES public.workflows(org_id, id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.agent_partner_workflow_grants ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_partner_workflow_grants_edge
  ON public.agent_partner_workflow_grants(partner_edge_id);

DROP POLICY IF EXISTS "agent_partner_workflow_grants_all" ON public.agent_partner_workflow_grants;
CREATE POLICY "agent_partner_workflow_grants_all" ON public.agent_partner_workflow_grants
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.agent_partner_workflow_grants IS
  'Phase 132 (AUTHZ-01/AUTHZ-02): normalized per-edge delegated-workflow grant. A row here is delegation TRAVERSAL permission only — it never substitutes for the specialist''s own direct workflow grant (agent_tools), which is checked independently by resolveAgentTool()/buildWorkflowTools().';
