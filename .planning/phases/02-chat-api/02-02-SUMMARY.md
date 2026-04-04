---
phase: "02-chat-api"
plan: "02"
subsystem: "chat-api"
tags: [tdd, redis, supabase, helpers, session]
dependency_graph:
  requires: [02-01]
  provides: [chat-session-helpers, chat-persist-helpers]
  affects: [02-03-route]
tech_stack:
  added: []
  patterns: [TDD-GREEN, Redis-session-cache, Supabase-service-role, graceful-degradation]
key_files:
  created:
    - src/lib/chat/session.ts
    - src/lib/chat/persist.ts
  modified:
    - tests/chat-session.test.ts
decisions:
  - "Used vi.hoisted() to fix vi.mock hoisting issue in chat-session test scaffold — variables referenced in mock factory must be created via vi.hoisted()"
  - "session.ts checks redis.isReady before every Redis call — graceful degradation if Redis unavailable"
  - "persist.ts always uses createServiceRoleClient() — no auth session on the public chat API route"
  - "session_key stores the client-facing sessionId for Phase 3 history reload"
metrics:
  duration_seconds: 300
  completed_date: "2026-04-04"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 02 Plan 02: Wave 1 Helper Modules — session.ts + persist.ts Summary

Redis session helpers and Supabase persistence helpers implemented and all 9 chat-session + chat-persist tests turned GREEN; test scaffold vi.mock hoisting bug auto-fixed using vi.hoisted().

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement src/lib/chat/session.ts (Redis helpers) | 66903aa | src/lib/chat/session.ts, tests/chat-session.test.ts |
| 2 | Implement src/lib/chat/persist.ts (Supabase helpers) | 5d2ea28 | src/lib/chat/persist.ts |

## What Was Built

**`src/lib/chat/session.ts`**:
- `ChatSessionContext` interface: orgId, sessionId, dbSessionId, messages array, createdAt, lastActiveAt
- `getSession(sessionId)`: reads Redis key `chat:session:{id}`, parses JSON, returns null on miss/unavailability/parse error
- `setSession(sessionId, ctx)`: writes context with 3600s sliding TTL via `redis.setEx`; no-op if `redis.isReady` is false
- Both functions check `redis.isReady` first — graceful degradation per D-07

**`src/lib/chat/persist.ts`**:
- `ensureDbSession(opts)`: inserts `chat_sessions` row with organization_id, widget_token, session_key; returns the new UUID
- `persistMessage(opts)`: inserts `chat_messages` row with session_id, organization_id, role, content
- Both use `createServiceRoleClient()` — bypasses RLS for the public unauthenticated chat route

## Decisions Made

1. **vi.hoisted() fix**: The test scaffold used `const mockRedis = ...` before `vi.mock(...)`, but vitest hoists `vi.mock` above variable declarations. Fixed by wrapping mock objects in `vi.hoisted()` callback — required for vitest 4.x.
2. **graceful Redis degradation**: `isReady` checked before every operation so the app doesn't crash if Redis is down or not configured.
3. **service-role for persist**: The public chat route has no authenticated session, so service-role client is mandatory for writes.
4. **session_key stores sessionId**: The client-facing UUID is stored in `chat_sessions.session_key` so Phase 3 can reload conversation history by token + session ID.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vi.mock hoisting in chat-session test scaffold**
- **Found during:** Task 1 (RED → GREEN phase)
- **Issue:** `tests/chat-session.test.ts` defined `mockRedis` as a regular const before `vi.mock(...)`. vitest 4.x hoists `vi.mock` to the top of the file, causing `ReferenceError: Cannot access 'mockRedis' before initialization`
- **Fix:** Rewrote variable declarations inside `vi.hoisted(() => { ... })` so they are available when the mock factory runs
- **Files modified:** `tests/chat-session.test.ts`
- **Commit:** 66903aa

## Known Stubs

None — both helper modules are fully implemented with real logic. No placeholder values.

## Self-Check: PASSED

- [x] `src/lib/chat/session.ts` exists
- [x] `src/lib/chat/persist.ts` exists
- [x] `tests/chat-session.test.ts` modified (vi.hoisted fix)
- [x] `grep "chat:session:" src/lib/chat/session.ts` matches
- [x] `grep "3600" src/lib/chat/session.ts` matches
- [x] `grep "isReady" src/lib/chat/session.ts` matches (2 occurrences)
- [x] `grep "session_key" src/lib/chat/persist.ts` matches
- [x] `grep "createServiceRoleClient" src/lib/chat/persist.ts` matches
- [x] `grep "chat_messages" src/lib/chat/persist.ts` matches
- [x] Commits 66903aa and 5d2ea28 exist
- [x] All 9 tests GREEN (chat-session: 5/5, chat-persist: 4/4)
- [x] `npm run build` exits 0
