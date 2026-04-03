# AGENTS.md

This file is for AI coding agents and automation working inside the VoiceOps repository. Read this before making changes.

## Mission

VoiceOps is a multi-tenant operations platform for Vapi-based voice AI deployments. The most important invariant in the system is the Action Engine path:

- receive a Vapi tool call
- resolve the right organization
- execute the configured action
- return a safe response quickly enough for a live call

If you are unsure how to prioritize a change, protect that path first.

## Read First

Before making non-trivial changes, ground yourself in these files:

1. [`README.md`](/c:/Users/Vanildo/Dev/voiceops/README.md)
2. [`CLAUDE.md`](/c:/Users/Vanildo/Dev/voiceops/CLAUDE.md)
3. [`PROJECT.md`](/c:/Users/Vanildo/Dev/voiceops/.planning/PROJECT.md)
4. [`STATE.md`](/c:/Users/Vanildo/Dev/voiceops/.planning/STATE.md)
5. Relevant phase or milestone artifacts in [`.planning/milestones`](/c:/Users/Vanildo/Dev/voiceops/.planning/milestones)

## Repo Facts

- Framework: Next.js 15 App Router
- Language: TypeScript strict mode
- UI: Tailwind CSS 4 plus shadcn/ui
- Data layer: Supabase Postgres with RLS and pgvector
- Tests: Vitest
- Current planning status: `v1.0` milestone complete as of `2026-04-03`

## Non-Negotiable Rules

### 1. Respect runtime boundaries

- `src/app/api/vapi/*` runs on the Edge Runtime.
- `src/middleware.ts` runs on the Edge Runtime.
- `supabase/functions/process-embeddings/` runs on Deno.
- Do not introduce Node-only APIs into code shared by those paths.

### 2. The Vapi webhook contract must stay stable

For Vapi-facing routes:

- keep responses lean
- do not block on non-essential work
- preserve the "always return HTTP 200" behavior unless product requirements explicitly change
- prefer deferred side effects with the established async pattern

Start with [`src/app/api/vapi/tools/route.ts`](/c:/Users/Vanildo/Dev/voiceops/src/app/api/vapi/tools/route.ts) when reasoning about this area.

### 3. Multi-tenancy is enforced with RLS first

- Assume tenant isolation should happen through Supabase RLS and org context, not ad hoc filtering
- `get_current_org_id()` is the central org-resolution primitive
- avoid introducing code that bypasses tenant scoping for authenticated user flows
- service-role clients are only for explicit bootstrap, webhook, or privileged paths

### 4. Use the cached auth helpers

For server components and server actions, use helpers from [`src/lib/supabase/server.ts`](/c:/Users/Vanildo/Dev/voiceops/src/lib/supabase/server.ts):

- `createClient()`
- `getUser()`

Do not scatter direct `supabase.auth.getUser()` calls if the cached helper already covers the case.

### 5. Treat credential handling as sensitive

- integration secrets are encrypted with AES-256-GCM
- do not log plaintext API keys
- do not change encryption storage format casually
- do not move secret storage back to plain env vars for tenant-managed providers

See [`src/lib/crypto.ts`](/c:/Users/Vanildo/Dev/voiceops/src/lib/crypto.ts).

### 6. Never rewrite migration history

- existing files in [`supabase/migrations`](/c:/Users/Vanildo/Dev/voiceops/supabase/migrations) are append-only
- add a new numbered migration for schema changes
- if schema changes affect TypeScript types, update [`src/types/database.ts`](/c:/Users/Vanildo/Dev/voiceops/src/types/database.ts)

## Working Style Expectations

- Prefer small, surgical changes over broad refactors unless the task truly needs one.
- Preserve established patterns before inventing new ones.
- Keep imports on the `@/` alias path.
- Use server components by default unless interactivity requires a client component.
- When touching user flows, match the existing admin-panel tone and structure.

## Planning Folder Expectations

The `.planning` directory is part of the project source of truth, not background clutter.

Use it to answer:

- what the product is trying to do: [`PROJECT.md`](/c:/Users/Vanildo/Dev/voiceops/.planning/PROJECT.md)
- what has already shipped: [`MILESTONES.md`](/c:/Users/Vanildo/Dev/voiceops/.planning/MILESTONES.md)
- what the current state and next priorities are: [`STATE.md`](/c:/Users/Vanildo/Dev/voiceops/.planning/STATE.md)
- how a feature was originally implemented: phase archives in [`.planning/milestones/v1.0-phases`](/c:/Users/Vanildo/Dev/voiceops/.planning/milestones/v1.0-phases)

When a code change materially alters product behavior, architecture, or milestone status, update the relevant planning docs as part of the same task when appropriate.

## Recommended Workflow

1. Inspect the relevant feature area and tests.
2. Check `.planning` for intent, constraints, or known gaps.
3. Make the smallest change that solves the problem cleanly.
4. Run verification proportional to the change.
5. Call out any residual risk, especially around Edge latency, RLS, or secrets.

## Verification

Preferred checks:

```bash
npm run build
npx vitest
```

Use narrower test selection when the change is localized, but favor `npm run build` before finishing any non-trivial task.

## Areas To Be Extra Careful With

- [`src/app/api/vapi/tools/route.ts`](/c:/Users/Vanildo/Dev/voiceops/src/app/api/vapi/tools/route.ts): latency-sensitive live-call path
- [`src/middleware.ts`](/c:/Users/Vanildo/Dev/voiceops/src/middleware.ts): auth gating
- [`src/lib/crypto.ts`](/c:/Users/Vanildo/Dev/voiceops/src/lib/crypto.ts): encryption format compatibility
- [`src/lib/supabase/server.ts`](/c:/Users/Vanildo/Dev/voiceops/src/lib/supabase/server.ts): cached auth and client creation
- [`src/app/(dashboard)/outbound/actions.ts`](/c:/Users/Vanildo/Dev/voiceops/src/app/(dashboard)/outbound/actions.ts): service-role and campaign control paths
- [`supabase/migrations`](/c:/Users/Vanildo/Dev/voiceops/supabase/migrations): schema history

## Known Product Gaps

These are already acknowledged in planning and should not be mistaken for accidental omissions:

- webhook HMAC or secret validation is still pending
- `send_sms` executor is not implemented
- `custom_webhook` executor is not implemented
- campaign calls are not fully wired into observability yet

You can fix these if asked, but do not "quietly complete" them as incidental cleanup.

## Local Commands

```bash
npm run dev
npm run build
npm run lint
npx vitest
npx supabase db push
```

## Final Reminder

Optimize for correctness, tenant safety, and operational clarity. In this repo, a small safe change that preserves the Action Engine contract is better than a clever change that adds latency, weakens RLS assumptions, or muddies the planning trail.
