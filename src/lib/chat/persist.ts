// src/lib/chat/persist.ts
// Supabase service-role write helpers for chat persistence.
// IMPORTANT: Always uses createServiceRoleClient() | no auth session exists on the
// public chat API route. Never use the authenticated Supabase client here.
//
// Tables: `conversations` + `conversation_messages` (the only persistence world for chat).
// See .planning/codebase/chat-data-boundary.md for the full data lifecycle.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { ChatSessionContext } from './session'

// Cap on how many past turns loadSessionFromDb() rebuilds into historyWindow.
// Mirrors the rough size of the Redis cache (session.ts docs "last 10 message
// turns" — a turn is a user+assistant pair, so 20 rows ~= 10 turns).
const HISTORY_FALLBACK_LIMIT = 20

/**
 * Create a new conversations row in Supabase.
 * Returns the UUID of the newly created row (conversations.id).
 * Throws on DB error | caller must handle.
 */
export async function ensureDbSession(opts: {
  orgId: string
  sessionId: string    // client-facing UUID | stored as session_key for Phase 3 history reload
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
 * Throws on DB error | caller should use after() so errors don't block the response.
 */
export async function persistMessage(opts: {
  dbSessionId: string
  orgId: string
  role: 'user' | 'assistant'
  content: string
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  const supabase = createServiceRoleClient()

  const { error: insertError } = await supabase.from('conversation_messages').insert({
    conversation_id: opts.dbSessionId,
    org_id: opts.orgId,
    role: opts.role,
    content: opts.content,
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
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

/**
 * Rebuild a ChatSessionContext straight from Postgres when Redis has no
 * session for an incoming client sessionId (Redis down, evicted, or past its
 * 1h sliding TTL — session.ts's getSession() returned null either way).
 *
 * `conversations.session_key` is UNIQUE (migration 012) and is exactly what
 * ensureDbSession() stores as the client-facing sessionId, so this is a
 * direct reload of the same identity Redis would have cached — not a guess.
 * The org_id match is defense-in-depth against cross-org sessionId reuse
 * (mirrors the `existingSession.orgId === org.id` check on the Redis path).
 *
 * Returns null if no matching conversation exists — caller mints a new one.
 * Throws on a genuine DB error; callers must not let that 500 the route
 * (Postgres being briefly unhappy on top of Redis being down should degrade
 * to "start a fresh session", not "the whole chat is broken").
 */
export async function loadSessionFromDb(opts: {
  orgId: string
  sessionId: string
}): Promise<ChatSessionContext | null> {
  const supabase = createServiceRoleClient()

  const { data: convo, error: convoError } = await supabase
    .from('conversations')
    .select('id, created_at')
    .eq('org_id', opts.orgId)
    .eq('session_key', opts.sessionId)
    .maybeSingle()
  if (convoError) throw convoError
  if (!convo) return null

  // Most recent N rows first (cheap index scan), then reverse to the
  // oldest→newest order historyWindow/runAgent expects.
  const { data: rows, error: msgError } = await supabase
    .from('conversation_messages')
    .select('role, content, created_at')
    .eq('conversation_id', convo.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_FALLBACK_LIMIT)
  if (msgError) throw msgError

  const messages: ChatSessionContext['messages'] = (rows ?? [])
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .reverse()
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))

  return {
    orgId: opts.orgId,
    sessionId: opts.sessionId,
    dbSessionId: convo.id,
    messages,
    createdAt: convo.created_at,
    lastActiveAt: new Date().toISOString(),
  }
}
