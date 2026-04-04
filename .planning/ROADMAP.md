# VoiceOps Roadmap

## Current Milestone
**v1.1 Knowledge Base**
Status: 🚧 In Progress
Phases: 0 of 4 complete

### Theme
Replace the stub knowledge base with a real LangChain + Supabase vector pipeline — files and URLs both become searchable knowledge, wired to the org's OpenAI integration.

---

## Phase Overview

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Data Layer | 2 | Planning | - |
| 2 | File Pipeline | TBD | Not started | - |
| 3 | URL Pipeline | TBD | Not started | - |
| 4 | UI & Wiring | TBD | Not started | - |

---

## Phase Details

### Phase 1: Data Layer

**Focus:** Migrate to LangChain `documents` table schema + `match_documents` RPC. Add a `knowledge_sources` tracking table (files + URLs) with status, type, and org-scoped counts. Org isolation via `metadata.org_id`. All via Supabase CLI migrations.

Plans: TBD (defined during /paul:plan)

### Phase 2: File Pipeline

**Focus:** File upload → LangChain document loaders → fixed-default chunking → OpenAI embed → `SupabaseVectorStore`. Max 5 files per org enforced server-side. OpenAI key decrypted from org integrations at processing time.

Plans: TBD (defined during /paul:plan)

### Phase 3: URL Pipeline

**Focus:** Paste URL → fetch/scrape content → LangChain → chunk → embed → store in pgvector. Max 5 URLs per org enforced server-side. Same OpenAI key source as file pipeline.

Plans: TBD (defined during /paul:plan)

### Phase 4: UI & Wiring

**Focus:** Document list fetched from Supabase (files + URLs unified), per-org limit enforcement in UI, status indicators (Processing / Ready / Failed), OpenAI-not-configured banner with link to Integrations, shadcn `AlertDialog` for deletions (no `window.confirm()`), semantic search wired to new schema.

Plans: TBD (defined during /paul:plan)

---

## Constraints

- LangChain `SupabaseVectorStore` as the vector layer
- Org isolation via `metadata.org_id`
- Max 5 files + 5 URLs per org (server-side)
- OpenAI embeddings only — key from org integrations
- Fixed chunking defaults — no user config
- Vector search only
- All DB changes via Supabase CLI (`npx supabase db push`)
- Deletion cascades handled in migrations
- shadcn `AlertDialog` for all destructive confirmations

---

*Last updated: 2026-04-03 — Milestone created*
