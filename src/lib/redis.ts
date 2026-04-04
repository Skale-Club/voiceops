// src/lib/redis.ts
// Redis singleton client for chat session storage (Phase 2+)
// Uses globalThis guard to survive Next.js HMR module re-evaluations in development.
// Pattern: mirrors src/lib/supabase/server.ts singleton approach.
import { createClient, type RedisClientType } from 'redis'

declare global {
  // var is required inside declare global (not let/const) — TypeScript strict mode rule
  // eslint-disable-next-line no-var
  var _redisClient: RedisClientType | undefined
}

function buildClient(): RedisClientType {
  const client = createClient({
    url: process.env.REDIS_URL,
  }) as RedisClientType

  // D-07: Log errors but do not crash the app. Callers check redis.isReady before use.
  client.on('error', (err: Error) => {
    console.error('[redis] error:', err.message)
  })

  void client.connect().catch((err: Error) => {
    console.error('[redis] connect failed:', err.message)
  })

  return client
}

// In development: attach to globalThis so HMR module re-evaluations reuse the same
// connection instead of opening a new one on every file save.
// In production: module is evaluated once per process; no globalThis guard needed.
const redis: RedisClientType =
  process.env.NODE_ENV !== 'production'
    ? (global._redisClient ??= buildClient())
    : buildClient()

export default redis
