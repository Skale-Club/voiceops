-- ---------------------------------------------------------------------------
-- Migration 007: Org Switcher
--
-- Adds active-org persistence so users can switch between multiple orgs.
-- Updates get_current_org_id() to prefer the user's explicit selection,
-- falling back to the first membership (backward-compatible).
-- Fixes RLS on organizations + org_members to allow multi-org listing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Section 1: user_active_org table
-- Stores each user's currently selected organization.
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_active_org (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_active_org ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own active org row
CREATE POLICY "active_org_select" ON public.user_active_org
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "active_org_insert" ON public.user_active_org
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "active_org_update" ON public.user_active_org
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Section 2: get_user_org_ids() helper
-- Returns all organization IDs the current user is a member of.
-- SECURITY DEFINER bypasses org_members RLS (prevents circular evaluation).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT organization_id
  FROM public.org_members
  WHERE user_id = (SELECT auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Section 3: Update get_current_org_id()
-- Prefers the user's explicit selection; falls back to first membership.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT organization_id FROM public.user_active_org   WHERE user_id = (SELECT auth.uid())),
    (SELECT organization_id FROM public.org_members WHERE user_id = (SELECT auth.uid()) LIMIT 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- Section 4: Update organizations RLS — allow viewing all member orgs
-- Before: users could only see their current org.
-- After:  users can see all orgs they are a member of (for the switcher).
-- INSERT/UPDATE/DELETE remain scoped to the current (active) org.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "org_select" ON public.organizations;

CREATE POLICY "org_select" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- Section 5: Update org_members RLS — allow viewing own memberships
-- Before: users could only see org_members rows for their current org.
-- After:  users can also see their own rows across all orgs (for switching).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "org_members_select" ON public.org_members;

CREATE POLICY "org_members_select" ON public.org_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id = (SELECT public.get_current_org_id())
  );
