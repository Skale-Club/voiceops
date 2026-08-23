# Xphere - Claude Code Instructions

## Commands

```bash
npm run dev      # dev server (Turbopack on port 4267)
npm run build    # production build + type check
npm run lint     # ESLint
npx supabase db push   # apply pending migrations to remote DB
```

Always run `npm run build` after changes to catch type errors before finishing.

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript 5 (strict) · Supabase (PostgreSQL + pgvector + Auth) · Tailwind 4 · shadcn/ui

**Runtime split:**
- Node.js - dashboard pages, server actions, and all webhook receivers (`/api/vapi/*`, `/api/meta/`, `/api/manychat/`, etc.)
- Deno - `supabase/functions/process-embeddings/` (Supabase Edge Function)
- GitHub Actions - auxiliary scheduled automation such as Supabase keepalive

**Product framing:** Xphere is a tenant-aware integration and orchestration platform. Client workflows can differ significantly, so prefer reusable platform capabilities over hardcoding one client's playbook as product-wide behavior.

**Canonical production origin:** `https://xphere.app`. Use this host for first-party webhook construction and documentation examples unless an updated production host is explicitly documented.

**Multi-tenancy:** Every table has RLS. `get_current_org_id()` (SECURITY DEFINER) resolves the active org. All queries are automatically scoped - never manually filter by `org_id` in queries that already go through the authenticated client.

## Key Patterns

### Auth
Always use the cached helpers - never call `supabase.auth.getUser()` directly:

```ts
import { createClient, getUser } from '@/lib/supabase/server'

const user = await getUser()
const supabase = await createClient()
```

`cache()` deduplicates these across the render tree per request. Auth gating happens in layouts, pages, route handlers, and server actions instead of middleware.

### API Routes

**Inbound webhooks** (Vapi, Meta, ManyChat, etc.) always return HTTP 200:

```ts
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: true })
  }
}
```

Production webhook endpoints:

- `https://xphere.app/api/vapi/tools`
- `https://xphere.app/api/vapi/calls`
- `https://xphere.app/api/vapi/campaigns`

**Public REST API** (`/api/v1/`) uses Bearer token auth via the `api_keys` table — different pattern from webhooks:

```ts
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.slice(7)
  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()
  if (!apiKey) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // ... process with apiKey.org_id
}
```

- Tokens: `xph_<64 hex>` — SHA-256 hash stored, plaintext never persisted
- Managed via `Settings → API Keys` UI
- Returns proper HTTP status codes (201/200/401/422) — NOT always-200 like webhooks
- CORS headers included — external sites call this cross-origin
- Full reference: `docs/api/public-api.md`

### Components
- Server components by default
- Client components use `'use client'`
- Forms use `react-hook-form` + `zod` + `zodResolver`
- Toasts use `sonner`

## Database

Migrations live in `supabase/migrations/` as numbered SQL files (`1281_short_name.sql`).

### `db push` is the only way to apply a migration

**Never apply schema changes with the Supabase MCP `apply_migration` tool or the
dashboard SQL editor.** Both write to production without leaving a file in this
repo, and `apply_migration` additionally records its own generated timestamp
version (`20260815021606`) in `supabase_migrations.schema_migrations`. Because
that version has no counterpart in `supabase/migrations/`, the next
`supabase db push` aborts with *"Remote migration versions not found in local
migrations directory"* — the whole team is then blocked from shipping schema
until someone reconciles the history table by hand.

To add a migration:

1. Write `supabase/migrations/<next-number>_<short_name>.sql`. Make it
   idempotent (`IF NOT EXISTS`, `DROP … IF EXISTS` before `CREATE`) so a re-run
   is a no-op.
2. `npx supabase db push`
3. Update `src/types/database.ts` manually or regenerate it
4. Commit the migration file in the same PR as the code that depends on it

`supabase db push` is the only path that keeps three things in agreement: the
files in this repo, the remote history table, and what a fresh
`supabase db reset` reproduces. The MCP tool keeps only the third.

**Read-only MCP/SQL-editor queries are fine** — inspecting the live schema,
checking data, running `SELECT`. The rule is about DDL.

### If the history table drifts anyway

`npx supabase migration list --linked` shows Local vs Remote. Before repairing,
verify against the live schema whether each migration's objects actually exist —
never trust the recorded `name`, which has drifted from the file numbering
before (a row named `1266_event_types_look_busy` was really file `1267`).

- Applied but unrecorded → `npx supabase migration repair --linked --status applied <version>`
- Recorded but no local file → recover the DDL from the live schema into a new
  numbered file and mark that applied; only use `--status reverted` once nothing
  is left to preserve, since it deletes the row outright.

Back up `supabase_migrations.schema_migrations` before any repair pass.

A migration whose effects were later undone by a *subsequent* migration (1267
added `event_types.look_busy_*`; 1268 dropped them) is still **applied** — its
DDL ran. Marking it `reverted` would make `db push` re-run it and reintroduce
what 1268 deliberately removed.

**Active org:** Stored in `user_active_org` plus the `vo_active_org` cookie. `get_current_org_id()` prefers the explicit selection and falls back to the first membership.

