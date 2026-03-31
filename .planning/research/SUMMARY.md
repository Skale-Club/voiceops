# Project Research Summary

**Project:** VoiceOps
**Domain:** Multi-tenant SaaS operations platform for Vapi.ai voice AI assistants
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

VoiceOps is a multi-tenant operations layer for agencies managing voice AI assistants via Vapi.ai. Unlike competitors (ChatDash, Vapify, Voicerr, VoiceAIWrapper) which are single-tenant white-label dashboards, VoiceOps differentiates through its **Action Engine** — a per-tenant tool execution system that receives Vapi webhooks during live calls, routes to the correct organization, executes business logic (create CRM contact, check calendar, book appointment, send SMS), and returns results within 500ms. No competitor offers multi-tenant tool execution with per-org credential isolation. This is the core moat.

The recommended approach is a **Next.js 15 + Supabase monolith** deployed on Vercel. Supabase provides PostgreSQL with Row Level Security (RLS) as the multi-tenant isolation guarantee — even code bugs cannot leak cross-tenant data when RLS is configured correctly. Vapi webhook routes use Edge Runtime (`export const runtime = 'edge'`) for ~5ms cold starts to meet the sub-500ms response budget. The Action Engine uses a pluggable executor registry pattern: adding a new integration (GHL, Cal.com, Twilio, custom webhook) means creating one file and registering it. shadcn/ui + TanStack Table + React Hook Form provide the admin dashboard UI. pgvector handles tenant-scoped RAG knowledge base queries co-located with application data.

Key risks are (1) **Vapi webhook latency** — the 500ms response budget is tight when it includes DB lookups + external API calls + encryption/decryption, requiring fire-and-forget logging and single-synchronous-action patterns; (2) **RLS correctness** — multi-tenant data isolation must be perfect from day one, with `(select auth.uid())` wrapping in all policies and automated cross-org isolation tests; (3) **Edge Runtime constraints** — Vapi webhook routes must avoid Node.js APIs and use Web Crypto for credential encryption, with the 2MB bundle limit forbidding heavy SDK imports.

## Key Findings

### Recommended Stack

The stack is a deliberately simple monolith: **Next.js 15 (App Router) + Supabase + Vercel**. Every technology choice prioritizes reducing operational surface area. Supabase replaces what would otherwise be 5+ services (Postgres, Auth, RLS, pgvector, Edge Functions, Storage, Realtime). No ORM is needed — Supabase generated types + RLS policies are SQL-first. No global state management — server state comes from Supabase queries, URL state via `nuqs`, form state via React Hook Form.

**Core technologies:**
- **Next.js 15 (App Router):** Frontend + API routes + Edge Runtime for Vapi webhooks. Skip Next.js 16 — too new with breaking changes. React 19 Server Components reduce client bundle for dashboard-heavy app.
- **Supabase (hosted):** PostgreSQL + Auth + RLS + pgvector + Storage + Realtime in one platform. RLS is the #1 reason — it's the multi-tenant isolation guarantee. No separate vector DB needed.
- **Vercel:** Zero-config Next.js deployment. Edge Functions for webhook routes. Preview deployments.
- **shadcn/ui + TanStack Table + React Hook Form + Zod:** Admin UI stack. shadcn/ui is open-code (you own components). Official Data Table guide uses TanStack. React Hook Form integration ships with `<Field />` component.
- **Vapi Server SDK (`@vapi-ai/server-sdk` 0.11.x):** TypeScript SDK for managing assistants, calls, campaigns. Works in Edge Runtime via `npm:` import.
- **OpenAI (`openai` 4.x):** `text-embedding-3-small` for RAG document embeddings. Used in both Edge Functions and serverless routes.

**What NOT to use:** n8n (project exists to replace it), Prisma/Drizzle (adds ORM complexity on Supabase), Redux/Zustand (server-rendered admin, no global state needed), CSS-in-JS (incompatible with Server Components), Vapi built-in GHL tools (single-action, no multi-tenant).

### Expected Features

**Must have (MVP — table stakes):**
- Multi-tenant org management (CRUD) with RLS on every table
- User authentication (Supabase Auth, admin + client roles)
- Assistant-to-org mapping (link Vapi assistant IDs to tenants)
- Tool-call webhook receiver (Edge Function, sub-500ms)
- Integration credential management (encrypted per-org GHL credentials)
- GoHighLevel integration (create contact, check availability, book, send SMS)
- Configurable trigger-action rules ("n8n Lite" sequential action config)
- Tool execution with status/timing logging
- End-of-call webhook ingestion (transcripts, summaries, metadata)
- Call list with filters (searchable, paginated, org-scoped)
- Call detail with inline tool badges (chat transcript + execution markers)
- Dashboard with aggregated metrics (total calls, tool success rate, alerts)

