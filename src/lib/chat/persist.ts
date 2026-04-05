// src/lib/chat/persist.ts
// Supabase service-role write helpers for chat persistence.
// IMPORTANT: Always uses createServiceRoleClient() — no auth session exists on the
// public chat API route. Never use the authenticated Supabase client here.
import { createServiceRoleClient } from '@/lib/supabase/admin'

/**
 * Create a new conversations row in Supabase.
 * Returns the UUID of the newly created row (conversations.id).
 * Throws on DB error — caller must handle.
 */
export async function ensureDbSession(opts: {
  orgId: string
  sessionId: string    // client-facing UUID — stored as session_key for Phase 3 history reload
  widgetToken: string
}): Promise<string> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      org_id: opts.orgId,
      widget_token: opts.widgetToken,
      session_key: opts.sessionId,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/**
 * Persist a single message turn to conversation_messages.
 * Also updates conversations.last_message, last_message_at, and updated_at
 * so the admin inbox preview row stays current for every visitor message.
 * Throws on DB error — caller should use after() so errors don't block the response.
 */
export async function persistMessage(opts: {
  dbSessionId: string
  orgId: string
  role: 'user' | 'assistant'
  content: string
}): Promise<void> {
  const supabase = createServiceRoleClient()

  const { error: insertError } = await supabase.from('conversation_messages').insert({
    conversation_id: opts.dbSessionId,
    org_id: opts.orgId,
    role: opts.role,
    content: opts.content,
  })
  if (insertError) throw insertError

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('conversations')
    .update({
      last_message: opts.content,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', opts.dbSessionId)
  if (updateError) throw updateError
}
