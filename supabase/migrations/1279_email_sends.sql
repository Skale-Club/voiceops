-- Migration 1279: email_sends — send log for every outbound email
--
-- Today there is NO record of any email sent through sendTenantEmail /
-- sendPlatformEmail (src/lib/email/resend.ts). conversation_messages.
-- email_message_id only exists for inbox replies, so delivery events
-- (bounce/complaint/failure/open/click) from workflow-, campaign-, invite-
-- and calendar-sent email match zero rows in the Resend webhook
-- (src/app/api/resend/events/route.ts) and are silently discarded.
--
-- org_id is nullable because sendPlatformEmail has no org context (platform-
-- level sends — e.g. an invite email sent before the recipient has an org).
-- RLS below only matches rows where org_id equals the caller's active org,
-- so org_id IS NULL rows are invisible to tenants by construction (NULL = x
-- is NULL, never true) — only the service-role client (used exclusively by
-- resend.ts and the webhook) can read/write them.
CREATE TABLE IF NOT EXISTS public.email_sends (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider            text        NOT NULL DEFAULT 'resend',
  provider_message_id text,
  to_email            text        NOT NULL,
  from_email          text,
  subject             text,
  kind                text,       -- 'marketing' | 'transactional' (mirrors EmailKind in resend.ts)
  source              text,       -- free-form origin marker: 'inbox_reply' | 'workflow' | 'campaign' | 'invite' | 'calendar' | 'template_test' | ...
  template_id         uuid,
  status              text        NOT NULL DEFAULT 'sent', -- 'sent' | 'skipped' | 'failed' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked'
  error               text,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Recent-sends lookups (inbox/activity views), scoped per org.
CREATE INDEX IF NOT EXISTS idx_email_sends_org_created
  ON public.email_sends (org_id, created_at DESC);

-- The Resend webhook (src/app/api/resend/events/route.ts) looks up the row
-- to update by provider_message_id — this is its only access path.
CREATE INDEX IF NOT EXISTS idx_email_sends_provider_message_id
  ON public.email_sends (provider_message_id);

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_sends_org_isolation ON public.email_sends;
CREATE POLICY email_sends_org_isolation ON public.email_sends
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- CREATE TRIGGER has no IF NOT EXISTS — drop first so the whole file stays
-- re-runnable like the CREATE TABLE/INDEX statements above.
DROP TRIGGER IF EXISTS trg_email_sends_updated_at ON public.email_sends;
CREATE TRIGGER trg_email_sends_updated_at
  BEFORE UPDATE ON public.email_sends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.email_sends IS
  'Send log for every outbound email (tenant + platform). Written best-effort by src/lib/email/resend.ts; updated by the Resend delivery-events webhook via provider_message_id. org_id NULL = platform-level send, not tenant-readable.';
