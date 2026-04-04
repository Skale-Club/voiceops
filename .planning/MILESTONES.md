# Milestones

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

## v1.1 Knowledge Base (In Progress: 2026-04-03)

**Status:** 🚧 0 of 4 phases complete
**Focus:** Replace stub knowledge base with LangChain + Supabase vector pipeline — files and URLs both vectorized and searchable, wired to the org's OpenAI integration.

**Phases:**
1. Data Layer — LangChain `documents` schema, `match_documents` RPC, source tracking table
2. File Pipeline — Upload → chunk → embed → pgvector, max 5 per org
3. URL Pipeline — Scrape → chunk → embed → pgvector, max 5 per org
4. UI & Wiring — Document list, status indicators, OpenAI banner, AlertDialog for delete

---
