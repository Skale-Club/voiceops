// src/app/api/chat/[token]/route.ts
// Public POST endpoint for the Leaidear embedded chat widget.
// Authentication: org token in URL path (not a user session).
// Unlike /api/vapi/* routes, this returns 401 for invalid tokens (no Vapi retry concern).
import { after } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getSession, setSession, type ChatSessionContext } from '@/lib/chat/session'
import { ensureDbSession, persistMessage } from '@/lib/chat/persist'
import { decrypt } from '@/lib/crypto'
import { createChatStream, type ToolWithCredentials } from '@/lib/chat/stream'

export const runtime = 'nodejs'

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  sessionId: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  try {
    // 1. Await params (required in Next.js 15 App Router)
    const { token } = await params

    // 2. Parse + validate request body
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = ChatRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    const { message, sessionId: incomingSessionId } = parsed.data

    // 3. Resolve org by widget token
    const supabase = createServiceRoleClient()
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, is_active')
      .eq('widget_token', token)
      .single()

    if (orgError || !org || !org.is_active) {
      return Response.json({ error: 'Invalid or inactive token' }, { status: 401 })
    }

    // 4. Get or create session
    let ctx: ChatSessionContext
    let sessionId: string

    if (incomingSessionId) {
      const existing = await getSession(incomingSessionId)
      if (existing && existing.orgId === org.id) {
        // Resume existing session
        ctx = existing
        sessionId = incomingSessionId
      } else {
        // Redis miss or org mismatch — treat as new session
        sessionId = crypto.randomUUID()
        const dbSessionId = await ensureDbSession({ orgId: org.id, sessionId, widgetToken: token })
        ctx = {
          orgId: org.id,
          sessionId,
          dbSessionId,
          messages: [],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }
      }
    } else {
      // First message — create new session
      sessionId = crypto.randomUUID()
      const dbSessionId = await ensureDbSession({ orgId: org.id, sessionId, widgetToken: token })
      ctx = {
        orgId: org.id,
        sessionId,
        dbSessionId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      }
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
        console.error('[chat-api] persistMessage failed:', err)
      }
    })

    // 7. Fetch org's active tool_configs + join integrations for credentials
    //    Must use service-role client — RLS blocks queries without an authenticated user session.
    //    Pitfall 6: tool_configs has RLS scoped to get_current_org_id() — no user session here.
    //    Pitfall 7: integration_id must be joined to get apiKey + locationId for executeAction.
    const toolRows = await (async () => {
      const { data: rawTools } = await supabase
        .from('tool_configs')
        .select('id, tool_name, action_type, config, fallback_message, integration_id')
        .eq('organization_id', org.id)
        .eq('is_active', true)
      if (!rawTools || rawTools.length === 0) return []

      // Fetch integrations for all integration_ids referenced by these tools
      const integrationIds = [...new Set(rawTools.map(t => t.integration_id))]
      const { data: integrations } = await supabase
        .from('integrations')
        .select('id, encrypted_api_key, location_id')
        .in('id', integrationIds)
        .eq('is_active', true)

      const integrationMap = new Map(
        (integrations ?? []).map(i => [i.id, i])
      )

      const toolsWithCreds: ToolWithCredentials[] = []
      for (const tool of rawTools) {
        const integration = integrationMap.get(tool.integration_id)
        if (!integration) continue
        try {
          const apiKey = await decrypt(integration.encrypted_api_key)
          toolsWithCreds.push({
            id: tool.id,
            tool_name: tool.tool_name,
            action_type: tool.action_type as ToolWithCredentials['action_type'],
            config: (tool.config ?? {}) as Record<string, unknown>,
            fallback_message: tool.fallback_message,
            integration_id: tool.integration_id,
            apiKey,
            locationId: integration.location_id ?? '',
          })
        } catch {
          // Skip tool if key decryption fails — don't block the stream
          console.warn('[chat-api] failed to decrypt key for integration', tool.integration_id)
        }
      }
      return toolsWithCreds
    })()

    // 8. Declare reply accumulator in route scope — stream.ts closes over it (Pitfall 3)
    let accumulatedReply = ''

    // 9. Register after() in route scope before return — fires after stream is consumed (Pitfall 1)
    after(async () => {
      if (!accumulatedReply) return
      try {
        ctx.messages.push({ role: 'assistant', content: accumulatedReply })
        ctx.lastActiveAt = new Date().toISOString()
        await setSession(sessionId, ctx)
        await persistMessage({ dbSessionId: ctx.dbSessionId, orgId: ctx.orgId, role: 'assistant', content: accumulatedReply })
      } catch (err) {
        console.error('[chat-api] post-stream persist failed:', err)
      }
    })

    // 10. Create ReadableStream and return SSE response (D-01, D-02, D-03)
    const stream = createChatStream({
      sessionId,
      orgId: org.id,
      orgName: org.name,
      message,
      ctx,
      supabase,
      toolsWithCreds: toolRows,
      onReplyChunk: (chunk: string) => { accumulatedReply += chunk },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    console.error('[chat-api] unhandled error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