**Should have (Phase 2 — differentiators):**
- Tenant-scoped RAG knowledge base (pgvector + OpenAI embeddings)
- Campaign management with contact import and cadence
- Post-call analysis and scoring
- Failure alerting (email/webhook on tool failures)
- Custom webhook action type (generic HTTP request)

**Defer (v2+):**
- Client-facing read-only panel, Stripe billing, real-time call monitoring
- White-label branding, multi-integration support (Cal.com, HubSpot)
- A/B testing for actions, multi-language UI (PT/EN), mobile app

### Architecture Approach

The architecture follows an **Edge/Serverless split**: Vapi webhook routes use Edge Runtime for low-latency response; all admin CRUD routes use Node.js runtime for full npm ecosystem access. The Action Engine is a self-contained module with a **pluggable executor registry** — adding integrations requires one file. Data flows through five main paths: tool-call (live execution), end-of-call (observability ingestion), knowledge-base (RAG query), campaign (outbound dialing), and document processing (upload → chunk → embed → pgvector).

**Major components:**
1. **Edge Function: Tool Router** (`/api/vapi/tools`) — Receives Vapi `tool-calls` webhooks, resolves org via assistant mapping, dispatches to executor, returns result in <500ms
2. **Edge Function: Call Logger** (`/api/vapi/end-of-call`) — Receives `end-of-call-report`, stores transcript + metadata in `call_logs` scoped to org
3. **Action Executors** (`lib/actions/`) — Pluggable handlers: GHL (create contact, check availability, book appointment), future: Twilio, Cal.com, custom webhook, knowledge base
4. **Supabase PostgreSQL + RLS** — All persistent storage with `organization_id` on every table. `security definer` helper in `private` schema resolves current user's org. RLS policies use `(select auth.uid())` wrapping.
5. **Knowledge Pipeline** — Document upload → text extraction → chunking (~500 tokens) → OpenAI embeddings → pgvector with tenant-scoped HNSW index
6. **Dashboard UI** — shadcn/ui sidebar layout with TanStack Table data views, React Hook Form configuration panels, nuqs URL state for filters

### Critical Pitfalls

1. **Vapi tool-call timeout** — Responding too slowly kills live calls. Budget: 5ms validation + 50ms DB lookup + 50ms config fetch + 300ms external API = ~400ms. Use `EdgeRuntime.waitUntil()` for fire-and-forget logging. Only the data-returning action should be synchronous.
2. **Multi-tenant data leakage** — Missing or incorrect RLS policies expose cross-tenant data. Every table needs RLS enabled with `(select auth.uid())`-wrapped policies. Auto-enable RLS on new tables via event trigger. Write automated cross-org isolation tests.
3. **Credential storage in plain text** — GHL API keys, Twilio tokens stored unencrypted. Use AES-256-GCM via Web Crypto API. Encryption key in Edge Function secrets, never in DB or frontend.
4. **Edge Runtime limitations** — Code using `fs`, Node `crypto`, `require()` fails at runtime. Use Web Crypto API, ES module imports only, `fetch` for external APIs (no heavy SDKs). Test in actual Edge Runtime early.
5. **RLS performance degradation** — Unwrapped `auth.uid()` called per-row causes 20x slower queries. Missing `organization_id` indexes cause sequential scans. Wrap in `(select ...)`, index every `organization_id` column, add explicit filters in application queries.

## Implications for Roadmap

Based on combined research, the following phase structure is recommended. The ordering follows the critical dependency chain identified in FEATURES.md: org management → assistant mapping → webhook receiver → credential management → tool execution → logging → call ingestion → dashboard.

### Phase 1: Foundation
**Rationale:** Everything depends on multi-tenant isolation, auth, and org management. Without RLS and org scoping, no other feature is safe to build.
**Delivers:** Working Next.js app with Supabase connection, complete database schema with RLS policies on all tables, auth with middleware, org CRUD, and dashboard layout shell.
**Addresses:** Multi-tenant org management, user authentication, role-based access control, Supabase RLS on all tables
**Avoids:** Pitfalls #2 (RLS data leakage), #5 (RLS performance) — correct patterns established from day one
**Needs research:** No — well-documented patterns (Supabase Auth SSR, RLS policies, Next.js App Router)

