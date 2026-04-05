// GET /api/chat/conversations
// Returns all conversations for the active org, ordered by last activity.
// Auth-gated: returns 401 if no user session.
import { createClient, getUser } from '@/lib/supabase/server'
import type { ConversationSummary } from '@/types/chat'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/chat/conversations]', error)
    return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
  }

  const conversations: ConversationSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    visitorPhone: row.visitor_phone,
    lastMessage: row.last_message,
  }))

  return Response.json({ conversations })
}
