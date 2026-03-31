# Stack Research

**Domain:** Multi-tenant SaaS operations platform for Vapi.ai voice AI management
**Researched:** 2026-03-30
**Overall Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Next.js | 15.x (App Router) | Frontend framework + SSR | Stable, mature App Router; React 19; extensive Vercel optimization. Skip 16.x — too new with breaking async params/cache model changes that add risk without benefit for this project. | HIGH |
| TypeScript | 5.x (strict) | Type safety | Non-negotiable per PROJECT.md. Strict mode catches tenant isolation bugs at compile time. | HIGH |
| React | 19.x | UI runtime | Ships with Next.js 15. Server Components reduce client bundle; critical for dashboard-heavy app. | HIGH |
| Supabase | Latest (hosted) | Backend platform | PostgreSQL + Auth + RLS + pgvector + Edge Functions + Storage + Realtime — single platform replaces 5+ services. RLS is the multi-tenant isolation guarantee. | HIGH |
| Vercel | Latest | Hosting | Zero-config Next.js deployment; Edge Functions for API routes; preview deployments for testing. | HIGH |
| shadcn/ui | Latest | Component library | Open-code model (you own the components). Official Data Table guide uses TanStack Table. Ships with `<Field />` + React Hook Form integration. Sidebar, Dialog, Sheet, Tabs — all the building blocks for an admin panel. | HIGH |

### Database Layer

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| PostgreSQL (Supabase) | 15+ | Primary database | Supabase-managed. All multi-tenant tables use `organization_id` column with RLS policies. | HIGH |
| pgvector | Latest | Vector embeddings for RAG | Supabase-native extension. Stores OpenAI embeddings; cosine similarity search via SQL functions. No external vector DB needed — keeps stack simple. | HIGH |
| Supabase RLS | — | Multi-tenant data isolation | `organization_id` on every table + RLS policies = impossible for tenant A to see tenant B's data, even with code bugs. This is the #1 reason Supabase was chosen. | HIGH |
| Supabase Edge Functions | Latest (Deno) | Vapi webhook receivers | **All `/api/vapi/*` routes MUST be Edge Functions** — globally distributed, no cold start on Vercel, sub-500ms response to Vapi. Deno runtime with `npm:` imports. | HIGH |

### Integration SDKs

| Library | Version | Purpose | Why Recommended | Confidence |
|---------|---------|---------|-----------------|------------|
| `@vapi-ai/server-sdk` | 0.11.x | Vapi API client | Official TypeScript SDK for managing assistants, calls, campaigns, tools. Full type coverage. | HIGH |
| `@supabase/supabase-js` | 2.x | Supabase client (browser + server) | Standard client for all Supabase operations. Works in both Next.js and Edge Functions via `npm:` import. | HIGH |
| `@supabase/ssr` | Latest | Cookie-based SSR auth | Handles session refresh in Next.js middleware. `createServerClient` + `createBrowserClient` pattern. | HIGH |
| `openai` | 4.x | Embeddings for RAG knowledge base | `text-embedding-3-small` for document chunking. Used in Edge Functions for processing uploaded docs. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-table` | 8.x | Headless data table engine | All list views: calls, campaigns, contacts, action logs, knowledge base docs. shadcn/ui has official Data Table guide using this. |
| `react-hook-form` | 7.x | Form state management | All forms: org settings, tool configuration, campaign creation, credential management. Ships with shadcn/ui `<Field />` integration. |
| `@hookform/resolvers` | Latest | Zod resolver for RHF | Bridges Zod schemas into React Hook Form validation. |
| `zod` | 3.x | Schema validation | Shared schemas between client and server. Validates Vapi webhook payloads, form inputs, API responses. |
| `lucide-react` | Latest | Icon library | Default icon set for shadcn/ui. Tree-shakeable. |
| `sonner` | Latest | Toast notifications | shadcn/ui ships with Sonner integration. Use for action feedback, error alerts. |
| `date-fns` | 3.x | Date formatting and manipulation | Call timestamps, campaign scheduling, log filters. Tree-shakeable alternative to moment/dayjs. |
| `papaparse` | 5.x | CSV parsing | Campaign contact list imports. Browser + server compatible. |
| `nuqs` | Latest | URL search params state | Table filters, pagination state persisted in URL. Works with Next.js App Router. |

### Supabase Edge Function Dependencies

These run in the **Deno runtime** (not Node.js). Specify via `import_map.json`.

| Library | Import | Purpose |
|---------|--------|---------|
| `@supabase/supabase-js` | `npm:@supabase/supabase-js@2` | DB access in Edge Functions |
| `openai` | `npm:openai@4` | Embeddings generation |
| `zod` | `npm:zod@3` | Payload validation |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Supabase CLI | Local dev, migrations, edge functions | `supabase init`, `supabase functions serve`, `supabase db push` |
| `supabase` npm package | Type generation | `supabase gen types typescript` — generate DB types from schema |
| Vapi CLI | Webhook testing, tool management | `vapi listen --forward-to localhost:3000/webhook` for local dev |
| ngrok | Local tunnel for Vapi webhooks | Required for `vapi listen` to forward to local server |
| ESLint + Prettier | Code quality | Standard Next.js config. Strict TypeScript rules. |

## Installation

```bash
# Create Next.js project
npx create-next-app@15 voiceops --typescript --tailwind --eslint --app --src-dir

