// src/app/api/knowledge/upload/route.ts
// Route Handler for file upload — avoids server action 1MB body limit.
// DOES NOT run embedding inline — returns immediately with storagePath.
// Caller (client component) then invokes insertDocument server action.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { randomUUID } from 'crypto'

// Do NOT set runtime = 'edge' — formData() requires Node.js runtime
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
])

export async function POST(request: Request): Promise<Response> {
  // Auth check: must be logged in
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get org_id from org_members
  const { data: membership } = await supabaseUser
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return Response.json({ error: 'No organization found' }, { status: 403 })
  }

  const organizationId = membership.organization_id

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: 'File exceeds 10MB limit' }, { status: 400 })
  }

  if (!ALLOWED_MIME_TYPES.has(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
    return Response.json({ error: 'Unsupported file type. Use PDF, TXT, or CSV.' }, { status: 400 })
  }

  // Upload to Supabase Storage using service-role client
  const serviceClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const fileExt = file.name.split('.').pop() ?? 'bin'
  const storagePath = `${organizationId}/${randomUUID()}.${fileExt}`
  const arrayBuffer = await file.arrayBuffer()

  const { error: storageError } = await serviceClient.storage
    .from('knowledge-docs')
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (storageError) {
    return Response.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
  }

  return Response.json({
    path: storagePath,
    name: file.name,
    organizationId,
  })
}
