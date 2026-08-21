-- NOTE: recovered from supabase_migrations.schema_migrations on 2026-08-21.
-- This migration was applied directly to the production database and had no
-- file in the repository, so a `supabase db push` from a clean checkout could
-- not reproduce production. The SQL below is the statement list the database
-- recorded, re-joined with the statement terminators the CLI's parser strips.

-- =============================================================================
-- Migration 1283: Atomic Medusa commerce-context writes (X9 hardening)
--
-- src/lib/medusa/context.ts's writeCommerceContext, pinCartId and
-- bumpConversationWriteCount each did SELECT memory -> mutate in JS -> UPDATE
-- memory with no concurrency control. Two concurrent tool calls in the same
-- conversation (e.g. an add-to-cart write racing a commerce-context refresh)
-- could interleave: both read the same `memory` snapshot, then the second
-- UPDATE clobbers whatever the first one wrote -- lost writes, and (for
-- writeCommerceContext specifically) a full-object replace of `commerce`
-- that wiped sibling keys like `write_count` even without a race.
--
-- Replaces all three with SECURITY DEFINER RPCs that SELECT ... FOR UPDATE
-- the conversations row (serializing concurrent callers on that row) and
-- jsonb_set/`||`-merge only the specific keys each caller owns, leaving
-- sibling `memory.commerce.*` keys untouched. Precedent: migration 1251's
-- transition_booking_status (same FOR UPDATE + SECURITY DEFINER shape) and
-- migration 1282's record_cron_heartbeat (same "atomic increment via RPC,
-- not read-then-write" motivation).
--
-- All three functions are called exclusively with the service-role client
-- (src/lib/medusa/client.ts's MedusaExecCtx.supabase is always
-- createServiceRoleClient()) -- locked to service_role only, same as
-- transition_booking_status / record_cron_heartbeat.
--
-- Idempotent migration: safe to re-run (CREATE OR REPLACE FUNCTION).
-- =============================================================================

BEGIN;

-- ── 1. medusa_pin_cart_id ───────────────────────────────────
-- Cart-only re-pin (contract §3 -- the one legitimate non-token re-pin).
-- Touches ONLY memory.commerce.cart; every other commerce key (region_id,
-- cus, email, wishlist_ref, write_count, verified_at, ...) survives
-- untouched, including under concurrent callers.

