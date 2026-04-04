---
phase: "02-chat-api"
plan: "03"
subsystem: "chat-api"
tags: [tdd, redis, supabase, next-api-route, session, zod, widget-token]
dependency_graph:
  requires:
    - phase: 02-02
      provides: "getSession/setSession Redis helpers and ensureDbSession/persistMessage Supabase helpers"
  provides: [public-chat-post-endpoint, POST /api/chat/[token]]
  affects: [03-chat-ai-phase]
tech_stack:
  added: []
  patterns: [TDD-GREEN, Next15-async-params, after()-fire-and-forget, service-role-for-public-routes]
key_files:
  created:
    - src/app/api/chat/[token]/route.ts
  modified: []
key_decisions:
  - "Validation occurs before token lookup — Zod 400 before DB query prevents unnecessary DB calls"
  - "after() used for persistMessage so DB writes do not block the HTTP response to the widget"
  - "ensureDbSession is awaited synchronously — DB session row must exist before response so Phase 3 can load history"
  - "Redis miss on follow-up session treated as new session (create new UUID) per research recommendation"

patterns-established:
  - "Public chat route returns 401 for bad tokens (vs Vapi routes that always return 200)"
  - "Prerequisite commits cherry-picked from parallel worktree when branch diverged from phase work"

requirements-completed: [INFRA-03, CHAT-04, CHAT-05, CHAT-06]

duration: "15min"
completed: "2026-04-04"
---

# Phase 02 Plan 03: Chat API Route Handler Summary

Public POST /api/chat/[token] route wired together with token validation, Redis session management, and non-blocking Supabase persistence; all 14 Phase 2 tests GREEN and build clean.

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-04T08:50:00Z
- **Completed:** 2026-04-04T09:05:00Z
- **Tasks:** 1
- **Files modified:** 1 created + 13 prerequisite files brought forward from parallel worktree

## Accomplishments

- Implemented `src/app/api/chat/[token]/route.ts` — public POST handler for the Leaidear embedded chat widget
- All 5 chat-api tests pass: 401 invalid token, 401 inactive org, 200 new session, 200 sessionId reuse, 400 missing message
- All 14 Phase 2 tests GREEN (chat-api 5/5, chat-session 5/5, chat-persist 4/4)
- `npm run build` exits 0; `/api/chat/[token]` route appears in build manifest

## Task Commits

1. **Task 1: Implement POST /api/chat/[token]/route.ts** - `0d906ce` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `src/app/api/chat/[token]/route.ts` — Public chat POST handler: token validation, Zod body parsing, Redis session management, after() persistence, stub reply
- `src/lib/chat/session.ts` — Redis helpers (cherry-picked from 02-02)
- `src/lib/chat/persist.ts` — Supabase persistence helpers (cherry-picked from 02-02)
- `src/lib/redis.ts` — Redis singleton client (cherry-picked from 01-03)
- `supabase/migrations/011_chat_schema.sql` — chat_sessions + chat_messages tables (cherry-picked from 01-04)
- `supabase/migrations/012_org_widget_token.sql` — widget_token on organizations, session_key on chat_sessions (cherry-picked from 02-01)
- `src/types/database.ts` — Extended with chat types and widget_token field
- `tests/chat-api.test.ts` — 5 RED-turned-GREEN tests for the route
- `tests/chat-session.test.ts` — 5 tests for Redis session helpers
- `tests/chat-persist.test.ts` — 4 tests for Supabase persistence helpers

## Decisions Made

1. **Validation before token lookup**: Zod parsing runs before the Supabase org query so malformed requests get 400 immediately without a DB round-trip.
2. **after() for persistMessage**: User message persistence is non-blocking. The widget receives the response without waiting for the Supabase write.
3. **ensureDbSession awaited synchronously**: The DB session row is created before the response is returned so Phase 3 can reliably load conversation history via the session_key.
4. **Redis miss = new session**: If a follow-up request provides a sessionId but Redis returns null (TTL expired or Redis restart), a fresh session is created rather than returning an error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cherry-picked prerequisite commits from parallel worktree**
- **Found during:** Pre-task setup
- **Issue:** This worktree (branch `worktree-agent-a71a080e`) branched from `main` before Phase 2 work. The prerequisite files from plans 02-01 and 02-02 (migrations, types, helpers, redis client, test scaffolds) were absent.
- **Fix:** Identified 8 code-only commits from the parallel worktree (commits 37cab04 through 5d2ea28) and cherry-picked them using `--no-commit`, then committed all together with the route file.
- **Files modified:** 13 files brought forward as listed above
- **Verification:** All 14 tests pass, build clean
- **Committed in:** 0d906ce

---

**Total deviations:** 1 auto-fixed (1 blocking — missing prerequisites in worktree)
**Impact on plan:** Necessary to unblock task execution. No scope creep.

## Issues Encountered

None beyond the prerequisite cherry-pick handled above.

## Known Stubs

**1. Reply message** — `src/app/api/chat/[token]/route.ts` line ~97: `reply: 'Message received.'`
- **Reason:** Intentional per plan. Phase 3 (Chat AI) will replace this with a streaming AI response.
- **Resolves in:** Phase 3 Chat AI plan

## Next Phase Readiness

- Phase 2 is complete. POST /api/chat/[token] is live and fully functional.
- Phase 3 (Chat AI) can import the route file and replace the stub reply with a streaming LLM response without changing the route's structure.
- Redis session context (with `messages` array) is already maintained — Phase 3 will read `ctx.messages` for conversation history.
- All 4 Phase 2 requirements satisfied: INFRA-03 (token endpoint), CHAT-04 (Redis sessions), CHAT-05 (DB persistence), CHAT-06 (sessionId lifecycle).

## Self-Check

- [x] `src/app/api/chat/[token]/route.ts` exists
- [x] `grep "export const runtime = 'nodejs'" src/app/api/chat/[token]/route.ts` matches
- [x] `grep "await params" src/app/api/chat/[token]/route.ts` matches
- [x] `grep "after(" src/app/api/chat/[token]/route.ts` matches
- [x] `grep "Message received" src/app/api/chat/[token]/route.ts` matches
- [x] All 14 tests GREEN
- [x] `npm run build` exits 0
- [x] Commit 0d906ce exists

## Self-Check: PASSED

---
*Phase: 02-chat-api*
*Completed: 2026-04-04*
