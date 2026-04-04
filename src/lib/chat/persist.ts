// src/lib/chat/persist.ts
// Supabase service-role write helpers for chat persistence.
// IMPORTANT: Always uses createServiceRoleClient() — no auth session exists on the
// public chat API route. Never use the authenticated Supabase client here.
import { createServiceRoleClient } from '@/lib/supabase/admin'

/**
 * Create a new chat_sessions row in Supabase.
 * Returns the UUID of the newly created row (chat_sessions.id).
 * Throws on DB error — caller must handle.
 */
export async function ensureDbSession(opts: {
  orgId: string
  sessionId: string    // client-facing UUID — stored as session_key for Phase 3 history reload
  widgetToken: string
}): Promise<string> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      organization_id: opts.orgId,
      widget_token: opts.widgetToken,
      session_key: opts.sessionId,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/**
 * Persist a single message turn to chat_messages.
 * Throws on DB error — caller should use after() so errors don't block the response.
 */
export async function persistMessage(opts: {
  dbSessionId: string
  orgId: string
  role: 'user' | 'assistant'
  content: string
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('chat_messages').insert({
    session_id: opts.dbSessionId,
    organization_id: opts.orgId,
    role: opts.role,
    content: opts.content,
  })
  if (error) throw error
}
