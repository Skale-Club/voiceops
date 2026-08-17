-- Migration 1280: per-integration Resend webhook signing secret
--
-- The Resend webhook routes (/api/resend/events, /api/resend/inbound) still
-- read process.env.RESEND_WEBHOOK_SECRET — the last env-var dependency for
-- Resend webhooks. Each tenant has their OWN Resend account, so each
-- tenant's webhook in their Resend dashboard signs with its own secret; the
-- platform account has its own too. The secret is therefore per-integration,
-- not global — stored encrypted (AES-256-GCM, src/lib/crypto.ts) alongside
-- the existing api_key_encrypted column on each settings table.
--
-- src/lib/email/webhook-secrets.ts reads every configured secret (platform +
-- all tenants) and the webhook routes accept the event if ANY of them
-- validates the signature.
ALTER TABLE public.tenant_email_integrations
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted text;

ALTER TABLE public.platform_email_settings
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted text;

COMMENT ON COLUMN public.tenant_email_integrations.webhook_secret_encrypted IS
  'Resend (Svix) webhook signing secret for this tenant''s own Resend account, AES-256-GCM encrypted. Set in Settings → Email. NULL = webhook signature validation skips this row.';

COMMENT ON COLUMN public.platform_email_settings.webhook_secret_encrypted IS
  'Resend (Svix) webhook signing secret for the platform Resend account, AES-256-GCM encrypted. Set in /admin/settings/email. NULL = webhook signature validation skips this row.';