### Phase 2: Action Engine
**Rationale:** This is the core value proposition per PROJECT.md ("The Action Engine must work"). It must be built before observability because observability shows the results of tool executions. The 500ms latency budget is the critical constraint.
**Delivers:** Assistant-to-org mapping, encrypted credential management, trigger-action configuration UI, Vapi tool-call webhook Edge Function, GHL executor (create contact, check availability, book appointment), action logging, end-to-end test with real Vapi webhook.
**Addresses:** Assistant-to-org mapping, tool-call webhook receiver, integration credential management, GoHighLevel integration, configurable trigger-action rules, tool execution with logging
**Avoids:** Pitfalls #1 (Vapi timeout — fire-and-forget pattern), #3 (credential encryption — AES-256-GCM from day one), #4 (Edge Runtime — tested in actual runtime), #6 (service_role + manual org filtering pattern)
**Needs research:** Yes — Vapi Custom Tools webhook payload format and response shape need hands-on validation during implementation. GHL API endpoints for contact creation, availability checking, and appointment booking need API documentation review.

### Phase 3: Observability
**Rationale:** Once the Action Engine executes tools, agencies need to see what happened. Call logs + transcripts + inline tool badges are the highest perceived-value features for proving the system works to clients. Dashboard metrics are the landing page.
**Delivers:** End-of-call webhook ingestion, call list page with filters, call detail with chat-format transcript, inline tool execution badges (merged from `call_logs` + `action_logs` by call_id/timestamp), dashboard with KPI cards.
**Addresses:** End-of-call webhook ingestion, call list with filters, call detail with inline tool badges, dashboard with aggregated metrics
**Avoids:** Pitfall #8 (data volume explosion — selective event storage, cursor pagination, time-based indexes from schema design)
**Needs research:** No — standard data table + detail view patterns with shadcn/ui and TanStack Table

### Phase 4: Knowledge Base / RAG
**Rationale:** Tenant-scoped RAG is a key differentiator that no competitor offers. It depends on the Action Engine (knowledge queries execute through the executor registry) and org-scoped data (pgvector with `organization_id`). Document processing is a self-contained pipeline.
**Delivers:** Document upload (PDF, URL, text, CSV) → Supabase Storage, text extraction → chunking → OpenAI embeddings → pgvector, pgvector match function with HNSW index, knowledge executor in Action Engine, document management UI with status tracking.
**Addresses:** Knowledge Base / RAG, document upload + processing, semantic search during tool execution
**Avoids:** Pitfall #7 (pgvector performance — HNSW index from day one, `organization_id` filter in match function, order by distance operator)
**Needs research:** Yes — document chunking strategy (chunk size, overlap) and embedding model configuration may need experimentation

### Phase 5: Outbound Campaigns
**Rationale:** Campaign management is the most self-contained feature. It doesn't depend on knowledge base or advanced observability. It wraps Vapi's outbound API with multi-tenant campaign tracking.
**Delivers:** Campaign CRUD, CSV contact import, Vapi outbound API integration, sequential batch dialing with cadence, real-time contact status tracking via status webhook, campaign monitoring dashboard.
**Addresses:** Campaign management with contact import and cadence
**Avoids:** Pitfall #9 (race conditions — `SELECT FOR UPDATE SKIP LOCKED`, idempotency keys, unique constraints on campaign+contact+attempt)
**Needs research:** Yes — Vapi Outbound Campaigns API details for batch dialing, scheduling, and dynamic variables

### Phase 6: Polish & Extensions
**Rationale:** Additional executors, failure alerting, and performance optimizations extend the platform after the core loop is working end-to-end.
**Delivers:** Twilio SMS executor, custom webhook executor, failure alerting (email/webhook), pre-aggregated dashboard metrics, additional polish.
**Addresses:** Custom webhook action type, failure alerting, multi-integration support foundation
**Needs research:** Partial — each new integration (Twilio, Cal.com) needs API research

### Phase Ordering Rationale

