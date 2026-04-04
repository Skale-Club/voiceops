# Milestones

## v1.1 Knowledge Base (Shipped: 2026-04-03)

**Stats:** 1 commit, 18 files, +2191 / -334 lines
**Timeline:** 2026-04-03 (single-session)
**Stack:** LangChain + Supabase pgvector, Next.js 15, Deno Edge Functions

**Key accomplishments:**

1. **LangChain vector pipeline** — Replaced custom chunking/embedding with LangChain `RecursiveCharacterTextSplitter` + `OpenAIEmbeddings` + `SupabaseVectorStore.fromDocuments()`
2. **Schema migration** — Renamed `documents` → `knowledge_sources` (tracking table), new LangChain-compatible `documents` table with `content/metadata/embedding vector(1536)`, `match_documents` RPC
3. **Semantic search upgrade** — `query-knowledge.ts` uses `SupabaseVectorStore.similaritySearch()` with `org_id` metadata filter for org isolation
4. **Per-org upload limits** — Max 5 files + 5 URLs enforced server-side; UI shows counters (X/5) and disables at limit
5. **OpenAI integration gate** — Upload form disabled and banner shown when org has no active OpenAI integration
6. **AlertDialog for deletions** — Replaced `window.confirm()` with shadcn `AlertDialog` across knowledge base UI

**UAT:** 10/10 tests passed (code audit + migration smoke test)

**Archives:** [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

---

## v1.0 VoiceOps MVP (Shipped: 2026-04-03)

**Stats:** 6 phases, 30 plans, 95 commits, 231 files, ~44K LOC
**Timeline:** 2026-03-30 → 2026-04-03 (4 days)
**Stack:** Next.js 14 (App Router), TypeScript, Supabase (PostgreSQL + RLS + pgvector), Vercel

**Key accomplishments:**

1. **Multi-tenant foundation** — Organizations, assistant mappings, Supabase RLS on all tables, email/password auth with middleware guards
2. **Action Engine** — Edge Function webhook receiver processes Vapi tool calls in <500ms, executes GoHighLevel actions (create contact, check availability, book appointment), logs every execution
3. **Observability** — End-of-call webhook ingestion, paginated call list with 5 filter types, chat-format transcript with inline tool execution badges, dashboard metrics
4. **Knowledge Base** — Document upload (PDF/text/CSV/URL), OpenAI embedding vectorization via Deno Edge Function, tenant-scoped semantic search (pgvector + match_document_chunks RPC)
5. **Outbound Campaigns** — Campaign CRUD, CSV contact import with deduplication, Vapi outbound dialing with cadence control, Supabase Realtime per-contact status board
6. **API Key Admin** — All third-party API keys (OpenAI, Anthropic, OpenRouter, Vapi) migrated from env vars to per-org encrypted integrations with AES-256-GCM

**Audit:** 42/42 requirements wired, 8/8 E2E flows pass, tech_debt status (no blockers)

**Known gaps (accepted as tech debt):**

- No Vapi webhook HMAC/secret validation
- Campaign calls don't auto-appear in Observability call list (deployment config gap)
- 132 todo test stubs (pre-existing)
- send_sms / custom_webhook are v2 stubs

**Archives:** [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) | [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) | [v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)

---
