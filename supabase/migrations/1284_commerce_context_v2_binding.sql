-- =============================================================================
-- Migration 1284: Commerce context token v2 -- jti replay guard + cnonce
-- binding (X2 hardening)
--
-- Contract §3 bumps the storefront-minted commerce-context token to v2 (see
-- stuscle/docs/INTEGRATION-XPHERE-X2-TOKEN-BINDING.md): TTL 900s->300s, plus
-- two new claims, `jti` (one-time use) and `cnonce` (client-generated,
-- per-page-load). This migration adds the server-side enforcement for both:
--
--   1. commerce_context_jti -- insert-once ledger. A token's `jti` is
--      consumed exactly once (on the pin attempt, BEFORE any pin write); a
--      second presentation of the same (org_id, jti) is rejected as replay.
--      Same dedupe-by-unique-violation pattern as commerce_event_receipts
--      (migration 1260) -- reliable even with Redis fully out of the picture.
--
--   2. medusa_consume_context_jti -- SECURITY DEFINER RPC wrapping the
--      insert. Returns true on a fresh insert (jti accepted), false when the
--      (org_id, jti) pair already exists (replay -- caller must drop the
--      context and skip the pin entirely).
--
--   3. medusa_write_commerce_context -- REPLACED (9-arg version; the 8-arg
--      migration-1283 version is dropped first since Postgres treats a
--      changed parameter list as a distinct overload, not a replacement).
--      Adds `p_cnonce`: the conversation's FIRST pin records `cnonce`
--      verbatim; every LATER re-pin must present the SAME cnonce or the
--      entire merge is aborted -- no write at all -- and the function returns
--      `{"rejected": true}` instead of the usual null/`{repinnedFrom}`. This
--      is the layer that blocks the X2 finding directly: a context token
--      stolen from conversation A and POSTed into conversation B carries A's
--      widget-page cnonce, which will never match B's already-pinned one.
--
-- Idempotent migration: safe to re-run (CREATE TABLE IF NOT EXISTS / CREATE
-- OR REPLACE FUNCTION / DROP FUNCTION IF EXISTS).
-- =============================================================================

BEGIN;

-- ── 1. commerce_context_jti ──────────────────────────────────────────────
-- One-time consumption ledger for commerce-context token `jti` claims.
-- INSERT-on-consume; a unique-violation on (org_id, jti) means the token was
-- already used. Prune candidates: consumed_at older than a few TTLs (tokens
-- expire after 300s) -- not automated by this migration.

CREATE TABLE IF NOT EXISTS public.commerce_context_jti (
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  jti          text        NOT NULL,
  consumed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, jti)
);

ALTER TABLE public.commerce_context_jti ENABLE ROW LEVEL SECURITY;
-- No policies: this table is written/read exclusively through the
-- SECURITY DEFINER RPC below (service_role only). anon/authenticated get
-- zero rows via PostgREST with RLS enabled and no policy defined for them.

COMMENT ON TABLE public.commerce_context_jti IS
  'One-time consumption ledger for commerce-context token jti claims (contract §3 v2, X2 hardening). A pin consumes its jti exactly once via medusa_consume_context_jti; a later presentation of the same (org_id, jti) is rejected as replay. Tokens TTL at 300s -- consumed_at rows are safe to prune well after that.';

-- ── 2. medusa_consume_context_jti ────────────────────────────────────────
-- Atomic insert-once consume. Returns true on a fresh insert (accept),
-- false when (org_id, jti) already exists (replay -- reject, no pin).

