-- ---------------------------------------------------------------------------
-- 1295: close a cross-organization leak in get_org_member_profiles
--
-- The function (migration 091, last redefined in 1037) is SECURITY DEFINER so
-- it can read auth.users, which authenticated users cannot query directly. Its
-- only predicate was `om.organization_id = p_org_id` — it never checked whether
-- the CALLER belongs to that organization.
--
-- Because SECURITY DEFINER bypasses RLS, any authenticated user could pass any
-- organization id and receive that org's full member list joined to auth.users,
-- including every member's email and phone. This breaks the platform's core
-- multi-tenant invariant.
--
-- Found by tests/security-secdef-isolation.test.ts, which has been failing
-- deterministically on exactly this case ("get_org_member_profiles refuses to
-- enumerate members of a foreign org"). The test was correct; the function was
-- not. The sibling SECDEF functions in that suite (get_current_org_id,
-- get_user_org_ids, get_tag_usage) all isolate correctly — this one was the
-- outlier.
--
-- Fix: require the caller to be a member of p_org_id. A non-member gets an
-- empty result rather than an error, which the caller UI already handles and
-- which avoids leaking whether a given organization id exists.
--
-- Idempotent: CREATE OR REPLACE, and the grants are re-stated.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_org_member_profiles(
  p_org_id   uuid,
  p_page     int DEFAULT 1,
  p_per_page int DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  role         text,
  joined_at    timestamptz,
  email        text,
  phone        text,
  full_name    text,
  total_count  bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    om.id,
    om.user_id,
    om.role::text,
    om.created_at                                             AS joined_at,
    au.email,
    au.phone,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name'
    )::text                                                   AS full_name,
    COUNT(*) OVER()                                           AS total_count
  FROM public.org_members om
  JOIN auth.users au ON au.id = om.user_id
  WHERE om.organization_id = p_org_id
    -- The caller must belong to the organization being read. Without this the
    -- SECURITY DEFINER context happily enumerates any org's members.
    AND EXISTS (
      SELECT 1
      FROM public.org_members caller
      WHERE caller.organization_id = p_org_id
        AND caller.user_id = (SELECT auth.uid())
    )
  ORDER BY om.created_at ASC
  LIMIT  p_per_page
  OFFSET (p_page - 1) * p_per_page;
$$;

REVOKE EXECUTE ON FUNCTION public.get_org_member_profiles(uuid, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_org_member_profiles(uuid, int, int) TO authenticated;