# Core dependencies
npm install @supabase/supabase-js @supabase/ssr @vapi-ai/server-sdk openai

# UI and forms
npm install @tanstack/react-table react-hook-form @hookform/resolvers zod
npm install lucide-react sonner date-fns papaparse nuqs

# shadcn/ui (initializes config + adds components)
npx shadcn@latest init
npx shadcn@latest add table button card dialog sheet sidebar tabs input select textarea badge dropdown-menu command popover checkbox switch separator skeleton avatar toast form field

# Dev dependencies
npm install -D @types/papaparse
```

## Architecture Decision: Vapi Webhook Flow

**Critical architectural decision for the Action Engine:**

```
Vapi Call (live)
    │
    ▼ tool-calls webhook
Supabase Edge Function (/api/vapi/tool-calls)
    │
    ├─► 1. Validate webhook signature (HMAC)
    ├─► 2. Look up org by assistant ID → get credentials
    ├─► 3. Look up tool config → get action sequence
    ├─► 4. Execute actions sequentially (GHL API, Cal.com, etc.)
    ├─► 5. Log each action with timing + payloads
    └─► 6. Return { results: [...] } to Vapi (< 500ms)
```

**Why NOT use Vapi's built-in GoHighLevel tools:**
Vapi has native GHL integration (Get/Create Contact, Check Availability, Create Event), but VoiceOps needs:
1. **Action chaining** — one tool call triggers a sequence (create contact → check availability → book)
2. **Multi-tenant credentials** — each org has different GHL API keys, managed per-tenant
3. **Full observability** — every action logged with timing, request/response for the dashboard
4. **Admin configurability** — trigger→action mapping configured by admin per org
5. **Extensibility** — future integrations beyond GHL (Cal.com, custom webhooks, SMS)

The Vapi built-in GHL tools are per-assistant and can't do any of this. VoiceOps uses **Custom Tools** with `server.url` pointing to VoiceOps Edge Functions, giving full control.

**Edge Function latency strategy:**
- Simple actions (create GHL contact, check availability): Execute synchronously, respond within 200ms
- Complex chains (3+ actions): Execute first action synchronously, return intermediate result, continue async
- Heavy processing (document upload, embedding generation): Respond 200 OK immediately, process in background via `EdgeRuntime.waitUntil()`

## Supabase Auth Pattern for Multi-Tenancy

```typescript
// lib/supabase/server.ts — Server Component client
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
          catch { /* Server Component — setAll handled by middleware */ }
        },
      },
    }
  );
}
```

**Auth roles:**
- `admin` — Full access to all organizations, configuration, user management
- `client` — Read-only access to own org's calls, transcripts, logs (deferred to post-MVP)

**RLS pattern (every table):**
```sql
CREATE POLICY "org_isolation" ON call_logs
  USING (organization_id = get_current_org_id());