CREATE OR REPLACE FUNCTION public.medusa_consume_context_jti(
  p_org_id uuid,
  p_jti text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.commerce_context_jti (org_id, jti)
  VALUES (p_org_id, p_jti)
  ON CONFLICT (org_id, jti) DO NOTHING;

  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.medusa_consume_context_jti(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medusa_consume_context_jti(uuid, text) TO service_role;

-- ── 3. medusa_write_commerce_context (REPLACED -- adds cnonce binding) ──
-- Drop the migration-1283 8-arg version first: a differing parameter list
-- creates a new overload under CREATE OR REPLACE rather than replacing it.

DROP FUNCTION IF EXISTS public.medusa_write_commerce_context(uuid, uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.medusa_write_commerce_context(
  p_conversation_id uuid,
  p_org_id uuid,
  p_cart text,
  p_cus text,
  p_email text,
  p_wishlist_ref text,
  p_country_code text,
  p_region_id text,
  p_cnonce text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_memory jsonb;
  v_commerce jsonb;
  v_old_cart text;
  v_existing_cnonce text;
BEGIN
  SELECT memory INTO v_memory
    FROM public.conversations
    WHERE id = p_conversation_id AND org_id = p_org_id
    FOR UPDATE;

  -- No matching row: mirror the pre-RPC behavior (a no-op UPDATE, still
  -- reports no repin) rather than raising.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_memory := coalesce(v_memory, '{}'::jsonb);
  v_commerce := coalesce(v_memory->'commerce', '{}'::jsonb);
  v_old_cart := v_commerce->>'cart';
  v_existing_cnonce := v_commerce->>'cnonce';

  -- cnonce binding (X2, contract §3 v2): NULL existing cnonce means this is
  -- the conversation's first pin -- accept and record p_cnonce. A non-NULL
  -- existing cnonce that DISTINCT-FROM p_cnonce means a re-pin attempt from a
  -- different browser/page-load than the one that owns this conversation --
  -- abort the ENTIRE merge (no write of any kind) and signal rejection.
  IF v_existing_cnonce IS NOT NULL AND v_existing_cnonce IS DISTINCT FROM p_cnonce THEN
    RETURN jsonb_build_object('rejected', true);
  END IF;

  v_commerce := v_commerce || jsonb_build_object(
    'cart', p_cart,
    'cus', p_cus,
    'email', p_email,
    'wishlist_ref', p_wishlist_ref,
    'country_code', p_country_code,
    'region_id', p_region_id,
    'cnonce', coalesce(v_existing_cnonce, p_cnonce),
    -- Matches JS's new Date().toISOString() format (millisecond precision, Z suffix).
    'verified_at', to_jsonb(to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  );
  v_memory := jsonb_set(v_memory, '{commerce}', v_commerce, true);

  UPDATE public.conversations
    SET memory = v_memory
    WHERE id = p_conversation_id AND org_id = p_org_id;

  IF v_old_cart IS NOT NULL AND v_old_cart IS DISTINCT FROM p_cart THEN
    RETURN jsonb_build_object('repinnedFrom', v_old_cart);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.medusa_write_commerce_context(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medusa_write_commerce_context(uuid, uuid, text, text, text, text, text, text, text) TO service_role;

COMMIT;

-- =============================================================================
-- Footer
--   commerce_context_jti -- one-time consumption ledger for token jti claims.
--   medusa_consume_context_jti -- atomic insert-once jti consume. Caller:
--     src/lib/medusa/context.ts's consumeContextJti, called by the chat route
--     BEFORE writeCommerceContext on every pin attempt.
--   medusa_write_commerce_context -- REPLACED to add cnonce binding: first
--     pin records cnonce, later re-pins must match it or the merge aborts
--     with {"rejected": true} and the prior pin survives untouched. Caller:
--     src/lib/medusa/context.ts's writeCommerceContext.
--   Together these close the X2 finding: a context token copied out of one
--   conversation and POSTed into another conversation of the same org is
--   rejected either as a jti replay (if the legitimate widget already used
--   it) or as a cnonce mismatch (the attacker's page load has a different
--   cnonce than the victim conversation's first pin) -- on top of the TTL
--   drop from 900s to 300s (layer 1, no schema change needed).
-- =============================================================================
