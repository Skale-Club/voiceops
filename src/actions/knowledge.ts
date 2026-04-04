// src/actions/knowledge.ts
// Server actions: register document after upload, add URL, delete document
'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import type { Database } from '@/types/database'

async function getAuthedOrgId(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; orgId: string }> {
  const user = await getUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data: membership } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) throw new Error('No organization found for user')
  return { supabase, orgId: membership.organization_id }
}

/**
 * Count how many file-type sources exist for this org (source_type != 'url').
 */
export async function getFileCount(orgId: string, supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { count } = await supabase
    .from('knowledge_sources')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .neq('source_type', 'url')

  return count ?? 0
}

/**
 * Count how many URL-type sources exist for this org.
 */
export async function getUrlCount(orgId: string, supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { count } = await supabase
    .from('knowledge_sources')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('source_type', 'url')

  return count ?? 0
}

/**
 * Register an uploaded file as a knowledge_source row (status=processing).
 * Called after /api/knowledge/upload returns successfully.
 * Triggers async embedding via Edge Function.
 */
export async function insertDocument(
  storagePath: string,
  fileName: string,
  sourceType: 'pdf' | 'text' | 'csv'
): Promise<{ id: string }> {
  const { supabase, orgId } = await getAuthedOrgId()

  const fileCount = await getFileCount(orgId, supabase)
  if (fileCount >= 5) {
    throw new Error('File limit reached. Maximum 5 files per organization.')
  }

  const { data, error } = await supabase
    .from('knowledge_sources')
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

  try {
    new URL(url)
  } catch {
    throw new Error('Invalid URL provided')
  }

  const urlCount = await getUrlCount(orgId, supabase)
  if (urlCount >= 5) {
    throw new Error('URL limit reached. Maximum 5 URLs per organization.')
  }

  const { data, error } = await supabase
    .from('knowledge_sources')
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
 * Delete a knowledge source and its Storage file.
 * CASCADE in DB removes vector chunks from documents table automatically.
 */
export async function deleteDocument(sourceId: string): Promise<void> {
  const { supabase, orgId } = await getAuthedOrgId()

  // Fetch storage path before deleting row
  const { data: source } = await supabase
    .from('knowledge_sources')
    .select('source_url, source_type')
    .eq('id', sourceId)
    .eq('organization_id', orgId)
    .single()

  if (!source) throw new Error('Knowledge source not found')

  // Delete row (CASCADE removes vector chunks from documents table)
  const { error: deleteError } = await supabase
    .from('knowledge_sources')
    .delete()
    .eq('id', sourceId)
    .eq('organization_id', orgId)

  if (deleteError) throw new Error(deleteError.message)

  // Delete Storage file for non-URL sources
  if (source.source_type !== 'url' && source.source_url) {
    const serviceClient = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    await serviceClient.storage
      .from('knowledge-docs')
      .remove([source.source_url])
  }
}

/**
 * Fetch all knowledge sources for the current org, ordered by created_at desc.
 */
export async function getKnowledgeSources() {
  const user = await getUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('knowledge_sources')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Check if org has an active OpenAI integration.
 */
export async function hasOpenAiIntegration(): Promise<boolean> {
  const user = await getUser()
  if (!user) return false
  const supabase = await createClient()

  const { data } = await supabase
    .from('integrations')
    .select('id')
    .eq('provider', 'openai')
    .eq('is_active', true)
    .limit(1)
    .single()

  return !!data
}

/**
 * Fire-and-forget: triggers the process-embeddings Edge Function.
 * Errors are logged but do not throw — source stays in 'processing'
 * and can be retried later.
 */
async function triggerEmbeddingJob(sourceId: string, organizationId: string): Promise<void> {
  const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-embeddings`

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ documentId: sourceId, organizationId }),
    })
    if (!response.ok) {
      console.error(`[knowledge] Edge Function returned ${response.status}`)
    }
  } catch (err) {
    console.error('[knowledge] Failed to trigger embedding job:', err)
  }
}