```

## RAG Knowledge Base Pattern

VoiceOps implements a **Custom Knowledge Base** endpoint (not Vapi's built-in KB):

```
User asks question during call
    │
    ▼ knowledge-base-request webhook
Supabase Edge Function (/api/vapi/knowledge-base)
    │
    ├─► 1. Get latest user message
    ├─► 2. Generate embedding via OpenAI text-embedding-3-small
    ├─► 3. Query pgvector with tenant-scoped cosine similarity
    └─► 4. Return { documents: [...] } to Vapi
```

**Why custom KB endpoint:**
- Tenant-scoped search (pgvector + RLS = org isolation)
- Admin can see which documents are queried (observability)
- Supports PDF, URL, text, CSV uploads processed into chunks

**pgvector schema:**
```sql
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding EXTENSIONS.vector(1536), -- text-embedding-3-small
  source_type TEXT, -- 'pdf', 'url', 'text', 'csv'
  source_url TEXT,
  chunk_index INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Framework | Next.js 15 | Next.js 16 | Too new (Oct 2025). Breaking changes in params/cache model. No benefit for this project that justifies the risk. |
| Framework | Next.js 15 | Remix | Supabase docs and examples are Next.js-first. Vercel hosting optimized for Next.js. |
| Framework | Next.js 15 | Next.js 14 | 15 is stable since Oct 2024. React 19, improved caching, Turbopack stable. No reason to stay on 14. |
| Backend | Supabase | Firebase | No PostgreSQL, no RLS, no pgvector. Would need separate vector DB for RAG. |
| Backend | Supabase | Self-hosted Postgres + custom auth | Massive overhead. Supabase RLS is the multi-tenant guarantee. |
| Vector DB | pgvector | Pinecone/Weaviate | pgvector is co-located with app data. No additional service, no sync issues. Sufficient for <1M vectors per tenant. |
| Components | shadcn/ui | MUI/Ant Design | shadcn/ui is open-code (full control). Better for custom admin panels. Native TanStack Table integration. |
| Tables | TanStack Table | AG Grid | TanStack is headless (full styling control). AG Grid is heavy and opinionated. Free. |
| Forms | React Hook Form + Zod | TanStack Form | RHF is proven, shadcn/ui has official integration. TanStack Form is newer. |
| ORM | supabase-js (no ORM) | Prisma/Drizzle | Supabase client handles typed queries via generated types. No ORM needed — adds complexity for little benefit with RLS. |
| Edge Functions | Supabase Edge Functions | Vercel Edge Functions | Latency: Vapi needs <500ms response. Supabase Edge Functions are co-located with DB, avoiding network hop to Vercel. |
| State | nuqs + server state | Redux/Zustand | URL-based state for table filters. Server state from Supabase queries. No need for global client state. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| n8n | Entire project exists to replace n8n. No hybrid mode. | VoiceOps Action Engine |
| Vercel API routes for Vapi webhooks | Cold starts, not co-located with DB. Vapi latency requirement makes this non-negotiable. | Supabase Edge Functions |
| Vapi built-in GoHighLevel tools | No multi-tenant cred management, no action chaining, no observability. | Custom Tools → VoiceOps Action Engine |
| Vapi built-in Knowledge Base | No tenant-scoping, no admin observability. | Custom KB endpoint → pgvector |
| Prisma or Drizzle | Adds ORM layer on top of Supabase client which already handles typed queries via generated types. RLS policies are SQL-first. | `supabase-js` + generated types |
| Redux / Zustand | This is a server-rendered admin panel, not a SPA. Supabase queries + URL state cover all needs. | `nuqs` for URL state; `supabase-js` for server state |
| `moment.js` | Deprecated, massive bundle. | `date-fns` (tree-shakeable) |
| CSS-in-JS (styled-components) | Not compatible with Server Components. | Tailwind CSS (ships with Next.js + shadcn/ui) |
| Server Actions for Vapi webhooks | Server Actions are for form submissions, not webhook receivers. Can't guarantee sub-500ms. | Supabase Edge Functions |
| WebSockets for real-time | Supabase Realtime handles this out of the box. | Supabase Realtime (Postgres Changes) |

