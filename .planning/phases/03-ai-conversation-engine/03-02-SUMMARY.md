---
phase: 03-ai-conversation-engine
plan: "02"
subsystem: chat-api
tags: [sse, streaming, llm, openrouter, anthropic, tool-calls, knowledge-base, tdd]

# Dependency graph
requires:
  - phase: 03-ai-conversation-engine
    plan: "01"
    provides: "5 RED streaming tests in tests/chat-api.test.ts — CHAT-01, CHAT-02, CHAT-03, D-12"
  - phase: 02-chat-api
    provides: "POST /api/chat/[token] route with session, persist, and org-auth wired"
provides:
  - "src/lib/chat/stream.ts — createChatStream ReadableStream builder with SSE encoder, OpenRouter + Anthropic streaming paths, KB pre-retrieval, tool call round-trip"
  - "src/app/api/chat/[token]/route.ts — streaming AI endpoint replacing stub; returns text/event-stream with session/token/done events"
affects:
  - widget-integration (Phase 5 chat widget consumes this SSE protocol)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createChatStream pattern: ReadableStream.start() async function with shared controller — caller scope declares accumulatedReply and after() before return"
    - "Thenable mock pattern for Supabase query chains in Vitest: then: (resolve) => resolve(value) instead of vi.fn().mockResolvedValue()"
    - "vi.hoisted() for mock functions referenced inside vi.mock() factory closures"
    - "Class-based SDK mocks: class MockOpenAI / class MockAnthropic to support new SDK(...) constructor calls in tests"

key-files:
  created:
    - src/lib/chat/stream.ts
  modified:
    - src/app/api/chat/[token]/route.ts
    - tests/chat-api.test.ts

key-decisions:
  - "accumulatedReply declared in route scope (not inside ReadableStream.start()) so after() closure captures the correct variable — critical per D-15/D-16"
  - "after() registered in route scope before return — fires after stream is consumed, never inside ReadableStream.start()"
  - "tool_configs fetched with service-role client using IIFE pattern — RLS blocks without user session"
  - "decrypt imported statically at top of route (not dynamic import inside IIFE)"

# Metrics
duration: 12min
completed: 2026-04-04
---

# Phase 3 Plan 02: AI Conversation Engine — Streaming Implementation Summary

Replaced the Phase 2 stub response at step 7 of `src/app/api/chat/[token]/route.ts` with a real streaming AI engine. The route now returns `Content-Type: text/event-stream` backed by a `ReadableStream` that emits newline-delimited JSON events per the D-02 SSE protocol.

## What Was Built

**`src/lib/chat/stream.ts`** (480 lines) — Core streaming module:
- `createChatStream(params)` returns a `ReadableStream` emitting `session`, `token`, `tool_call`, and `done` events
- Always emits `{"event":"session","sessionId":"..."}` as the first line
- **OpenRouter path** (D-11 first preference): OpenAI SDK `stream: true` over `openrouter.ai/api/v1`, model `anthropic/claude-haiku-4-5`; accumulates `tool_calls[0].function.arguments` across chunks; re-calls with tool result on `finish_reason === 'tool_calls'`
- **Anthropic fallback path**: `client.messages.stream()` iterating typed events; `content_block_start tool_use` → emit `tool_call` event; `content_block_stop` → call `executeAction`; re-calls with tool result for final answer
- **KB pre-retrieval** (CHAT-02): `queryKnowledge()` called before any LLM call; result injected into system prompt when not the fallback sentinel string
- **D-12 degradation**: when both provider keys are null, emits a single token with the locked degradation message then done
- `onReplyChunk` callback accumulates assistant reply text in route scope (not inside stream)

**`src/app/api/chat/[token]/route.ts`** — Step 7 replaced:
- Fetches `tool_configs` + `integrations` via service-role client (RLS-safe)
- Decrypts API keys via `decrypt()` for each tool's integration
- Declares `accumulatedReply = ''` in route handler scope
- Registers `after()` in route handler scope before return (not inside ReadableStream)
- Returns `new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })`

## Test Results

All 10 `chat-api.test.ts` tests GREEN. Full Vitest suite: 63 tests pass, 11 files pass.