CREATE OR REPLACE FUNCTION public.medusa_pin_cart_id(
  p_conversation_id uuid,
  p_org_id uuid,
  p_cart_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_memory jsonb;
  v_commerce jsonb;
BEGIN
  SELECT memory INTO v_memory
    FROM public.conversations
    WHERE id = p_conversation_id AND org_id = p_org_id
    FOR UPDATE;

  -- No matching row: mirror the pre-RPC behavior (a no-op UPDATE) rather
  -- than raising -- callers never branched on pinCartId's return value.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_memory := coalesce(v_memory, '{}'::jsonb);
  v_commerce := coalesce(v_memory->'commerce', '{}'::jsonb);
  v_commerce := jsonb_set(v_commerce, '{cart}', to_jsonb(p_cart_id), true);
  v_memory := jsonb_set(v_memory, '{commerce}', v_commerce, true);

  UPDATE public.conversations
    SET memory = v_memory
    WHERE id = p_conversation_id AND org_id = p_org_id;
END $$;

REVOKE ALL ON FUNCTION public.medusa_pin_cart_id(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.medusa_pin_cart_id(uuid, uuid, text) TO service_role;

-- ── 2. medusa_write_commerce_context ────────────────────────
-- Merges a VERIFIED storefront token's claims into memory.commerce.
-- Touches ONLY the seven claim-derived keys (cart/cus/email/wishlist_ref/
-- country_code/region_id/verified_at) via a jsonb `||` merge -- unlike the
-- old JS version, which replaced the ENTIRE `commerce` object and silently
-- dropped sibling keys such as write_count even outside a race. Returns
-- {"repinnedFrom": <old cart id>} when a DIFFERENT cart was previously
-- pinned (fresh verified token is the sole re-pin authority, contract §3),
-- else NULL -- same shape/semantics as the old writeCommerceContext.

CREATE OR REPLACE FUNCTION public.medusa_write_commerce_context(
  p_conversation_id uuid,
  p_org_id uuid,
  p_cart text,
  p_cus text,
  p_email text,
  p_wishlist_ref text,
  p_country_code text,
  p_region_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_memory jsonb;
  v_commerce jsonb;
  v_old_cart text;
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

  v_commerce := v_commerce || jsonb_build_object(
    'cart', p_cart,
    'cus', p_cus,
    'email', p_email,
    'wishlist_ref', p_wishlist_ref,
    'country_code', p_country_code,
    'region_id', p_region_id,
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

REVOKE ALL ON FUNCTION public.medusa_write_commerce_context(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.medusa_write_commerce_context(uuid, uuid, text, text, text, text, text, text) TO service_role;

-- ── 3. medusa_increment_write_count ───────────────────────
-- CRT-02's 25-writes-per-conversation cap. Atomically reads
-- memory.commerce.write_count and, if still under p_cap, increments it via
-- jsonb_set (sibling commerce keys untouched) and returns
-- {"allowed": true, "count": <new count>}; once the cap is reached it
-- returns {"allowed": false, "count": <current count>} WITHOUT writing --
-- same contract callers already turn into a friendly denial string, never a
-- throw.

CREATE OR REPLACE FUNCTION public.medusa_increment_write_count(
  p_conversation_id uuid,
  p_org_id uuid,
  p_cap integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_memory jsonb;
  v_commerce jsonb;
  v_count integer;
  v_next integer;
BEGIN
  SELECT memory INTO v_memory
    FROM public.conversations
    WHERE id = p_conversation_id AND org_id = p_org_id
    FOR UPDATE;

  v_memory := coalesce(v_memory, '{}'::jsonb);
  v_commerce := coalesce(v_memory->'commerce', '{}'::jsonb);
  v_count := coalesce((v_commerce->>'write_count')::integer, 0);

  IF v_count >= p_cap THEN
    RETURN jsonb_build_object('allowed', false, 'count', v_count);
  END IF;

  v_next := v_count + 1;
  v_commerce := jsonb_set(v_commerce, '{write_count}', to_jsonb(v_next), true);
  v_memory := jsonb_set(v_memory, '{commerce}', v_commerce, true);

  -- No matching row: mirror the pre-RPC behavior (a no-op UPDATE that still
  -- reports allowed:true against the computed in-memory count) rather than
  -- raising -- FOUND is checked AFTER the compute, same ordering as the old
  -- SELECT-then-UPDATE JS code, which never branched on the update's rowcount.
  IF FOUND THEN
    UPDATE public.conversations
      SET memory = v_memory
      WHERE id = p_conversation_id AND org_id = p_org_id;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'count', v_next);
END $$;

REVOKE ALL ON FUNCTION public.medusa_increment_write_count(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.medusa_increment_write_count(uuid, uuid, integer) TO service_role;

COMMIT;

-- =============================================================================
-- Footer
--   medusa_pin_cart_id -- atomic cart-only re-pin. Caller:
--     src/lib/medusa/context.ts's pinCartId.
--   medusa_write_commerce_context -- atomic verified-claims merge. Caller:
--     src/lib/medusa/context.ts's writeCommerceContext.
--   medusa_increment_write_count -- atomic CRT-02 write-budget increment.
--     Caller: src/lib/medusa/context.ts's bumpConversationWriteCount.
--   All three replace a SELECT-then-UPDATE race in application code with a
--   SELECT ... FOR UPDATE + partial jsonb merge inside one transaction, so
--   concurrent tool calls in the same conversation can no longer lose an
--   increment or clobber a sibling memory.commerce key.
-- =============================================================================
