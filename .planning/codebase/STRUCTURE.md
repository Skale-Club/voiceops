# Project Structure

**Analysis Date:** 2026-04-02

> All structure is planned. No source code exists yet. This documents the intended layout per the master prompt and research files.

---

## Directory Layout (Planned)

```
voiceops/
├── .github/
│   └── workflows/
│       ├── deploy.yml              # Production deploy to Vercel (on push to main)
│       └── preview.yml             # Preview deploy (on PR to main)
├── src/
│   ├── app/
│   │   ├── (auth)/                 # Route group — no dashboard layout
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── callback/route.ts   # Supabase auth callback handler
│   │   ├── (dashboard)/            # Route group — shared sidebar + header layout
│   │   │   ├── layout.tsx          # Sidebar, header, org context provider
│   │   │   ├── page.tsx            # Main dashboard (metrics overview)
│   │   │   ├── assistants/
│   │   │   │   └── page.tsx        # Vapi assistant → org mapping
│   │   │   ├── integrations/
│   │   │   │   └── page.tsx        # Integration credential management
│   │   │   ├── tools/
│   │   │   │   ├── page.tsx        # Tool config list
│   │   │   │   └── [id]/page.tsx   # Tool detail / action builder
│   │   │   ├── knowledge/
│   │   │   │   ├── page.tsx        # Document list + upload
│   │   │   │   └── [id]/page.tsx   # Document detail + chunk viewer
│   │   │   ├── outbound/
│   │   │   │   ├── page.tsx        # Campaign list
│   │   │   │   └── [id]/page.tsx   # Campaign detail + contact table
│   │   │   └── calls/
│   │   │       ├── page.tsx        # Call list with filters
│   │   │       └── [id]/page.tsx   # Call detail + transcript + tool badges
│   │   ├── api/
│   │   │   ├── vapi/               # ⚡ ALL routes here MUST be Edge Functions
│   │   │   │   ├── tools/route.ts          # Action Router (tool-calls webhook)
│   │   │   │   ├── end-of-call/route.ts    # Call Logger (end-of-call-report)
│   │   │   │   └── status/route.ts         # Status Sync (status-update events)
│   │   │   ├── auth/               # Signup / login handlers
│   │   │   ├── organizations/      # Org CRUD (admin only)
│   │   │   ├── assistants/         # Assistant mapping CRUD
│   │   │   ├── integrations/       # Credential CRUD + test connection
│   │   │   ├── tools/              # Tool config CRUD
│   │   │   ├── knowledge/          # Document upload, status, delete
│   │   │   ├── outbound/           # Campaign CRUD, start/pause/stop, contact import
│   │   │   ├── calls/              # Call log queries, detail, action logs
│   │   │   └── analytics/          # Aggregated metrics for dashboard
│   │   ├── layout.tsx              # Root layout
│   │   └── middleware.ts           # Auth middleware (Supabase session refresh)
│   ├── components/
│   │   ├── ui/                     # shadcn/ui base components (owned — not node_modules)
│   │   ├── layout/                 # Sidebar, header, org switcher
│   │   ├── dashboard/              # Metric cards, charts
│   │   ├── calls/                  # Transcript viewer, inline action badges
│   │   ├── tools/                  # Action builder UI, action type cards
│   │   ├── knowledge/              # Document upload dropzone, chunk viewer
│   │   ├── campaigns/              # Campaign status display, contact status table
│   │   └── integrations/           # Credential forms, test connection buttons
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser client (createBrowserClient)
│   │   │   ├── server.ts           # Server client (createServerClient + cookies)
│   │   │   └── admin.ts            # Service role client — Edge Functions ONLY
│   │   ├── vapi/
│   │   │   ├── types.ts            # Vapi webhook payload TypeScript types
│   │   │   ├── outbound.ts         # Vapi REST API wrapper (outbound campaigns)
│   │   │   └── resolve-org.ts      # Shared org resolver for all Vapi webhooks
│   │   ├── actions/                # Action Executor Registry (the "n8n Lite")
│   │   │   ├── registry.ts         # action_type string → executor mapping
│   │   │   ├── executor.ts         # Base executor interface
│   │   │   ├── ghl.ts              # GoHighLevel executor (create_contact, get_availability, create_appointment)
│   │   │   ├── twilio.ts           # Twilio SMS executor (send_sms)
│   │   │   ├── cal.ts              # Cal.com executor
│   │   │   ├── webhook.ts          # Generic custom webhook executor
│   │   │   └── knowledge.ts        # RAG knowledge base query executor
│   │   ├── knowledge/
│   │   │   ├── extract.ts          # Text extraction from PDF, URL, CSV
│   │   │   ├── chunk.ts            # Text chunking (~500 tokens)
│   │   │   ├── embed.ts            # OpenAI text-embedding-3-small generation
│   │   │   └── search.ts           # pgvector cosine similarity search
│   │   ├── encryption.ts           # AES-256-GCM credential encryption/decryption
│   │   └── utils.ts                # Shared utilities
│   ├── hooks/                      # Custom React hooks
│   └── types/
│       ├── database.ts             # Supabase generated types (via supabase gen types)
│       ├── vapi.ts                 # Vapi event/payload types
│       └── actions.ts              # Action config and executor types
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # Full schema: all tables + RLS + pgvector index
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── .env.local                      # Local env vars (gitignored)
└── README.md
```

