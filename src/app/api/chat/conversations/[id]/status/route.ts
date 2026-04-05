// POST /api/chat/conversations/[id]/status — update status to 'open' | 'closed'
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const StatusSchema = z.object({
  status: z.enum(['open', 'closed']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = StatusSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'status must be "open" or "closed"' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[POST status]', error)
    return Response.json({ error: 'Failed to update status' }, { status: 500 })
  }

  return Response.json({ ok: true, status: parsed.data.status })
}
