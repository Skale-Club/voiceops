---
phase: 01-foundation
plan: 03
subsystem: database
tags: [supabase, postgresql, rls, multi-tenant, migrations, typescript]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: project scaffold and test infrastructure

provides:
  - Complete Supabase PostgreSQL schema (organizations, org_members, assistant_mappings)
  - Row Level Security enabled on all 3 tables with get_current_org_id() isolation
  - SECURITY DEFINER helper function for org resolution without JWT claims
  - TypeScript Database interface types matching schema
  - Development seed data for local testing

affects:
  - 01-04 (auth middleware depends on org_members table)
  - 01-05 (organization CRUD routes use organizations + assistant_mappings tables)
  - 01-06 (assistant mappings CRUD uses assistant_mappings table)
  - All subsequent phases (every DB query is scoped by RLS policies defined here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER function for RLS multi-tenancy (get_current_org_id)"
    - "(SELECT ...) wrapper in RLS policy USING/WITH CHECK for per-statement evaluation"
    - "Separate INSERT+UPDATE policies with WITH CHECK for write isolation"
    - "UNIQUE(vapi_assistant_id) constraint for Phase 2 org resolution by assistant"

key-files:
  created:
    - supabase/migrations/001_foundation.sql
    - supabase/seed.sql
    - src/types/database.ts
  modified: []

key-decisions:
  - "get_current_org_id() uses SECURITY DEFINER + SET search_path='' to prevent search path injection and bypass RLS on org_members (prevents circular RLS)"
  - "All RLS policies use (SELECT ...) wrapper so subquery evaluates once per statement, not per row"
  - "INSERT and UPDATE policies require WITH CHECK (not just USING) to enforce org isolation on writes"
  - "vapi_assistant_id UNIQUE constraint is load-bearing for Phase 2 Action Engine webhook routing"
  - "Seed data uses fixed UUID for test org to enable deterministic dev environment setup"

patterns-established:
  - "Pattern: All tenant-scoped tables MUST have ENABLE ROW LEVEL SECURITY + policies using (SELECT public.get_current_org_id())"
  - "Pattern: Any new table with organization_id needs SELECT, INSERT (WITH CHECK), UPDATE (WITH CHECK), DELETE policies"
  - "Pattern: updated_at columns use trigger function public.update_updated_at() via BEFORE UPDATE trigger"

requirements-completed: [TEN-02, AUTH-05]

# Metrics
duration: 3min
completed: 2026-04-02
---

# Phase 1 Plan 03: Database Schema and RLS Foundation Summary

**Multi-tenant PostgreSQL schema with SECURITY DEFINER org isolation — organizations, org_members, assistant_mappings tables with RLS enforced at every read/write operation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-02T21:47:29Z
- **Completed:** 2026-04-02T21:49:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Complete database schema in `001_foundation.sql`: user_role ENUM, 3 tables, 5 indexes, `get_current_org_id()` SECURITY DEFINER helper, 9 RLS policies, `update_updated_at()` trigger on 2 tables
- RLS isolation verified: all 9 policy clauses use `(SELECT public.get_current_org_id())` wrapper (per-statement evaluation, not per-row); INSERT/UPDATE policies have WITH CHECK
- TypeScript `Database` interface in `src/types/database.ts` with Row/Insert/Update shapes for all 3 tables, UserRole type, and Functions type for `get_current_org_id`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 001_foundation.sql** - `dbea01e` (feat)
2. **Task 2: Write seed.sql and update database types** - `5298c03` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified

- `supabase/migrations/001_foundation.sql` - Complete schema: enums, tables, indexes, RLS enable, get_current_org_id() helper, all 9 RLS policies, updated_at triggers
- `supabase/seed.sql` - Development seed: 1 test organization with fixed UUID
- `src/types/database.ts` - TypeScript Database interface with all table shapes, UserRole type, and function types

## Decisions Made

- **get_current_org_id() approach**: Used SECURITY DEFINER + SET search_path='' to read org_members without triggering its own RLS policies (no circular dependency). This is safer than reading org from JWT claims which can be user-modified.
- **(SELECT ...) wrapper**: All RLS policies wrap the function call in a subquery so PostgreSQL evaluates it once per statement rather than once per row — critical for performance on large tables.
- **Seed approach**: Only inserts into public tables (organizations). The auth.users record must be created via Supabase Auth separately — documented in seed.sql comments.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiler not yet installed (expected at this wave); database.ts is a pure type definition file with no imports to resolve.

## User Setup Required

To apply this migration to a Supabase project:
1. Run `npx supabase link --project-ref YOUR_PROJECT_REF`
2. Run `npx supabase db push` to apply the migration
3. Run `npx supabase db seed` or paste seed.sql into the SQL editor
4. Create a user via Supabase Auth, then insert into org_members (see seed.sql comments)

## Next Phase Readiness

- Schema foundation is complete — all subsequent plans can reference these tables
- RLS is correctly established: data isolation is enforced at DB level even before app-level auth is wired
- Plan 01-04 (auth middleware) can proceed: it depends on org_members table which now exists
- Plans 01-05 and 01-06 (org and mapping CRUD) can proceed: tables and TypeScript types are ready

## Self-Check: PASSED

| Item | Status |
|------|--------|
| supabase/migrations/001_foundation.sql | FOUND |
| supabase/seed.sql | FOUND |
| src/types/database.ts | FOUND |
| .planning/phases/01-foundation/01-03-SUMMARY.md | FOUND |
| Commit dbea01e (task 1) | VERIFIED |
| Commit 5298c03 (task 2) | VERIFIED |

---
*Phase: 01-foundation*
*Completed: 2026-04-02*
