// GET /api/chat/conversations/[id]  — single conversation detail
// DELETE /api/chat/conversations/[id] — delete conversation + messages (cascade)
import { createClient, getUser } from '@/lib/supabase/server'
import type { ConversationSummary } from '@/types/chat'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message')
    .eq('id', id)
    .single()

  if (error || !data) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const conversation: ConversationSummary = {
    id: data.id,
    status: data.status,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    lastMessageAt: data.last_message_at,
    visitorName: data.visitor_name,
    visitorEmail: data.visitor_email,
    visitorPhone: data.visitor_phone,
    lastMessage: data.last_message,
  }

  return Response.json({ conversation })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[DELETE /api/chat/conversations/[id]]', error)
    return Response.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