## File Structure

```text
src/
  app/(auth)/          login page
  app/(dashboard)/     protected pages
  app/api/v1/          public REST API (Bearer token auth via api_keys table)
    contacts/          POST /api/v1/contacts — upsert contact from external source
  app/api/vapi/        webhook receivers (Node.js runtime)
  app/api/campaigns/   campaign control API
  components/layout/   AppSidebar, OrgSwitcher
  components/ui/       shadcn primitives
  lib/action-engine/   Action dispatch engine (webhook → action routing)
  lib/campaigns/       outbound campaign engine
  lib/ghl/             GoHighLevel API
  lib/knowledge/       embeddings + semantic search
  lib/supabase/        cached auth + server clients
  lib/crypto.ts        AES-256-GCM for stored API keys
  types/database.ts    Supabase schema types
supabase/
  migrations/          numbered SQL files
  functions/           Deno edge functions
docs/
  api/public-api.md    Full public API reference for integrators
tests/                 Vitest tests
```

## Workflows

The platform has a **single unified workflow system** (SEED-025). There is no separate "Automations" — that name was retired. Everything callable, scheduled, or event-driven is a Workflow with `kind='tool'` (single action invokable by name) or `kind='flow'` (multi-node DAG).

When you need to author a workflow (manually, via Copilot, or from a Claude Code agent):

1. Read `WORKFLOWS.md` at the repo root — the authoring contract
2. Read `.planning/agents/workflow-authoring.md` for decision tree + checklist
3. Browse `.planning/workflows/examples/` for canonical patterns to copy
4. Workflow files are declarative YAML; `npm run workflows:validate <file>` runs the full validator with structured errors
5. Platform-default workflows live in `supabase/seeds/workflows/` (validated in CI)
6. The org-filtered capability spec is at `GET /api/workflows/spec` (auth required)

**Key principle:** the validator is the contract. Integrations that aren't connected for the org never appear in the spec — AI cannot generate workflows referencing them. Variables that aren't in scope at a node produce structured errors with `suggestion` fields engineered for LLM self-correction.

## Deployment

- **GitHub Actions builds the image; self-hosted Coolify only runs it.** The
  Docker image is built on GitHub runners from the `Dockerfile` (standalone
  output) and pushed to GHCR — Coolify pulls that prebuilt image and rolls it
  out. Production: `xphere.app`, on a Hetzner box (shared Docker host).
  Coolify app `xphere-zdt`, uuid `fwjo7xriuqibl01v96vah7fz` — a **Docker Image**
  resource (rolling update, zero-downtime) tracking
  `ghcr.io/skale-club/xphere:latest`; serves `xphere.app`, `www.xphere.app`,
  `xphere-stage.skale.club`. (Superseded the old app
  `c70jg4t9o88x985dctsl57qy` during the 2026-06-10 migration; the build moved
  off the VPS because the 8GB CX32 OOM-thrashes on `next build`.)
- **Auto-deploy:** every push to `main` runs `.github/workflows/build-deploy.yml`
  ("Build and Deploy", job `build-and-deploy`): Checkout → Set up Docker Buildx →
  Log in to GHCR → **Build image and push to GHCR** (tags `:latest` and
  `:<sha>`, GHA layer cache, `NEXT_PUBLIC_*` passed as build args) → **Trigger
  Coolify deploy** via `POST /api/v1/deploy?uuid=…`. Coolify then pulls
  `:latest`, starts the new container, waits for `/api/health`, and swaps
  traffic. Because the build now happens in CI, a run takes **~8 minutes** end
  to end (measured 7m44s-9m39s over the last seven successful runs) — not the
  few seconds the old trigger-only workflow took. `deploy.yml`
  no longer exists (removed to stop a double Coolify trigger); `concurrency:
  build-deploy` with `cancel-in-progress` means a newer push cancels an
  in-flight build. Requires repo secret `COOLIFY_TOKEN` — if it is missing the
  job still builds and pushes to GHCR and only warns on the deploy step, so a
  rotated token shows up as "image updated, site unchanged". Don't also enable
  Coolify's UI "Automatic Deployment" or pushes will deploy twice.
- **Manual-dispatch ops workflows** (never run on push):
  `coolify-set-envs.yml` upserts runtime env vars from GitHub Secrets into the
  Coolify app and redeploys — runtime env is *not* managed by `build-deploy.yml`,
  which only passes `NEXT_PUBLIC_*` build args. `coolify-zero-downtime.yml`
  enables the Coolify health check on `/api/health`; note it still targets the
  superseded uuid `c70jg4t9o88x985dctsl57qy`.
- Supabase handles background Edge Functions and database-backed jobs
- Other GitHub Actions are low-risk scheduled automation (cron-tick, keepalive,
  etc.) — domain-stable.

## Sensitive Paths

- `src/lib/crypto.ts` - do not change the encryption format
- `supabase/migrations/` - never edit old migrations; add new ones
- `src/app/api/vapi/` - keep webhook handlers fast and Node.js-compatible
