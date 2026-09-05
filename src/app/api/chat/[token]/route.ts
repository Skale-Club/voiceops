// src/app/api/chat/[token]/route.ts
// Public POST endpoint for the Opps embedded chat widget.
// Authentication: org token in URL path (not a user session).
// Unlike /api/vapi/* routes, this returns 401 for invalid tokens (no Vapi retry concern).
//
// Persistence: writes to `conversations` and `conversation_messages` via persist.ts.
// Redis (session.ts) is a transient cache only | never the source of truth.
// See .planning/codebase/chat-data-boundary.md for the full data lifecycle.
import { after } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getSession, setSession, type ChatSessionContext } from '@/lib/chat/session'
import { ensureDbSession, persistMessage, loadSessionFromDb } from '@/lib/chat/persist'
import { runAgent } from '@/lib/agent-runtime'
import { createLogger } from '@/lib/obs/logger'
import { isRequestAllowed, normalizeWidgetUrlMode, normalizeWidgetUrlRules } from '@/lib/widget/url-rules'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'
import { getMedusaCredentialsForOrg } from '@/lib/medusa/credentials'
import { verifyCommerceContext, writeCommerceContext, consumeContextJti } from '@/lib/medusa/context'
import { linkVerifiedContact } from '@/lib/contacts/link-verified-contact'

export const runtime = 'nodejs'
// 60s for tool round-trips (Phases 132+). NOTE: on self-hosted Coolify this is platform build-output metadata only — no runtime enforcement (Next 16 docs); the effective ceiling is the Traefik proxy timeout. Zero behavioral change today, required for platform portability.
export const maxDuration = 60

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'message is required').max(4000, 'message too long'),
  sessionId: z.string().optional(),
  // Full page URL, sent by the widget so URL rules can be enforced at path level
  // (browsers strip the path from cross-origin Referer). The host is still
  // verified against the unspoofable Origin header before the path is trusted.
  pageUrl: z.string().optional(),
  // Storefront-minted signed commerce-context token (contract §3, CTX-02).
  // Verified + pinned below, before runAgent. Never trusted from message text.
  commerce_context: z.string().max(2048).optional(),
})

