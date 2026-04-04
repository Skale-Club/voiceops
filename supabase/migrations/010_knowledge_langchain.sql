-- =============================================================================
-- Migration 010: Knowledge Base — LangChain SupabaseVectorStore Schema
-- Phase: 01-data-layer (v1.1)
-- Replaces the v1.0 documents/document_chunks schema with:
--   - knowledge_sources: source tracking (renamed from documents)
--   - documents:         LangChain vector store (content, metadata, embedding)
--   - match_documents:   LangChain-compatible RPC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Remove v1.0 vector layer
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_document_chunks(
  uuid,
  extensions.halfvec(1536),
  int,
  float
);

DROP TABLE IF EXISTS public.document_chunks CASCADE;

-- ---------------------------------------------------------------------------
-- Step 2: Rename source tracking table
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents RENAME TO knowledge_sources;

ALTER INDEX IF EXISTS idx_documents_org_id RENAME TO idx_knowledge_sources_org_id;

-- Rename RLS policy
DROP POLICY IF EXISTS "org_members_can_manage_documents" ON public.knowledge_sources;

CREATE POLICY "org_members_can_manage_knowledge_sources"
  ON public.knowledge_sources
  FOR ALL
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- Step 3: LangChain-compatible documents table (vector store)
-- ---------------------------------------------------------------------------
CREATE TABLE public.documents (
  id                  BIGSERIAL   PRIMARY KEY,
  content             TEXT        NOT NULL,
  metadata            JSONB       NOT NULL DEFAULT '{}',
  embedding           extensions.vector(1536),
  knowledge_source_id UUID        REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for cosine similarity (no pre-population needed, auto-grows)
CREATE INDEX ON public.documents
  USING hnsw (embedding extensions.vector_cosine_ops);

-- GIN index for metadata JSONB filtering (org_id, source_id lookups)
CREATE INDEX idx_documents_metadata ON public.documents USING gin (metadata);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their org's vector chunks
CREATE POLICY "org_members_can_read_documents"
  ON public.documents
  FOR SELECT
  USING ((metadata->>'org_id')::uuid = public.get_current_org_id());

-- Edge function uses service_role key — these policies exist for completeness
-- Service role bypasses RLS by default in Supabase
CREATE POLICY "service_role_can_manage_documents"
  ON public.documents
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Step 4: match_documents — LangChain SupabaseVectorStore signature
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: bypasses RLS. Caller must include org_id in filter.
-- LangChain calls this as: match_documents(query_embedding, filter)
-- where filter = {"org_id": "<uuid>"}
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding extensions.vector(1536),
  filter          JSONB DEFAULT '{}'
)
RETURNS TABLE (
  id         BIGINT,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.documents d
  WHERE d.metadata @> filter
    AND d.embedding IS NOT NULL
  ORDER BY d.embedding <=> query_embedding ASC;
END;
$$;
