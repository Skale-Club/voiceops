// supabase/functions/process-embeddings/index.ts
// Deno Edge Function: dequeue embedding job, process document, update status
// Triggered via HTTP POST from knowledge.ts triggerEmbeddingJob()

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@6'
import { encode, decode } from 'https://esm.sh/gpt-tokenizer@3'
import { extractText as extractPdfText } from 'https://esm.sh/unpdf@1'

const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50

interface JobPayload {
  documentId: string
  organizationId: string
}

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (!text.trim()) return []
  const tokens = encode(text)
  if (tokens.length === 0) return []
  const chunks: string[] = []
  let i = 0
  while (i < tokens.length) {
    const chunk = tokens.slice(i, i + chunkSize)
    const decoded = decode(chunk)
    if (decoded.trim()) chunks.push(decoded)
    i += chunkSize - overlap
  }
  return chunks
}

async function extractTextFromSource(
  supabase: ReturnType<typeof createClient>,
  sourceType: string,
  sourceUrl: string | null
): Promise<string> {
  if (sourceType === 'url' && sourceUrl) {
    // Fetch and strip HTML
    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error(`URL fetch failed: ${response.status}`)
    const html = await response.text()
    // Simple HTML strip for Deno (no cheerio CDN issues)
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (sourceUrl) {
    // Download from Supabase Storage
    const { data, error } = await supabase.storage
      .from('knowledge-docs')
      .download(sourceUrl)
    if (error) throw new Error(`Storage download failed: ${error.message}`)

    if (sourceType === 'pdf') {
      const buffer = await data.arrayBuffer()
      const { text } = await extractPdfText(new Uint8Array(buffer), { mergePages: true })
      return text
    }

    // text / csv
    return await data.text()
  }

  throw new Error('No source URL available for document')
}

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  let payload: JobPayload
  try {
    payload = await req.json() as JobPayload
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { documentId, organizationId } = payload
  if (!documentId || !organizationId) {
    return new Response(JSON.stringify({ error: 'Missing documentId or organizationId' }), { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY') ?? ''

  if (!openaiApiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  })
  const openai = new OpenAI({ apiKey: openaiApiKey })

  // Fetch document metadata
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, organization_id, source_type, source_url, status')
    .eq('id', documentId)
    .eq('organization_id', organizationId)
    .single()

  if (docError || !doc) {
    return new Response(JSON.stringify({ error: 'Document not found' }), { status: 404 })
  }

  if (doc.status !== 'processing') {
    // Already processed or in error state — skip
    return new Response(JSON.stringify({ skipped: true }), { status: 200 })
  }

  try {
    // Step 1: Extract text
    const rawText = await extractTextFromSource(supabase, doc.source_type, doc.source_url)

    // Step 2: Chunk
    const textChunks = chunkText(rawText)
    if (textChunks.length === 0) {
      throw new Error('No text content extracted from document')
    }

    // Step 3: Embed each chunk (sequential to avoid rate limits)
    const chunksToInsert: Array<{
      organization_id: string
      document_id: string
      content: string
      chunk_index: number
      embedding: number[]
    }> = []

    for (let i = 0; i < textChunks.length; i++) {
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: textChunks[i],
        encoding_format: 'float',
      })
      chunksToInsert.push({
        organization_id: organizationId,
        document_id: documentId,
        content: textChunks[i],
        chunk_index: i,
        embedding: embeddingResponse.data[0].embedding,
      })
    }

    // Step 4: Batch insert chunks
    const { error: insertError } = await supabase
      .from('document_chunks')
      .insert(chunksToInsert)

    if (insertError) throw new Error(`Chunk insert failed: ${insertError.message}`)

    // Step 5: Update document status to ready
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'ready',
        chunk_count: textChunks.length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    if (updateError) throw new Error(`Status update failed: ${updateError.message}`)

    return new Response(JSON.stringify({ success: true, chunkCount: textChunks.length }), { status: 200 })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    // Mark document as error
    await supabase
      .from('documents')
      .update({
        status: 'error',
        error_detail: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    console.error(`[process-embeddings] Failed for document ${documentId}:`, errorMessage)
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 })
  }
})
