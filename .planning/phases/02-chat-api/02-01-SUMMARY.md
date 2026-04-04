---
phase: "02-chat-api"
plan: "01"
subsystem: "chat-api"
tags: [migration, tdd, database, types, testing]
dependency_graph:
  requires: []
  provides: [widget_token-on-organizations, session_key-on-chat_sessions, RED-test-scaffolds]
  affects: [02-02-helpers, 02-03-route]
tech_stack:
  added: []
  patterns: [TDD-RED, Supabase-migration, TypeScript-types-manual-update]
key_files:
  created:
    - supabase/migrations/012_org_widget_token.sql
    - tests/chat-api.test.ts
    - tests/chat-session.test.ts
    - tests/chat-persist.test.ts
  modified:
    - src/types/database.ts
decisions:
  - "widget_token backfilled with gen_random_uuid() without pgcrypto extension dependency"
  - "session_key is nullable (TEXT UNIQUE) — populated by Wave 1 when session is created"
  - "Test scaffolds fail on ERR_MODULE_NOT_FOUND, not syntax errors — correct RED state"
metrics:
  duration_seconds: 242
  completed_date: "2026-04-04"
  tasks_completed: 2
  files_created: 5
  files_modified: 1
---

# Phase 02 Plan 01: Wave 0 Foundation — Migration 012 + RED Test Scaffolds Summary

Migration 012 applied to remote Supabase adding `widget_token` to `organizations` and `session_key` to `chat_sessions`; three RED test scaffolds committed failing on missing module imports, ready for Wave 1 implementation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration 012 + TypeScript types | 79f4908 | supabase/migrations/012_org_widget_token.sql, src/types/database.ts |
| 2 | RED test scaffolds | c60ed12 | tests/chat-session.test.ts, tests/chat-persist.test.ts, tests/chat-api.test.ts |

## What Was Built

**Migration 012** (`supabase/migrations/012_org_widget_token.sql`):
- `organizations.widget_token TEXT UNIQUE NOT NULL` with btree index — backfilled via `gen_random_uuid()` before adding NOT NULL constraint
- `chat_sessions.session_key TEXT UNIQUE` (nullable) with btree index — populated when session is first created in Wave 1

**TypeScript types** (`src/types/database.ts`):
- `organizations` Row/Insert/Update: added `widget_token: string` / `widget_token?: string`
- `chat_sessions` Row/Insert/Update: added `session_key: string | null` / `session_key?: string | null`

**RED test scaffolds** (3 files):
- `tests/chat-session.test.ts` — covers CHAT-04: `getSession`/`setSession` with mocked Redis singleton
- `tests/chat-persist.test.ts` — covers CHAT-05: `ensureDbSession`/`persistMessage` with mocked `createServiceRoleClient`
- `tests/chat-api.test.ts` — covers INFRA-03 + CHAT-06: token validation (valid/invalid/inactive org), session ID generation and reuse, 400 for missing message

## Decisions Made

1. **widget_token backfill strategy**: Used `gen_random_uuid()` (built-in Supabase) instead of pgcrypto to avoid extension dependency — produces a 32-char hex string via `replace(..., '-', '')`.
2. **session_key is nullable**: Column added as nullable so existing rows don't need backfill — Wave 1's `ensureDbSession` populates it on session creation.
3. **RED state confirmed**: All three test files fail with `ERR_MODULE_NOT_FOUND` for `@/lib/chat/session`, `@/lib/chat/persist`, and `@/app/api/chat/[token]/route` — correct failure mode, not syntax errors.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan is foundation-only (migration + types + failing tests). No UI or data flow components.

## Self-Check: PASSED

- [x] `supabase/migrations/012_org_widget_token.sql` exists
- [x] `widget_token` in database.ts: 6 matches (Row x2, Insert x2, Update x2 across organizations + chat_sessions)
- [x] `session_key` in database.ts: 3 matches (Row, Insert, Update on chat_sessions)
- [x] Tests fail with ERR_MODULE_NOT_FOUND (RED confirmed)
- [x] `npm run build` exits 0
- [x] Commits 79f4908 and c60ed12 exist