// Plain JSON, never a stream — the widget shows non-200s as an error bubble.
function rateLimited(): Response {
  return Response.json({ error: 'rate_limited' }, { status: 429, headers: CORS_HEADERS })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  // Correlation id for this request, propagated into the agent run (O1b).
  const traceId = crypto.randomUUID()
  const log = createLogger({ traceId, route: 'api/chat' })
  try {
    // 1. Await params (required in Next.js 15 App Router)
    const { token } = await params

    // Rate limits R1/R2 (contract §7) — per-IP, before ANY body parse or DB work.
    const ip = getClientIp(request)
    const r1 = await rateLimit(`chat:ip:${ip}`, 20, 60, { failMode: 'memory' })
    if (!r1.allowed) {
      log.warn('chat_rate_limited', { rule: 'R1', ip })
      return rateLimited()
    }
    const r2 = await rateLimit(`chat:ip:day:${ip}`, 200, 86400, { failMode: 'memory' })
    if (!r2.allowed) {
      log.warn('chat_rate_limited', { rule: 'R2', ip })
      return rateLimited()
    }

    // 2. Parse + validate request body
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
    }

    const parsed = ChatRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400, headers: CORS_HEADERS })
    }
    const { message, sessionId: incomingSessionId, pageUrl, commerce_context } = parsed.data

    // 3. Resolve org by widget token. Runs before the session limits now: a
    // session that Redis does not hold has to be reloaded from the database,
    // and that reload is scoped to the organization.
    const supabase = createServiceRoleClient()
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, is_active, widget_url_mode, widget_url_rules')
      .eq('widget_token', token)
      .single()

    if (orgError || !org || !org.is_active) {
      return Response.json({ error: 'Invalid or inactive token' }, { status: 401, headers: CORS_HEADERS })
    }

    // Session: Redis first, the database second. Redis is a cache the
    // production container may not even have (2026-09-05: no REDIS_URL, so
    // getSession() always returned null, every message minted a new session,
    // and the widget answered "this is the start of our conversation" to its
    // own third turn). conversations + conversation_messages are the source
    // of truth and loadSessionFromDb() rebuilds the same context from them.
    // A database error here degrades to "start a fresh session", never a 500.
    let existingSession = incomingSessionId ? await getSession(incomingSessionId) : null
    if (!existingSession && incomingSessionId) {
      try {
        existingSession = await loadSessionFromDb({ orgId: org.id, sessionId: incomingSessionId })
      } catch (err) {
        log.warn('chat_session_db_fallback_failed', { error: err, orgId: org.id })
        existingSession = null
      }
    }

    // R3/R4 (contract §7). R4 gates ANY path that will create a session —
    // including a bogus/expired incoming sessionId, which would otherwise
    // bypass R4 entirely by minting a new session + conversations row per
    // request.
    if (incomingSessionId && existingSession) {
      const r3 = await rateLimit(`chat:sess:${incomingSessionId}`, 10, 60, { failMode: 'memory' })
      if (!r3.allowed) {
        log.warn('chat_rate_limited', { rule: 'R3', ip, sessionId: incomingSessionId })
        return rateLimited()
      }
    } else {
      const r4 = await rateLimit(`chat:newsess:${ip}`, 10, 3600, { failMode: 'memory' })
      if (!r4.allowed) {
        log.warn('chat_rate_limited', { rule: 'R4', ip })
        return rateLimited()
      }
    }

    // R5 — org LLM budget (fail-open: Redis down must not take every org's chat down).
    const r5 = await rateLimit(`chat:org:${org.id}`, 300, 60, { failMode: 'open' })
    if (!r5.allowed) {
      log.warn('chat_rate_limited', { rule: 'R5', ip, orgId: org.id })
      return rateLimited()
    }

    // 3b. Enforce URL authorization rules server-side. This is the real security
    // boundary against token reuse on unauthorized domains: the Origin header is
    // browser-set and cannot be forged by page JS.
    const allowed = isRequestAllowed(
      normalizeWidgetUrlMode(org.widget_url_mode),
      normalizeWidgetUrlRules(org.widget_url_rules),
      {
        origin: request.headers.get('origin'),
        referer: request.headers.get('referer'),
        clientUrl: pageUrl ?? null,
      },
    )
    if (!allowed) {
      return Response.json({ error: 'not_authorized_for_origin' }, { status: 403, headers: CORS_HEADERS })
    }

    // 4. Get or create session. `existingSession` was already fetched above
    // (org-independent) to gate R3/R4 — reused here rather than a second
    // getSession round trip. The two byte-identical create blocks that used to
    // live in each branch are deduplicated into createNewSession().
    async function createNewSession(orgId: string): Promise<{ sessionId: string; ctx: ChatSessionContext }> {
      const sessionId = crypto.randomUUID()
      const dbSessionId = await ensureDbSession({ orgId, sessionId, widgetToken: token })
      return {
        sessionId,
        ctx: {
          orgId,
          sessionId,
          dbSessionId,
          messages: [],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        },
      }
    }

    let ctx: ChatSessionContext
    let sessionId: string

    if (incomingSessionId && existingSession && existingSession.orgId === org.id) {
      // Resume existing session
      ctx = existingSession
      sessionId = incomingSessionId
    } else {
      if (existingSession) {
        // Session exists but belongs to another org — this request ALSO creates a
        // session, so it must consume R4 (orchestrator ruling: ANY create path).
        const r4b = await rateLimit(`chat:newsess:${ip}`, 10, 3600, { failMode: 'memory' })
        if (!r4b.allowed) {
          log.warn('chat_rate_limited', { rule: 'R4', ip, orgId: org.id })
          return rateLimited()
        }
      }
      ;({ ctx, sessionId } = await createNewSession(org.id))
    }

    // 5. Append user message to context and refresh Redis
    ctx.messages.push({ role: 'user', content: message })
    ctx.lastActiveAt = new Date().toISOString()
    await setSession(sessionId, ctx)

    // 6. Persist user message to Supabase (fire-and-forget via after())
    after(async () => {
      try {
        await persistMessage({ dbSessionId: ctx.dbSessionId, orgId: ctx.orgId, role: 'user', content: message })
      } catch (err) {
        log.error('persist_user_message_failed', { error: err, orgId: ctx.orgId })
      }
    })

    // 6b. Verify + pin the storefront-minted commerce context (contract §3 v2, anti-IDOR).
    // Absent → skip entirely (orgs without a medusa integration pay nothing).
    // ALL failures are fail-soft: warn + continue the chat with no pin. Runs
    // BEFORE runAgent so a tool call in the first turn sees the pin.
    if (commerce_context) {
      try {
        const creds = await getMedusaCredentialsForOrg(org.id, supabase)
        if (creds) {
          const claims = await verifyCommerceContext(commerce_context, creds.connectionToken, org.id)
          if (claims) {
            // X2 token binding, layer 2: consume the one-time jti BEFORE any
            // pin write. A false/errored result means this exact token was
            // already used (replay) — drop it, never call writeCommerceContext.
            const jtiOk = await consumeContextJti(supabase, org.id, claims.jti)
            if (!jtiOk) {
              log.warn('commerce_ctx_jti_replay', { orgId: org.id })
            } else {
              // X2 token binding, layer 3: cnonce binding. writeCommerceContext
              // returns `{ rejected: true }` when this token's cnonce doesn't
              // match the conversation's already-pinned cnonce — the prior pin
              // is left completely untouched (no repin, no contact link).
              const result = await writeCommerceContext(supabase, ctx.dbSessionId, org.id, claims, claims.cnonce)
              if (result && 'rejected' in result) {
                log.warn('commerce_ctx_cnonce_mismatch', { orgId: org.id })
              } else {
                if (result?.repinnedFrom) log.info('commerce_ctx_repinned', { orgId: org.id, from: result.repinnedFrom, to: claims.cart })
                // UIX-03: a verified email means we know the visitor — link the CRM contact.
                // claims.email is `string | null`; linkVerifiedContact is throttled + fail-soft.
                if (claims.email) await linkVerifiedContact(supabase, org.id, ctx.dbSessionId, claims.email)
              }
            }
          } else {
            log.warn('commerce_ctx_invalid', { orgId: org.id })
          }
        }
      } catch (err) {
        log.warn('commerce_ctx_error', { orgId: org.id, error: err }) // never throw — the chat must continue
      }
    }

    // 7. Call agent runtime | resolves agent, runs LLM, persists assistant reply (D-35-06)
    const stream = runAgent({
      orgId: org.id,
      traceId,
      channel: 'web_widget',
      conversationId: ctx.dbSessionId,
      sessionId,
      userMessage: message,
      historyWindow: ctx.messages,
      mode: 'production',
      stream: true,
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...CORS_HEADERS,
      },
    })
  } catch (err) {
    log.error('chat_unhandled_error', { error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: CORS_HEADERS })
  }
}
