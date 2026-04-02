-- =============================================================================
-- Migration 001: Foundation Schema
-- Phase: 01-foundation
-- Requirements: TEN-02 (org-scoped queries), AUTH-05 (user linked to org)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Section 2: Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.user_role AS ENUM ('admin', 'member');

-- ---------------------------------------------------------------------------
-- Section 3: organizations table
-- ---------------------------------------------------------------------------

CREATE TABLE public.organizations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        UNIQUE NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Section 4: org_members table
-- ---------------------------------------------------------------------------

CREATE TABLE public.org_members (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID              NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            public.user_role  NOT NULL DEFAULT 'member',
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_org_members_user_id ON public.org_members(user_id);
CREATE INDEX idx_org_members_org_id  ON public.org_members(organization_id);

-- ---------------------------------------------------------------------------
-- Section 5: assistant_mappings table
-- ---------------------------------------------------------------------------

CREATE TABLE public.assistant_mappings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vapi_assistant_id TEXT        NOT NULL,
  name              TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(vapi_assistant_id)
);

ALTER TABLE public.assistant_mappings ENABLE ROW LEVEL SECURITY;

-- CRITICAL: This index is load-bearing for Phase 2 Action Engine
-- (org resolution by assistant ID on every incoming Vapi webhook)
CREATE INDEX idx_assistant_mappings_org_id  ON public.assistant_mappings(organization_id);
CREATE INDEX idx_assistant_mappings_vapi_id ON public.assistant_mappings(vapi_assistant_id);

-- ---------------------------------------------------------------------------
-- Section 6: get_current_org_id() helper function
-- ---------------------------------------------------------------------------
-- Resolves the current user's organization_id from the DB (not JWT claims —
-- JWT claims can be user-modified; DB lookup via SECURITY DEFINER is safe).
--
-- SECURITY DEFINER: runs with function owner's privileges, bypassing RLS
--   on org_members so the function can read that table without a circular
--   RLS dependency.
-- SET search_path = '': prevents search path injection attacks.
-- STABLE: result can be cached within a transaction for performance.

CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT organization_id
  FROM public.org_members
  WHERE user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Section 7: RLS policies for organizations
-- ---------------------------------------------------------------------------
-- All policies use (select ...) wrapper so the subquery is evaluated once
-- per statement (cached), NOT once per row (20-100x slower on large tables).

CREATE POLICY "org_select" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = (SELECT public.get_current_org_id()));

CREATE POLICY "org_insert" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT public.get_current_org_id()));

CREATE POLICY "org_update" ON public.organizations
  FOR UPDATE TO authenticated
  USING     (id = (SELECT public.get_current_org_id()))
  WITH CHECK (id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- Section 8: RLS policies for org_members
-- ---------------------------------------------------------------------------
-- get_current_org_id() is SECURITY DEFINER so it bypasses RLS on org_members
-- when invoked, preventing a recursive RLS evaluation loop.

CREATE POLICY "org_members_select" ON public.org_members
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "org_members_insert" ON public.org_members
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- Section 9: RLS policies for assistant_mappings
-- ---------------------------------------------------------------------------

CREATE POLICY "mappings_select" ON public.assistant_mappings
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "mappings_insert" ON public.assistant_mappings
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "mappings_update" ON public.assistant_mappings
  FOR UPDATE TO authenticated
  USING     (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "mappings_delete" ON public.assistant_mappings
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- Section 10: updated_at trigger function and triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_assistant_mappings_updated_at
  BEFORE UPDATE ON public.assistant_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
