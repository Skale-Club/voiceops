-- =============================================================================
-- Migration 011: Chat Schema — chat_sessions + chat_messages
-- Phase: 01-foundation (v1.2)
-- RLS note: Both tables use authenticated-only policies.
-- The public chat API (Phase 2) writes via createServiceRoleClient() which
-- bypasses RLS — no anon policy is needed or desired (avoids multi-tenant data leaks).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- chat_sessions: one record per anonymous visitor session per org
-- ---------------------------------------------------------------------------
CREATE TABLE public.chat_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  widget_token    TEXT        NOT NULL,
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_org_id      ON public.chat_sessions USING btree (organization_id);
CREATE INDEX idx_chat_sessions_last_active ON public.chat_sessions USING btree (last_active_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation"
  ON public.chat_sessions
  FOR ALL
  TO authenticated
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- chat_messages: one record per message turn (user, assistant, or tool)
-- organization_id is denormalized for RLS policy without joining sessions.
-- ---------------------------------------------------------------------------
CREATE TABLE public.chat_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_id ON public.chat_messages USING btree (session_id);
CREATE INDEX idx_chat_messages_org_id     ON public.chat_messages USING btree (organization_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation"
  ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());