## Implemented Additions Since Planning

- `src/app/(dashboard)/widget/page.tsx` — authenticated widget configuration dashboard route for the active organization
- `src/app/(dashboard)/widget/actions.ts` — server actions for widget settings persistence and token regeneration
- `src/components/widget/` — feature components for widget settings UX and local preview rendering

---

## Module Boundaries

### `src/app/api/vapi/` — Edge Function Boundary
Every `route.ts` file in this directory MUST have `export const runtime = 'edge'` at the top. These routes are called by Vapi during live calls and must respond within 500ms. They use `lib/supabase/admin.ts` (service role) and `lib/actions/` executors. They do NOT import from `components/` or use cookies-based auth.

### `src/app/(dashboard)/` — Authenticated Admin UI
Server components by default. Uses `lib/supabase/server.ts` (cookie-based auth) for data fetching. Client components (`'use client'`) only where interactivity is needed (forms, modals, real-time tables). The `layout.tsx` provides sidebar, header, and org context.

### `src/app/(auth)/` — Unauthenticated Auth Pages
No sidebar or org context. Separate layout from dashboard. Supabase Auth handles session; `middleware.ts` redirects unauthenticated users here.

### `src/lib/supabase/` — Three Distinct Clients (Never Mix)
- `client.ts` — Browser only (React components, client-side mutations)
- `server.ts` — Server Components and API routes with user JWT context (respects RLS)
- `admin.ts` — Service role, bypasses RLS — ONLY imported in `src/app/api/vapi/` Edge Functions

### `src/lib/actions/` — Action Executor Module
Self-contained. The Edge Function tool router is the only caller. Executors receive `toolConfig` (with credentials) and `toolArgs` (from Vapi). They must return a plain string result for Vapi to speak. Each executor file is independent — no cross-executor imports.

### `src/components/ui/` — Owned shadcn/ui Components
These are generated by `npx shadcn@latest add` and owned by the project (not inside `node_modules`). Customize freely. Do not manually edit if re-generating — move customizations to wrapper components in the sibling directories.

---

## Entry Points

**Application entry:**
- `src/app/layout.tsx` — Root HTML layout, fonts, providers
- `src/middleware.ts` — Runs on every request; refreshes Supabase session tokens; redirects unauthenticated users to `/login`

**Vapi webhook entry points (Edge Functions):**
- `src/app/api/vapi/tools/route.ts` — Primary entry for live call tool execution
- `src/app/api/vapi/end-of-call/route.ts` — Entry for post-call data capture
- `src/app/api/vapi/status/route.ts` — Entry for call status updates

