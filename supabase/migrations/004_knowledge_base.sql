-- =============================================================================
-- Migration 004: Knowledge Base Schema
-- Phase: 04-knowledge-base
-- Requirements: KNOW-01, KNOW-02, KNOW-03, KNOW-04, KNOW-05, KNOW-06
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Section 1: pgvector extension
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Section 2: documents table
-- ---------------------------------------------------------------------------
CREATE TABLE public.documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  source_type     TEXT        NOT NULL CHECK (source_type IN ('pdf', 'text', 'csv', 'url')),
  source_url      TEXT,
  status          TEXT        NOT NULL DEFAULT 'processing'
                              CHECK (status IN ('processing', 'ready', 'error')),
  error_detail    TEXT,
  chunk_count     INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_documents_org_id ON public.documents(organization_id);

CREATE POLICY "org_members_can_manage_documents"
  ON public.documents
  FOR ALL
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- Section 3: document_chunks table
-- ---------------------------------------------------------------------------
CREATE TABLE public.document_chunks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id     UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  content         TEXT        NOT NULL,
  chunk_index     INTEGER     NOT NULL,
  embedding       extensions.halfvec(1536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- HNSW index: no pre-population required, auto-grows, recommended default over IVFFlat
-- halfvec_cosine_ops: pairs with <=> cosine distance operator used in match function
CREATE INDEX ON public.document_chunks
  USING hnsw (embedding extensions.halfvec_cosine_ops);

-- Composite index for tenant-scoped queries
CREATE INDEX idx_document_chunks_org_doc
  ON public.document_chunks(organization_id, document_id);

CREATE POLICY "org_members_can_read_document_chunks"
  ON public.document_chunks
  FOR SELECT
  USING (organization_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- Section 4: match_document_chunks function
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: runs as owner, bypasses RLS.
-- Tenant isolation is enforced by the p_organization_id parameter — callers
-- MUST pass the organization_id of the authenticated user; the function does
-- NOT derive it from auth context.
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  p_organization_id UUID,
  query_embedding   extensions.halfvec(1536),
  match_count       INT     DEFAULT 5,
  match_threshold   FLOAT   DEFAULT 0.7
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  content     TEXT,
  similarity  FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.organization_id = p_organization_id
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;
