-- ---------------------------------------------------------------------------
-- 1295: close a cross-organization leak in get_org_member_profiles
--
-- The function is SECURITY DEFINER so it can read auth.users, which
-- authenticated users cannot query directly. Its only predicate was
-- `om.organization_id = p_org_id` — it never checked whether the CALLER
-- belongs to that organization.
--
-- Because SECURITY DEFINER bypasses RLS, any authenticated user could pass any
-- organization id and receive that org's full member list joined to auth.users,
-- including every member's email, phone and name. This breaks the platform's
-- core multi-tenant invariant.
--
-- Found by tests/security-secdef-isolation.test.ts, which had been failing
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
-- NOTE ON THE BODY BELOW — it is transcribed from the LIVE function, not from
-- migration 1037. The remote database had drifted from this repository: the
-- deployed function returns an extra `avatar_url` column and resolves `phone`
-- as NULLIF(TRIM(COALESCE(raw_user_meta_data->>'phone', au.phone)), ''), while
-- 1037 has neither. A first version of this migration was written from 1037
-- and was correctly rejected by Postgres with 42P13 ("cannot change return
-- type of existing function") — which is the only reason the drift was caught
-- before it dropped `avatar_url` out from under the members UI.
--
-- Everything below is the live definition with the membership predicate added
-- and nothing else changed, so a fresh `supabase db reset` now reproduces what
-- production actually runs.
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
  avatar_url   text,
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
    NULLIF(TRIM(COALESCE(
      au.raw_user_meta_data->>'phone',
      au.phone
    )), '')                                                   AS phone,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name'
    )::text                                                   AS full_name,
    NULLIF(TRIM(au.raw_user_meta_data->>'avatar_url'), '')    AS avatar_url,
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