## Stack Patterns by Variant

**If you need to add a new integration (e.g., Cal.com):**
- Add integration type to `integrations` table
- Add action handlers in Edge Functions (`actions/calcom.ts`)
- Add credential fields to org settings UI
- No framework changes needed — action engine is pluggable

**If pgvector performance becomes insufficient at scale (>10M vectors):**
- Add HNSW index: `CREATE INDEX ON knowledge_documents USING hnsw (embedding vector_cosine_ops);`
- If still insufficient, migrate to Supabase Vector Buckets (public alpha, S3 Vectors backed)
- Do NOT introduce a separate vector DB — keep co-located

**If Edge Function cold starts become noticeable:**
- Supabase Edge Functions have minimal cold starts compared to serverless
- Use `EdgeRuntime.waitUntil()` for background work
- Keep functions small and focused — one function per webhook type

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Next.js 15.x | React 19.x | Next.js 15 ships React 19 — don't pin React separately |
| Next.js 15.x | @supabase/ssr latest | Official guide uses Next.js middleware pattern |
| shadcn/ui latest | React 19.x | Full React 19 support since late 2025 |
| shadcn/ui latest | @tanstack/react-table 8.x | Official Data Table component guide |
| shadcn/ui latest | react-hook-form 7.x + zod 3.x | Official React Hook Form guide with `<Field />` |
| @vapi-ai/server-sdk 0.11.x | Node 18+ / Deno / Edge | Works in Supabase Edge Functions via `npm:` import |
| Supabase Edge Functions | Deno runtime | NOT Node.js — use `npm:` imports, no `node_modules` |
| pgvector | PostgreSQL 15+ (Supabase default) | Enable via `create extension vector` |
| openai 4.x | Deno (Edge Functions) | Use via `npm:openai@4` in import_map.json |

## Key Environment Variables

```bash
# .env.local (Next.js / Vercel)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx  # Server-side only — NEVER expose to client

# Supabase Edge Function secrets (via supabase CLI)
VAPI_WEBHOOK_SECRET=xxx           # HMAC secret for Vapi webhook verification
OPENAI_API_KEY=sk-xxx             # For embeddings generation
VAPI_API_KEY=vapi_xxx             # For Vapi API calls (campaigns, assistants)
```

## Sources

- **Next.js Blog** (nextjs.org/blog) — Verified Next.js 15/16 release timeline and features
- **Supabase Changelog** (supabase.com/changelog) — Verified Edge Functions, RLS, pgvector, PostgREST v14
- **Vapi Docs** (docs.vapi.ai) — Verified Custom Tools, Server URL events, GHL integration, Knowledge Base, Outbound Campaigns, Server Authentication
- **Vapi Server SDK** (npmjs.com/package/@vapi-ai/server-sdk) — Verified v0.11.0, TypeScript types, runtime compatibility
- **Supabase Auth SSR** (supabase.com/docs/guides/auth/server-side/nextjs) — Verified `@supabase/ssr` patterns for Next.js 15
- **Supabase Vector Columns** (supabase.com/docs/guides/ai/vector-columns) — Verified pgvector setup, match functions, operators
- **Supabase Edge Functions** (supabase.com/docs/guides/functions) — Verified Deno runtime, `npm:` imports, connect-to-postgres patterns
- **shadcn/ui** (ui.shadcn.com/docs) — Verified Data Table (TanStack Table), React Hook Form integration, Field component
- **Confidence:** HIGH — All recommendations verified against official docs published within last 6 months

---
*Stack research for: VoiceOps multi-tenant SaaS platform*
*Researched: 2026-03-30*
