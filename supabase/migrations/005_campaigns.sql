-- =============================================================================
-- Migration 005: Outbound Campaigns Schema
-- Phase: 05-outbound-campaigns
-- Requirements: CAMP-01, CAMP-02, CAMP-03, CAMP-06, CAMP-07
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Section 1: campaigns table
-- ---------------------------------------------------------------------------
-- status TEXT CHECK: draft → scheduled → in_progress → paused → completed | stopped
-- vapi_campaign_id TEXT nullable: set after Vapi Campaign API is called (or individual calls start)
-- calls_per_minute INTEGER: stored as metadata; actual concurrency controlled by Vapi.
--   For MVP with individual POST /call approach, used to limit batch size per loop tick.
-- vapi_phone_number_id: required for outbound calls (Vapi phone number UUID)

CREATE TABLE public.campaigns (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL,
  vapi_assistant_id     TEXT        NOT NULL,
  vapi_phone_number_id  TEXT        NOT NULL,
  vapi_campaign_id      TEXT,
  status                TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','in_progress','paused','completed','stopped')),
  scheduled_start_at    TIMESTAMPTZ,
  calls_per_minute      INTEGER     NOT NULL DEFAULT 5 CHECK (calls_per_minute BETWEEN 1 AND 20),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Section 2: campaign_contacts table
-- ---------------------------------------------------------------------------
-- organization_id denormalized here (not joined through campaigns) — required for
--   RLS policy evaluation performance and for webhook service-role writes.
-- UNIQUE(campaign_id, phone) — CAMP-07: enforces no duplicate dials at DB level.
-- vapi_call_id TEXT nullable — set when individual POST /call is fired; enables
--   webhook correlation (end-of-call payload carries call.id).
-- status TEXT CHECK: pending → calling → completed | failed | no_answer
-- custom_data JSONB — CSV columns beyond name+phone stored here for variableValues.

CREATE TABLE public.campaign_contacts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT,
  phone           TEXT        NOT NULL,
  custom_data     JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','calling','completed','failed','no_answer')),
  vapi_call_id    TEXT,
  error_detail    TEXT,
  called_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  retry_count     INTEGER     NOT NULL DEFAULT 0 CHECK (retry_count <= 2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, phone)
);

-- CRITICAL: REPLICA IDENTITY FULL required so Supabase Realtime broadcasts the
-- full updated row (not just the PK) on UPDATE events.
-- Without this, payload.new on the client will only contain { id }.
ALTER TABLE public.campaign_contacts REPLICA IDENTITY FULL;

ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Section 3: Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_campaigns_org_id          ON public.campaigns(organization_id);
CREATE INDEX idx_campaigns_status          ON public.campaigns(status);
CREATE INDEX idx_campaigns_org_status      ON public.campaigns(organization_id, status);

CREATE INDEX idx_campaign_contacts_campaign_id ON public.campaign_contacts(campaign_id);
CREATE INDEX idx_campaign_contacts_org_id      ON public.campaign_contacts(organization_id);
CREATE INDEX idx_campaign_contacts_status      ON public.campaign_contacts(campaign_id, status);
CREATE INDEX idx_campaign_contacts_vapi_call_id ON public.campaign_contacts(vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Section 4: RLS policies — campaigns
-- ---------------------------------------------------------------------------
-- SELECT: org-scoped via get_current_org_id() subquery wrapper.
-- INSERT/UPDATE/DELETE: service-role only (server actions use service-role client).

CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- Section 5: RLS policies — campaign_contacts
-- ---------------------------------------------------------------------------
-- SELECT: org-scoped. Webhook updates use service-role key which bypasses RLS.

CREATE POLICY "campaign_contacts_select" ON public.campaign_contacts
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));
