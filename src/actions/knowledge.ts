// src/actions/knowledge.ts
// Server actions: register document after upload, add URL, delete document
'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import type { Database } from '@/types/database'

async function getAuthedOrgId(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; orgId: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) throw new Error('No organization found for user')
  return { supabase, orgId: membership.organization_id }
}

/**
 * Register an uploaded file as a document row (status=processing).
 * Called after /api/knowledge/upload returns successfully.
 * Triggers async embedding via Edge Function.
 */
export async function insertDocument(
  storagePath: string,
  fileName: string,
  sourceType: 'pdf' | 'text' | 'csv'
): Promise<{ id: string }> {
  const { supabase, orgId } = await getAuthedOrgId()

  const { data, error } = await supabase
    .from('documents')
    .insert({
      organization_id: orgId,
      name: fileName,
      source_type: sourceType,
      source_url: storagePath,
      status: 'processing',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Trigger async embedding pipeline (fire-and-forget)
  void triggerEmbeddingJob(data.id, orgId)

  return { id: data.id }
}

/**
 * Add a website URL for content extraction and vectorization.
 */
export async function addUrlDocument(url: string): Promise<{ id: string }> {
  const { supabase, orgId } = await getAuthedOrgId()

  // Validate URL
  try {
    new URL(url)
  } catch {
    throw new Error('Invalid URL provided')
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      organization_id: orgId,
      name: url,
      source_type: 'url',
      source_url: url,
      status: 'processing',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Trigger async embedding pipeline (fire-and-forget)
  void triggerEmbeddingJob(data.id, orgId)

  return { id: data.id }
}

/**
 * Delete a document row and its Storage file.
 * CASCADE deletes document_chunks automatically.
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const { supabase, orgId } = await getAuthedOrgId()

  // Fetch storage path before deleting row
  const { data: doc } = await supabase
    .from('documents')
    .select('source_url, source_type')
    .eq('id', documentId)
    .eq('organization_id', orgId) // tenant scope
    .single()

  if (!doc) throw new Error('Document not found')

  // Delete row (CASCADE removes document_chunks)
  const { error: deleteError } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('organization_id', orgId)

  if (deleteError) throw new Error(deleteError.message)

  // Delete Storage file for non-URL documents
  if (doc.source_type !== 'url' && doc.source_url) {
    const serviceClient = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    await serviceClient.storage
      .from('knowledge-docs')
      .remove([doc.source_url])
  }
}

/**
 * Fire-and-forget: triggers the process-embeddings Edge Function.
 * Errors are logged but do not throw — document stays in 'processing'
 * and can be retried later.
 */
async function triggerEmbeddingJob(documentId: string, organizationId: string): Promise<void> {
  const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-embeddings`

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ documentId, organizationId }),
    })
    if (!response.ok) {
      console.error(`[knowledge] Edge Function returned ${response.status}`)
    }
  } catch (err) {
    console.error('[knowledge] Failed to trigger embedding job:', err)
  }
}
