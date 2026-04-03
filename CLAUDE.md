# VoiceOps — Claude Code Instructions

## Commands

```bash
npm run dev      # dev server (Turbopack, usually port 3001 if 3000 is taken)
npm run build    # production build + type check
npm run lint     # ESLint
npx supabase db push   # apply pending migrations to remote DB
```

Always run `npm run build` after changes to catch type errors before finishing.

## Architecture

**Stack:** Next.js 15 (App Router) · TypeScript 5 (strict) · Supabase (PostgreSQL + pgvector + Auth) · Tailwind 4 · shadcn/ui

**Runtime split:**
- Node.js — dashboard pages and server actions
- Edge — all `/api/vapi/*` webhook handlers + `src/middleware.ts`
- Deno — `supabase/functions/process-embeddings/` (Supabase Edge Function)

**Multi-tenancy:** Every table has RLS. `get_current_org_id()` (SECURITY DEFINER) resolves the active org. All queries are automatically scoped — never manually filter by org_id in queries that already go through the authenticated client.

## Key Patterns

### Auth (performance-critical)
Always use the cached helpers — never call `supabase.auth.getUser()` directly:

```ts
import { createClient, getUser } from '@/lib/supabase/server'

// In server actions and pages:
const user = await getUser()          // cached — one network call per request total
const supabase = await createClient() // cached — one instance per request total
```

`cache()` from React deduplicates these across the entire render tree per request. Calling `supabase.auth.getUser()` directly bypasses the cache and adds ~150ms per call.

### Server Actions
```ts
'use server'
export async function doThing(input: Input): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  // ... query with RLS auto-scoping
  revalidatePath('/path')
  return {}
}
```

### API Routes (webhooks)
Vapi webhooks always return HTTP 200 — never fail, never throw to caller:
```ts
export const runtime = 'edge'
export async function POST(request: Request) {
  try {
    // ... process
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: true }) // always 200
  }
}
```

### Components
- Server components by default (async, no directive)
- Client components: `'use client'` at top
- Forms: `react-hook-form` + `zod` + `zodResolver`
- Toasts: `sonner` — `toast.success()` / `toast.error()`

## Database

Migrations in `supabase/migrations/`. After adding a migration:
1. `npx supabase db push` to apply to remote
2. Update `src/types/database.ts` manually (or regenerate with `npx supabase gen types`)

**Active org:** Stored in `user_active_org` table + `vo_active_org` cookie. `get_current_org_id()` checks the table first, falls back to first membership. Cookie is set by `switchOrganization()` server action.

## File Structure

```
src/
  app/(auth)/          # login page
  app/(dashboard)/     # protected pages — each folder has page.tsx + actions.ts
  app/api/vapi/        # webhook receivers (Edge runtime)
  app/api/campaigns/   # campaign control API
  components/layout/   # AppSidebar, OrgSwitcher
  components/ui/       # shadcn primitives
  components/[feature]/ # feature components
  lib/action-engine/   # Vapi tool dispatch
  lib/campaigns/       # outbound campaign engine
  lib/ghl/             # GoHighLevel API
  lib/knowledge/       # embeddings + semantic search
  lib/supabase/        # server.ts (cached client+auth), admin.ts (service role)
  lib/crypto.ts        # AES-256-GCM for stored API keys
  types/database.ts    # Supabase schema types (manual)
supabase/
  migrations/          # numbered SQL files (001–007)
  functions/           # Deno edge functions
tests/                 # Vitest tests (17 files, Node env)
```

## Conventions

- **Naming:** PascalCase components, camelCase functions, UPPER_SNAKE_CASE constants, kebab-case files
- **Imports:** Always use `@/` alias — no relative paths like `../../`
- **Type imports:** Use `import type { X }` for type-only imports
- **No `any`:** Use `unknown` with narrowing instead

## Known Stubs (don't implement without asking)

- `send_sms` action type — throws at runtime, UI allows config
- `custom_webhook` action type — same
- Twilio and Cal.com integrations — no test endpoint yet

## Sensitive Paths

- `src/lib/crypto.ts` — AES-256-GCM; don't change encrypt/decrypt format (breaks stored keys)
- `supabase/migrations/` — never edit existing migrations; always add new numbered files
- `src/app/api/vapi/` — 500ms response budget; keep these lean
