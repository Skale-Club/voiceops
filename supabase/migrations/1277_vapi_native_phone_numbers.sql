-- =============================================================================
-- Migration 1277: Vapi-native phone numbers
--
-- Problem: the platform assumes every phone number is a Twilio number.
-- `twilio_phone_numbers` has no provider column, yet it is the table that feeds
-- routing, the {{phone.*}} workflow scope (src/lib/twilio/scope.ts), inbox
-- filters, and the phone_number_id FK on conversations / call_logs.
--
-- That fits the "customer wants a number + their own dialer" case. It breaks the
-- opposite case: the customer already owns their number inside Vapi and wants
-- Vapi purely as the answering bot. There, Twilio never enters the picture, but
-- Xphere still has to record which number a call landed on, play the recording,
-- and fire workflows off that call.
--
-- This migration:
--   1. Adds `provider` + `vapi_phone_number_id` to twilio_phone_numbers so a row
--      can represent a Vapi-native number.
--   2. Adds phone_number_id / vapi_phone_number_id / org_number to `calls`, which
--      until now had no column at all for the org's own number — Vapi calls were
--      attributed to an org solely via assistant_id.
--   3. Recreates unified_calls exposing phone_number_id on both branches.
--
-- The table keeps its physical name: renaming it to `phone_numbers` would touch
-- ~25 files for no functional gain. Tracked as debt.
-- =============================================================================

BEGIN;

-- ── 1. twilio_phone_numbers: provider awareness ─────────────────────────────

ALTER TABLE public.twilio_phone_numbers
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'twilio',
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id TEXT;

-- Existing rows are all Twilio by construction (the DEFAULT already covers the
-- backfill); the CHECK is added afterwards so it validates them in place.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'twilio_phone_numbers_provider_check'
  ) THEN
    ALTER TABLE public.twilio_phone_numbers
      ADD CONSTRAINT twilio_phone_numbers_provider_check
      CHECK (provider IN ('twilio', 'vapi'));
  END IF;
END $$;

-- A Vapi number id is globally unique inside Vapi, but two orgs can legitimately
-- connect two different Vapi accounts, so the uniqueness is scoped per org —
-- mirroring the existing UNIQUE (organization_id, e164). The import action is
-- what refuses to steal a number already claimed by another org.
CREATE UNIQUE INDEX IF NOT EXISTS twilio_phone_numbers_org_vapi_number
  ON public.twilio_phone_numbers (organization_id, vapi_phone_number_id)
  WHERE vapi_phone_number_id IS NOT NULL;

-- Webhook lookup path: resolve the org from call.phoneNumberId when the
-- assistant isn't mapped. Partial + non-unique so it stays cheap.
CREATE INDEX IF NOT EXISTS idx_twilio_phone_numbers_vapi_number
  ON public.twilio_phone_numbers (vapi_phone_number_id)
  WHERE vapi_phone_number_id IS NOT NULL;

COMMENT ON COLUMN public.twilio_phone_numbers.provider IS
  'Which provider owns this number: twilio (default, has phone_sid + webhooks) or vapi (Vapi-native, no Twilio account involved).';
COMMENT ON COLUMN public.twilio_phone_numbers.vapi_phone_number_id IS
  'Vapi phone-number UUID (GET /phone-number). Set only when provider = vapi.';

-- ── 2. calls: attribute the call to the org's own number ────────────────────

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS phone_number_id UUID
    REFERENCES public.twilio_phone_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS org_number TEXT;

-- vapi_phone_number_id is kept alongside the FK on purpose: a call can arrive on
-- a Vapi number that was never imported locally, and we still want it traceable.
COMMENT ON COLUMN public.calls.vapi_phone_number_id IS
  'Raw Vapi phone-number id from the end-of-call report, kept even when no local twilio_phone_numbers row exists.';
COMMENT ON COLUMN public.calls.org_number IS
  'E.164 of the org-side number that received or placed the call (counterpart of customer_number).';

CREATE INDEX IF NOT EXISTS idx_calls_phone_number
  ON public.calls (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- ── 3. unified_calls: expose the number on both branches ────────────────────
-- Preserves migration 1248 verbatim except for the added phone_number_id column
-- (AI branch: new; human branch: the column already existed on call_logs but was
-- never selected).

DROP VIEW IF EXISTS public.unified_calls;

CREATE VIEW public.unified_calls
WITH (security_invoker = true) AS
SELECT
  c.id,
  'ai'::text                            AS call_type,
  c.organization_id                     AS org_id,
  c.vapi_call_id                        AS external_id,
  c.customer_number                     AS counterpart_number,
  c.customer_name                       AS counterpart_name,
  NULL::uuid                            AS contact_id,
  CASE WHEN c.call_type = 'outboundPhoneCall' THEN 'outbound' ELSE 'inbound' END
                                         AS direction,
  c.duration_seconds,
  c.status,
  c.ended_reason                        AS substatus,
  c.recording_url                       AS recording_url,
  NULL::integer                         AS recording_duration,
  c.transcript,
  c.summary                             AS notes,
  c.cost,
  c.assistant_id,
  NULL::text                            AS routing_mode,
  c.phone_number_id,
  c.org_number,
  COALESCE(c.started_at, c.created_at)  AS started_at,
  c.ended_at,
  c.created_at
FROM public.calls c

UNION ALL

SELECT
  l.id,
  'human'::text                                                AS call_type,
  l.org_id,
  l.call_sid                                                   AS external_id,
  CASE WHEN l.direction = 'inbound' THEN l.from_number ELSE l.to_number END
                                                               AS counterpart_number,
  NULL::text                                                   AS counterpart_name,
  l.contact_id,
  l.direction,
  l.duration_seconds,
  l.status,
  NULL::text                                                   AS substatus,
  l.recording_url,
  l.recording_duration,
  NULL::text                                                   AS transcript,
  l.notes,
  NULL::numeric                                                AS cost,
  NULL::text                                                   AS assistant_id,
  l.routing_mode,
  l.phone_number_id,
  CASE WHEN l.direction = 'inbound' THEN l.to_number ELSE l.from_number END
                                                               AS org_number,
  COALESCE(l.started_at, l.created_at)                         AS started_at,
  l.ended_at,
  l.created_at
FROM public.call_logs l;

GRANT SELECT ON public.unified_calls TO authenticated, anon;

COMMENT ON VIEW public.unified_calls IS
  'Unified read-only view of AI (calls) + human (call_logs) call records. RLS inherits from base tables via SECURITY INVOKER. Migration 1277: adds phone_number_id and org_number on both branches so calls can be filtered by the org-side number regardless of provider.';

COMMIT;