**Dashboard entry:**
- `src/app/(dashboard)/page.tsx` — Default landing after login (metrics overview)

**Auth flow entry:**
- `src/app/(auth)/login/page.tsx` — Login form
- `src/app/(auth)/callback/route.ts` — Supabase Auth OAuth/magic link callback

---

## Configuration

**Next.js config:**
- `next.config.ts` — Standard Next.js App Router config

**TypeScript config:**
- `tsconfig.json` — Strict mode (`"strict": true`) — non-negotiable per project rules
- Path alias: `@/` maps to `src/` for all internal imports

**Tailwind config:**
- `tailwind.config.ts` — Extended by shadcn/ui init with CSS variable-based theming

**Supabase config:**
- `supabase/migrations/001_initial_schema.sql` — All table definitions, RLS policies, pgvector index
- Types generated via: `supabase gen types typescript --project-id <id> > src/types/database.ts`

**CI/CD config:**
- `.github/workflows/deploy.yml` — Production deploy: lint → type check → build → `vercel deploy --prod`
- `.github/workflows/preview.yml` — PR preview deploy: same pipeline, `vercel deploy` (no `--prod`)

**Environment variables (planned):**

| Variable | Where Used | Exposure |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + Server | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only (`lib/supabase/admin.ts`) | Server-only — never expose to client |
| `OPENAI_API_KEY` | Edge Functions (embeddings) | Server-only |
| `VAPI_WEBHOOK_SECRET` | Edge Functions (webhook validation) | Server-only |
| `VAPI_API_KEY` | Serverless (outbound campaigns) | Server-only |
| `ENCRYPTION_KEY` | Server (credential AES-256 encryption) | Server-only |

---

## Where to Add New Code

**New dashboard page:**
- Add page at `src/app/(dashboard)/<feature>/page.tsx`
- Add components at `src/components/<feature>/`
- Add API route at `src/app/api/<feature>/route.ts` (Node.js runtime, default)

**New action executor (e.g., new CRM integration):**
- Add executor file at `src/lib/actions/<name>.ts` implementing the `executor.ts` interface
- Register in `src/lib/actions/registry.ts`
- Add integration type to `integrations.provider` column check in the DB
- No changes to the Edge Function tool router needed

**New Vapi webhook handler:**
- Add `route.ts` at `src/app/api/vapi/<event-type>/route.ts`
- Add `export const runtime = 'edge'` as the first export
- Reuse `src/lib/vapi/resolve-org.ts` for tenant resolution
- Use `src/lib/supabase/admin.ts` for DB access

**New database table:**
- Add migration SQL to `supabase/migrations/`
- Add `organization_id UUID NOT NULL REFERENCES organizations(id)` column
- Enable RLS: `ALTER TABLE x ENABLE ROW LEVEL SECURITY`
- Add org isolation policy: `CREATE POLICY "org_isolation" ON x USING (organization_id = get_current_org_id())`
- Regenerate types: `supabase gen types typescript`

**New shadcn/ui component:**
- Run `npx shadcn@latest add <component>`
- Component lands in `src/components/ui/`
- Wrap in a feature-specific component under `src/components/<feature>/` if customization is needed

---

## Special Directories

**`supabase/migrations/`:**
- Purpose: SQL migration files for Supabase
- Generated: No (handwritten SQL)
- Committed: Yes — schema is source of truth

**`src/components/ui/`:**
- Purpose: shadcn/ui base components
- Generated: Via `npx shadcn@latest add`
- Committed: Yes — these are owned source files, not a dependency

**`src/types/database.ts`:**
- Purpose: TypeScript types generated from Supabase schema
- Generated: Via `supabase gen types typescript`
- Committed: Yes — regenerate after every schema migration

**`.github/workflows/`:**
- Purpose: GitHub Actions CI/CD pipeline definitions
- Secrets required: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (set in GitHub repo settings)

---

*Structure analysis: 2026-04-02*
*Status: Pre-implementation planning phase — directory structure is planned, not yet created.*