| Test | Status |
|------|--------|
| 401 invalid token | PASS |
| 401 inactive org | PASS |
| 200 valid token new session (SSE shape) | PASS |
| Reuses sessionId via SSE session event | PASS |
| 400 missing message | PASS |
| CHAT-01: text/event-stream with session+token+done | PASS |
| CHAT-02: queryKnowledge called before LLM | PASS |
| CHAT-03: tool_call event + executeAction called | PASS |
| D-12: degradation path — no keys → token then done | PASS |
| CHAT-01: Cache-Control no-cache | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated `reuses sessionId` test from res.json() to SSE stream reading**
- **Found during:** Task 2
- **Issue:** The test called `res.json()` and expected `body.sessionId`, but the route now returns SSE for all requests (no more JSON response for valid requests)
- **Fix:** Updated test to consume SSE stream via `readSseLines(res)` and check `sessionEvent.sessionId === 'existing-sess'`
- **Files modified:** tests/chat-api.test.ts
- **Commit:** c39097c

**2. [Rule 1 - Bug] Fixed Vitest thenable mock pattern for Supabase query chains**
- **Found during:** Task 2 (tests timing out)
- **Issue:** `then: vi.fn().mockResolvedValue(v)` does not work as an `await` thenable — it returns a Promise when called but never invokes the `onFulfilled` callback that `await` passes to `.then(resolve, reject)`, causing infinite await
- **Fix:** Changed all `tool_configs` and `integrations` query mocks to `then: (resolve) => resolve(value)` — a proper thenable that calls the resolve callback
- **Files modified:** tests/chat-api.test.ts
- **Commit:** c39097c

**3. [Rule 1 - Bug] Used `vi.hoisted()` for `mockOpenAICreate` to avoid vi.mock hoisting issue**
- **Found during:** Task 2 (mock function not initialized inside factory)
- **Issue:** `vi.mock` factories are hoisted to the top of the file before `const mockOpenAICreate = vi.fn()` declaration, so the factory closure captured `undefined`
- **Fix:** Declared `mockOpenAICreate` via `vi.hoisted()` to ensure it's available inside the factory
- **Files modified:** tests/chat-api.test.ts
- **Commit:** c39097c

**4. [Rule 1 - Bug] Replaced `vi.fn().mockImplementation(...)` SDK mocks with class-based mocks**
- **Found during:** Task 2 (OpenAI constructor error in test)
- **Issue:** `stream.ts` uses `new OpenAI(...)` and `new Anthropic(...)` — class constructors. `vi.fn().mockImplementation(() => ...)` is not a valid constructor when called with `new`
- **Fix:** Changed mocks to `class MockOpenAI` and `class MockAnthropic` with properties wired to the test mock functions
- **Files modified:** tests/chat-api.test.ts
- **Commit:** c39097c

**5. [Rule 1 - Bug] Added `readSseLines(res)` to CHAT-02 test to consume stream before asserting**
- **Found during:** Task 2 (queryKnowledge call count = 0)
- **Issue:** `createChatStream.start()` is async — awaiting `POST()` only returns the Response object; the async start function runs concurrently. The assertion `expect(queryKnowledge).toHaveBeenCalled()` ran before the stream executed
- **Fix:** Added `await readSseLines(res)` to consume and drain the stream, ensuring all async logic in `start()` completes before the assertion
- **Files modified:** tests/chat-api.test.ts
- **Commit:** c39097c

## Known Stubs

None. All streaming paths are fully wired:
- OpenRouter path calls real OpenAI SDK (mocked in tests)
- Anthropic path calls real Anthropic SDK (mocked in tests)
- KB pre-retrieval calls real queryKnowledge
- Tool calls invoke real executeAction with decrypted credentials

## Self-Check: PASSED

- FOUND: src/lib/chat/stream.ts
- FOUND: src/app/api/chat/[token]/route.ts (modified)
- FOUND: commit f9a1e73 (feat(03-02): create src/lib/chat/stream.ts)
- FOUND: commit c39097c (feat(03-02): replace stub response with streaming AI engine)
