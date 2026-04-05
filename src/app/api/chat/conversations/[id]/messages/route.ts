// GET /api/chat/conversations/[id]/messages — paginated message history
// POST /api/chat/conversations/[id]/messages — admin sends message
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'
import type { ConversationMessage } from '@/types/chat'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const before = searchParams.get('before')
  const includeInternal = searchParams.get('includeInternal') === 'true'

  const supabase = await createClient()

  // Verify conversation belongs to org (RLS handles this but be explicit)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', id)
    .single()

  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  // Cursor: if `before` provided, find the created_at of that message first
  let beforeCreatedAt: string | null = null
  if (before) {
    const { data: anchor } = await supabase
      .from('conversation_messages')
      .select('created_at')
      .eq('id', before)
      .single()
    if (anchor) beforeCreatedAt = anchor.created_at
  }

  let query = supabase
    .from('conversation_messages')
    .select('id, conversation_id, org_id, role, content, created_at, metadata')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(limit + 1)  // fetch one extra to determine hasMore

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt)
  }

  if (!includeInternal) {
    // Filter out messages where metadata->>'internal' = 'true'
    query = query.or('metadata.is.null,metadata->>internal.neq.true')
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET messages]', error)
    return Response.json({ error: 'Failed to load messages' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const sliced = rows.slice(0, limit)

  const messages: ConversationMessage[] = sliced.reverse().map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    metadata: row.metadata as Record<string, unknown> | null,
  }))

  return Response.json({ messages, hasMore })
}

const SendMessageSchema = z.object({
  content: z.string().min(1),
  role: z.literal('assistant'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  // Verify conversation belongs to org via RLS
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, org_id')
    .eq('id', id)
    .single()

  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = SendMessageSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { content, role } = parsed.data

  const { data: msg, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: id,
      org_id: conv.org_id,
      role,
      content,
    })
    .select('id, conversation_id, role, content, created_at, metadata')
    .single()

  if (error) {
    console.error('[POST messages]', error)
    return Response.json({ error: 'Failed to send message' }, { status: 500 })
  }

  // Update last_message and last_message_at on parent conversation
  await supabase
    .from('conversations')
    .update({ last_message: content, last_message_at: msg.created_at, updated_at: new Date().toISOString() })
    .eq('id', id)

  const message: ConversationMessage = {
    id: msg.id,
    conversationId: msg.conversation_id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
    metadata: msg.metadata as Record<string, unknown> | null,
  }

  return Response.json({ message }, { status: 201 })
}
