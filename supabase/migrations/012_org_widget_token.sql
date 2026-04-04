-- =============================================================================
-- Migration 012: Add widget_token to organizations + session_key to chat_sessions
-- Phase: 02-chat-api (v1.2)
-- widget_token: per-org public token used by the chat widget to identify the org.
-- session_key: client-facing session UUID stored server-side so Phase 3 can
--              reload message history after Redis TTL expiry.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add widget_token to organizations
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN widget_token TEXT UNIQUE;

-- Backfill existing orgs. Uses gen_random_uuid() (always available in Supabase)
-- rather than pgcrypto to avoid extension dependency.
UPDATE public.organizations
  SET widget_token = replace(gen_random_uuid()::text, '-', '')
  WHERE widget_token IS NULL;

ALTER TABLE public.organizations
  ALTER COLUMN widget_token SET NOT NULL;

CREATE INDEX idx_organizations_widget_token
  ON public.organizations USING btree (widget_token);

-- ---------------------------------------------------------------------------
-- 2. Add session_key to chat_sessions
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_sessions
  ADD COLUMN session_key TEXT UNIQUE;

CREATE INDEX idx_chat_sessions_session_key
  ON public.chat_sessions USING btree (session_key);
