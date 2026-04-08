# Operator — Technology Stack & Integrations

**Last updated:** 2026-04-03

## Core Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 15.5.14 | Full-stack framework (App Router, Edge runtime, Server Actions) |
| `react` / `react-dom` | 19.0.0 | UI library (Server Components, `use client`) |
| `typescript` | 5 | Strict type checking |

Config files: `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`

## Frontend

| Package | Version | Purpose |
|---------|---------|---------|
| `tailwindcss` | 4 | Utility CSS |
| `@radix-ui/*` (9 packages) | Various | Headless UI primitives (Dialog, Select, Dropdown, etc.) |
| `lucide-react` | 1.7.0 | Icons |
| `sonner` | 2.0.7 | Toast notifications |
| `react-hook-form` | 7.72.0 | Form state |
| `@hookform/resolvers` | 5.2.2 | Zod adapter for react-hook-form |
| `zod` | 3.25.76 | Schema validation |
| `@tanstack/react-table` | 8.21.3 | Headless data tables |
| `class-variance-authority` | 0.7.1 | Component variant styling |
| `tailwind-merge` | 3.5.0 | Merge Tailwind classes safely |
| `clsx` | 2.1.1 | Conditional className |

Component library config: `components.json` (shadcn/ui)

## Backend & Data

| Package | Version | Purpose |
|---------|---------|---------|
| `@supabase/supabase-js` | 2.101.1 | DB, auth, storage client |
| `@supabase/ssr` | 0.10.0 | SSR cookie-based auth helpers |
| `openai` | 6.33.0 | Embeddings (text-embedding-3-small, 1536D) |
| `@anthropic-ai/sdk` | 0.82.0 | Claude for knowledge synthesis (fallback) |

## Data Processing

| Package | Version | Purpose |
|---------|---------|---------|
| `papaparse` | 5.5.3 | CSV parsing for campaign contact lists |
| `unpdf` | 1.4.0 | PDF text extraction |
| `cheerio` | 1.2.0 | HTML/URL content parsing |
| `gpt-tokenizer` | 3.4.0 | Token counting for document chunking |
| `date-fns` | 4.1.0 | Date manipulation |

## Dev & Testing

| Package | Version | Purpose |
|---------|---------|---------|
| `vitest` | 4.1.2 | Test runner (Node environment) |
| `@vitejs/plugin-react` | 6.0.1 | JSX support in tests |
| `eslint` | 9 | Linting |
| `eslint-config-next` | 15.5.14 | Next.js lint rules |

Config: `vitest.config.ts`

---

## External Integrations

### Vapi (Voice Calls)
- **Purpose**: AI voice calling — inbound/outbound calls, assistant management, phone numbers
- **Auth**: `VAPI_API_KEY` env var
- **Webhook endpoints**:
  - `POST /api/vapi/tools` — live tool calls during calls (Edge, 500ms budget)
  - `POST /api/vapi/calls` — end-of-call reports (Edge)
  - `POST /api/vapi/campaigns` — campaign call completions (Edge)
- **Outbound**: `POST https://api.vapi.ai/call`
- **Key files**: `src/app/api/vapi/`, `src/lib/campaigns/outbound.ts`

### Supabase (Database + Auth + Storage)
- **Purpose**: PostgreSQL DB, JWT auth, file storage, edge functions, real-time
- **Auth vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Storage bucket**: `knowledge-docs` (PDF, TXT, CSV uploads)
- **Edge function**: `supabase/functions/process-embeddings/` (Deno runtime)
- **RPC**: `match_document_chunks` (HNSW cosine similarity search)
- **Key files**: `src/lib/supabase/`, `supabase/migrations/`

### GoHighLevel / LeadConnector (CRM)
- **Purpose**: Contact creation, appointment booking, availability checking
- **API base**: `https://services.leadconnectorhq.com` (v2021-07-28)
- **Auth**: Encrypted Private Integration Token + Location ID stored in `integrations` table
- **Hard timeout**: 400ms (within 500ms Vapi budget)
- **Key files**: `src/lib/ghl/`

### OpenAI
- **Purpose**: Text embeddings (`text-embedding-3-small`, 1536 dimensions)
- **Auth**: Stored encrypted in `integrations` table per org
- **Key files**: `src/lib/knowledge/embed.ts`, `supabase/functions/process-embeddings/`

### Anthropic (Claude)
- **Purpose**: Knowledge base answer synthesis (direct fallback)
- **Model**: `claude-3-5-haiku-20241022`
- **Auth**: Stored encrypted in `integrations` table per org
- **Key file**: `src/lib/knowledge/query-knowledge.ts`

### OpenRouter (Optional)
- **Purpose**: Cost-optimized LLM routing (preferred over direct Anthropic)
- **Model**: `anthropic/claude-haiku-4-5`
- **Auth**: Stored encrypted in `integrations` table per org
- **Key file**: `src/lib/knowledge/query-knowledge.ts`

---

## Infrastructure

### Hosting
- **Vercel** — implied by Next.js 15; no explicit `vercel.json` (uses defaults)
- No Docker; serverless deployment pattern

### CI/CD
- **GitHub Actions**: `.github/workflows/supabase-keepalive.yml`
  - Runs every 3 days (cron `0 8 */3 * *`) to prevent free-tier Supabase spindown
  - HTTP health ping to Supabase REST API

### Database
- **6 SQL migrations** in `supabase/migrations/`:
  - `001_foundation.sql` — orgs, users, members, assistant_mappings
  - `002_action_engine.sql` — integrations, tool_configs, action_logs
  - `003_observability.sql` — calls table
  - `004_knowledge_base.sql` — documents, document_chunks (pgvector)
  - `005_campaigns.sql` — campaigns, campaign_contacts
  - `006_api_key_admin.sql` — admin utilities

### Runtime Split
- **Node.js runtime**: Dashboard pages, server actions, knowledge upload
- **Edge runtime**: All `/api/vapi/*` webhook handlers, `src/middleware.ts`
- **Deno runtime**: `supabase/functions/process-embeddings/` (Supabase Edge Functions)

---

## Environment Variables

```bash
# Required for all environments
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
ENCRYPTION_SECRET          # 32-byte hex (64 chars) for AES-256-GCM

# Per-org keys (stored encrypted in DB, not env)
VAPI_API_KEY               # Server-side only; also stored per-org in integrations table
OPENAI_API_KEY             # Also stored per-org
ANTHROPIC_API_KEY          # Also stored per-org
```

Note: Most API keys are stored **per-organization** in the encrypted `integrations` table, not as env vars. This supports multi-org setups with different API credentials.
