-- =============================================================================
-- Migration 015: Chat Inbox Schema — rename chat_sessions/chat_messages,
--                add conversations admin columns
-- Phase: 06-chat-inbox (v1.2)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Rename chat_sessions -> conversations
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_sessions RENAME TO conversations;

-- Rename the organization_id column to org_id for consistency with new schema
ALTER TABLE public.conversations RENAME COLUMN organization_id TO org_id;

-- Add new admin-inbox columns to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_page_url TEXT,
  ADD COLUMN IF NOT EXISTS visitor_name   TEXT,
  ADD COLUMN IF NOT EXISTS visitor_phone  TEXT,
  ADD COLUMN IF NOT EXISTS visitor_email  TEXT,
  ADD COLUMN IF NOT EXISTS last_message   TEXT,
  ADD COLUMN IF NOT EXISTS memory         JSONB NOT NULL DEFAULT '{}';

-- Rename indexes to reflect new table name
ALTER INDEX IF EXISTS idx_chat_sessions_org_id      RENAME TO idx_conversations_org_id;
ALTER INDEX IF EXISTS idx_chat_sessions_last_active  RENAME TO idx_conversations_last_message_at;

-- Add status index for filtering
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations USING btree (status);

-- Drop old RLS policy and recreate with new column name
DROP POLICY IF EXISTS "org_isolation" ON public.conversations;
CREATE POLICY "org_isolation"
  ON public.conversations
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- Step 2: Rename chat_messages -> conversation_messages
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_messages RENAME TO conversation_messages;

-- Rename session_id -> conversation_id
ALTER TABLE public.conversation_messages RENAME COLUMN session_id TO conversation_id;

-- Rename organization_id -> org_id
ALTER TABLE public.conversation_messages RENAME COLUMN organization_id TO org_id;

-- Drop role check (old: 'user' | 'assistant' | 'tool') and add metadata column
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Rename indexes
ALTER INDEX IF EXISTS idx_chat_messages_session_id  RENAME TO idx_conversation_messages_conversation_id;
ALTER INDEX IF EXISTS idx_chat_messages_org_id      RENAME TO idx_conversation_messages_org_id;
ALTER INDEX IF EXISTS idx_chat_messages_created_at  RENAME TO idx_conversation_messages_created_at;

-- Drop old RLS policy and recreate with new column name
DROP POLICY IF EXISTS "org_isolation" ON public.conversation_messages;
CREATE POLICY "org_isolation"
  ON public.conversation_messages
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());
