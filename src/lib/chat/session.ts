// src/lib/chat/session.ts
// Redis-backed session helpers for the public chat API.
// All operations check redis.isReady before touching the client — if Redis is
// unavailable, reads return null and writes are no-ops (graceful degradation per D-07).
import redis from '@/lib/redis'

const SESSION_TTL = 3600 // 1 hour sliding window

export interface ChatSessionContext {
  orgId: string
  sessionId: string      // client-facing UUID (Redis key suffix, returned in response)
  dbSessionId: string    // chat_sessions.id UUID (Supabase row — never sent to client)
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  createdAt: string      // ISO timestamp
  lastActiveAt: string   // ISO timestamp — updated on every message
}

/**
 * Retrieve a session context from Redis.
 * Returns null if the key is missing, Redis is unavailable, or JSON parse fails.
 */
export async function getSession(sessionId: string): Promise<ChatSessionContext | null> {
  if (!redis.isReady) return null
  try {
    const raw = await redis.get(`chat:session:${sessionId}`)
    if (!raw) return null
    return JSON.parse(raw) as ChatSessionContext
  } catch {
    return null
  }
}

/**
 * Write (or refresh) a session context in Redis with a sliding TTL.
 * No-op if Redis is unavailable.
 */
export async function setSession(sessionId: string, ctx: ChatSessionContext): Promise<void> {
  if (!redis.isReady) return
  try {
    await redis.setEx(`chat:session:${sessionId}`, SESSION_TTL, JSON.stringify(ctx))
  } catch {
    // Swallow write failures — Redis is cache, not source of truth
  }
}
