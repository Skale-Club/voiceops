---
phase: 03-ai-conversation-engine
plan: "01"
subsystem: testing
tags: [vitest, sse, streaming, readablestream, tdd, red-tests]

# Dependency graph
requires:
  - phase: 02-chat-api
    provides: "POST /api/chat/[token] stub route with session, persist, and org-auth wired"
provides:
  - "tests/helpers/stream.ts — readSseLines() helper for consuming newline-delimited JSON SSE lines from a ReadableStream response"
  - "tests/chat-api.test.ts — updated with 5 RED streaming test cases covering CHAT-01, CHAT-02, CHAT-03, D-12"
affects:
  - 03-02-implementation

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "readSseLines(res) helper pattern — collects all SSE JSON events from a streaming Response body"
    - "Streaming test isolation — error-path tests (401, 400) remain unaffected; streaming tests added in a nested describe block"

key-files:
  created:
    - tests/helpers/stream.ts
  modified:
    - tests/chat-api.test.ts

key-decisions:
  - "RED baseline confirmed: 5 streaming tests fail against stub route (Response.json), 4 error-path tests remain GREEN"
  - "Updated '200 with sessionId' test to assert SSE stream shape instead of res.json() — acceptable failure per plan"
  - "Kept 'reuses sessionId' test unchanged since it still calls res.json() and must pass"

patterns-established:
  - "tests/helpers/stream.ts: shared SSE stream reader for all streaming test files"
  - "Streaming tests grouped in nested describe block to allow beforeEach overrides"

requirements-completed:
  - CHAT-01
  - CHAT-02
  - CHAT-03

# Metrics
duration: 5min
completed: 2026-04-04
---

# Phase 3 Plan 01: AI Conversation Engine — RED Test Baseline Summary

**Vitest SSE stream reader helper + 5 RED failing test cases establishing the streaming contract for CHAT-01/02/03 and D-12 before any implementation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-04T15:27:39Z
- **Completed:** 2026-04-04T15:33:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `tests/helpers/stream.ts` with `readSseLines()` — reads newline-delimited JSON from a `ReadableStream` Response body
- Updated `tests/chat-api.test.ts` with 3 new mocks (`queryKnowledge`, `executeAction`, `getProviderKey`) and 5 streaming RED test cases
- Confirmed RED baseline: all 5 streaming tests fail against stub route; all 4 error-path tests remain GREEN
- Build (`npm run build`) passes with zero type errors after changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tests/helpers/stream.ts — SSE line reader** - `7928509` (test)
2. **Task 2: Update tests/chat-api.test.ts — replace stub assertions, add streaming RED tests** - `4ff9016` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `tests/helpers/stream.ts` - New helper — `readSseLines(res: Response)` collects all newline-delimited JSON events from a streaming response body
- `tests/chat-api.test.ts` - Updated — added 3 mocks, updated "200 with sessionId" test for SSE shape, added 5 streaming test cases

## Decisions Made
- Kept `reuses sessionId` test calling `res.json()` unchanged — plan explicitly required this to remain passing
- The "200 with sessionId" test was updated to expect SSE streaming shape, making it RED as expected (plan specifies "may FAIL" is acceptable)
- All 5 new streaming tests are RED as required — confirms the RED baseline is established

## Deviations from Plan

None - plan executed exactly as written. The merge from main to bring in Phase 2 code was required because the worktree was behind, but this was infrastructure setup, not a deviation from task scope.

## Issues Encountered
- Worktree branch was behind `main` and missing Phase 2 implementation files (`src/app/api/chat/[token]/route.ts`, `tests/chat-api.test.ts`, etc.). Resolved by merging `main` into the worktree branch before executing tasks.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RED baseline established — Plan 03-02 can now implement the streaming AI engine to make these tests GREEN
- `tests/helpers/stream.ts` is available as a shared import for any future streaming test files
- The 4 error-path tests serve as regression guards during 03-02 implementation

---
*Phase: 03-ai-conversation-engine*
*Completed: 2026-04-04*