- **Foundation → Action Engine:** RLS and org scoping are hard prerequisites for tool routing. Without org resolution from assistant mapping, webhooks can't identify which tenant's credentials to use.
- **Action Engine → Observability:** You need tool executions before you can observe them. Inline tool badges merge `call_logs` + `action_logs`, requiring both data sources.
- **Observability → Knowledge Base:** Call list and transcript views prove the system works to stakeholders. RAG adds capability but doesn't prove value the way a working dashboard does.
- **Knowledge Base → Campaigns:** Campaigns are self-contained and can technically be built in parallel with Knowledge Base. However, campaign calls generate call logs that benefit from the observability UI already being built.
- **All features before Polish:** Performance optimizations (pre-aggregation, caching) and additional integrations add the most value when there's real data flowing through the system.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Action Engine):** Vapi Custom Tools webhook payload format needs hands-on validation. GHL REST API endpoints (contact CRUD, calendar availability, appointment booking) need endpoint documentation. Credential encryption/decryption cycle with Web Crypto in Edge Runtime needs a spike.
- **Phase 4 (Knowledge Base):** Chunking strategy (optimal chunk size for voice AI context, overlap ratio). Embedding model selection (1536 vs reduced dimensions). Document processing pipeline for PDF text extraction in Edge/Serverless constraints.
- **Phase 5 (Campaigns):** Vapi Outbound Campaigns API for batch dialing, cadence configuration, and dynamic variables. Campaign state machine (pending → dialing → completed/failed) with concurrent access patterns.

**Phases with standard patterns (skip deep research):**
- **Phase 1 (Foundation):** Supabase Auth SSR + Next.js 15, RLS policy patterns, shadcn/ui dashboard layout — all well-documented with official guides.
- **Phase 3 (Observability):** Data table with TanStack Table + shadcn/ui, chat transcript UI, KPI dashboard cards — standard admin panel patterns.
- **Phase 6 (Polish):** Integration adapters follow the executor pattern established in Phase 2.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official docs within last 6 months. Next.js 15 stable since Oct 2024. Supabase RLS, pgvector, Edge Functions all production-ready. |
| Features | HIGH | Direct competitor analysis (ChatDash, Vapify, Voicerr, VoiceAIWrapper, Sympana) confirms feature differentiation. Vapi docs provide webhook event types and campaign API details. |
| Architecture | HIGH | Edge/Serverless split, pluggable executor registry, RLS with security definer helpers — all battle-tested patterns. Vapi webhook payload shapes verified from official docs. |
| Pitfalls | HIGH | All pitfalls sourced from official documentation (Supabase RLS benchmarks, Vercel Edge Runtime limits, Vapi server events). Performance benchmarks from Supabase's own published data. |

**Overall confidence:** HIGH

### Gaps to Address

- **Edge Function deployment strategy:** STACK.md recommends Supabase Edge Functions (Deno, co-located with DB) while ARCHITECTURE.md uses Next.js Route Handlers with `runtime = 'edge'` (Vercel Edge, single deployment). Both are viable. The Next.js approach is simpler (single codebase) and should be the default unless latency testing shows DB round-trips exceeding the budget. Resolve during Phase 1 by measuring actual latency from Vercel Edge to Supabase in the same region.
- **Vapi webhook payload shape:** Research is based on documentation. The actual payload structure for `tool-calls` and `end-of-call-report` should be validated with a test webhook during Phase 2 before building the full Action Engine.
- **GHL API rate limits and error handling:** GoHighLevel's rate limiting behavior and error response formats need exploration during Phase 2 to implement proper backoff and retry logic.
- **Document processing constraints:** PDF text extraction in Edge/Serverless environments has file size and processing time limits that need testing during Phase 4.

## Sources

### Primary (HIGH confidence)
- **Vapi Official Docs** (docs.vapi.ai) — Server events, Custom Tools, Server Authentication, Outbound Campaigns, GoHighLevel integration, Knowledge Base
- **Supabase Official Docs** (supabase.com/docs) — RLS policies, Auth SSR for Next.js, pgvector, Edge Functions, connection pooling
- **Next.js Blog/Docs** (nextjs.org) — Next.js 15 features, Route Handlers, Edge Runtime
- **shadcn/ui Docs** (ui.shadcn.com) — Data Table, React Hook Form integration, component library
- **Vercel Edge Runtime Docs** (vercel.com/docs) — Limits, bundle size, cold start times

### Secondary (MEDIUM confidence)
- **Competitor analysis** (ChatDash, Vapify, Voicerr AI, VoiceAIWrapper, Sympana) — Feature differentiation, market positioning
- **Retell AI / Bland AI** — Adjacent voice AI platform feature comparison
- **Supabase RLS benchmarks** (GaryAustin1 / Supabase community) — `auth.uid()` wrapping performance data

### Tertiary (LOW confidence)
- **GHL REST API specifics** — Endpoint documentation needs direct verification during implementation
- **Chunking/embedding optimization** — Optimal parameters need experimentation with real documents

---
*Research completed: 2026-03-30*
*Ready for roadmap: yes*
