-- =============================================================================
-- Migration 003: Observability Schema
-- Phase: 03-observability
-- Requirements: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Section 1: calls table
-- ---------------------------------------------------------------------------
-- Central call log — one row per completed Vapi call.
-- vapi_call_id TEXT UNIQUE: joins with action_logs.vapi_call_id (also TEXT).
-- transcript_turns JSONB: stores artifact.messages array verbatim (NOT the flat string).
-- duration_seconds GENERATED: auto-computed from started_at/ended_at timestamps.
-- cost NUMERIC(10,6): 6 decimal places to avoid Vapi float precision loss.

CREATE TABLE public.calls (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vapi_call_id      TEXT        NOT NULL UNIQUE,
  assistant_id      TEXT,
  call_type         TEXT,
  status            TEXT,
  ended_reason      TEXT,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER     GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
  ) STORED,
  cost              NUMERIC(10,6),
  customer_number   TEXT,
  customer_name     TEXT,
  summary           TEXT,
  transcript        TEXT,
  transcript_turns  JSONB       NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Section 2: Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_calls_org_id          ON public.calls(organization_id);
CREATE INDEX idx_calls_created         ON public.calls(created_at DESC);
CREATE INDEX idx_calls_vapi_call_id    ON public.calls(vapi_call_id);
CREATE INDEX idx_calls_org_created     ON public.calls(organization_id, created_at DESC);
CREATE INDEX idx_calls_customer_number ON public.calls(customer_number);
CREATE INDEX idx_calls_customer_name   ON public.calls(lower(customer_name));

-- ---------------------------------------------------------------------------
-- Section 3: RLS policies for calls
-- ---------------------------------------------------------------------------
-- SELECT: authenticated users can read their org's calls (RLS-scoped via get_current_org_id).
-- INSERT: service-role only (end-of-call webhook uses service-role key, bypasses RLS).
-- No UPDATE or DELETE: calls table is append-only.

CREATE POLICY "calls_select" ON public.calls
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));
