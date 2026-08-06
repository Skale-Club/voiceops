-- 1264: Email verification as the prospect's source of truth.
--
-- Prospects are scraped businesses; sending to invalid emails causes bounces
-- that damage sending-domain reputation. Verification status lives ON the
-- prospect row (contacts + accounts) — not per-campaign — so it is checked
-- once, cached, and every outreach channel benefits from it.
--
-- Companies keep their scraped address in custom_fields.email (accounts has
-- no email column); only the verification STATUS gets real columns here.
--
-- Consumed by src/lib/email-verification/{providers,credits,verify}.ts and
-- the prospects_enroll_in_campaign / prospect_send_message MCP tools
-- (src/lib/mcp/tools/prospects.ts, prospect-send-message.ts).

-- ----- contacts ---------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_status               text,
  ADD COLUMN IF NOT EXISTS email_verified_at           timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_provider text,
  ADD COLUMN IF NOT EXISTS email_risk                  text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_email_status_check'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_status_check
      CHECK (email_status IS NULL OR email_status = ANY (ARRAY[
        'ok'::text, 'catch_all'::text, 'unknown'::text,
        'disposable'::text, 'invalid'::text, 'bounced'::text
      ]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_email_risk_check'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_risk_check
      CHECK (email_risk IS NULL OR email_risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_email_status ON public.contacts (org_id, email_status);

-- ----- accounts -----------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS email_status               text,
  ADD COLUMN IF NOT EXISTS email_verified_at           timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_provider text,
  ADD COLUMN IF NOT EXISTS email_risk                  text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_email_status_check'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_email_status_check
      CHECK (email_status IS NULL OR email_status = ANY (ARRAY[
        'ok'::text, 'catch_all'::text, 'unknown'::text,
        'disposable'::text, 'invalid'::text, 'bounced'::text
      ]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_email_risk_check'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_email_risk_check
      CHECK (email_risk IS NULL OR email_risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_email_status ON public.accounts (org_id, email_status);
