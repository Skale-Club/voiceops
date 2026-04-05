---
phase: "06-chat-inbox"
plan: "02"
subsystem: chat-api
tags: [api, chat-inbox, typescript, supabase, cursor-pagination]
dependency_graph:
  requires: [06-01]
  provides: [chat-conversations-api, chat-messages-api, chat-settings-api]
  affects: [06-03-frontend]
tech_stack:
  added: []
  patterns: [nodejs-route-handler, cursor-pagination, zod-validation, rls-org-scoped]
key_files:
  created:
    - src/types/chat.ts
    - src/app/api/chat/conversations/route.ts
    - src/app/api/chat/conversations/[id]/route.ts
    - src/app/api/chat/conversations/[id]/messages/route.ts
    - src/app/api/chat/conversations/[id]/status/route.ts
    - src/app/api/chat/settings/route.ts
  modified: []
decisions:
  - Use cursor-based pagination via `before` (UUID) param resolved to `created_at` for message history; fetch limit+1 to determine hasMore
  - Admin message POST enforces role='assistant' via zod literal to prevent role spoofing
  - Status endpoint uses z.enum(['open','closed']) for strict validation
  - POST /messages updates parent conversation last_message/last_message_at/updated_at inline after insert
  - settings endpoint calls get_current_org_id() RPC explicitly for org-scoped widget config lookup
metrics:
  duration: "20m"
  completed_date: "2026-04-05"
  tasks_completed: 3
  files_modified: 6
---

# Phase 06 Plan 02: Chat Inbox API Endpoints Summary

**One-liner:** Six route handler files provide auth-gated CRUD for conversations, cursor-paginated message history, status transitions, and widget settings using org-scoped Supabase queries.

## What Was Built

1. `src/types/chat.ts` — Two exported TypeScript interfaces:
   - `ConversationSummary`: id, status, timestamps, optional visitor fields, lastMessage
   - `ConversationMessage`: id, conversationId, role, content, createdAt, optional metadata

2. `GET /api/chat/conversations` — Lists all conversations for active org ordered by `last_message_at DESC, created_at DESC`. RLS handles org isolation automatically.

3. `GET /api/chat/conversations/[id]` — Single conversation detail, 404 if not found.

4. `DELETE /api/chat/conversations/[id]` — Hard delete; DB ON DELETE CASCADE removes child messages.

5. `GET /api/chat/conversations/[id]/messages` — Cursor-based paginated message history:
   - `before=<uuid>` resolves to `created_at` of anchor message, returns messages older than it
   - `limit` defaults to 50, capped at 200; returns one extra to set `hasMore`
   - `includeInternal=true` opt-in; otherwise filters `metadata->>'internal' = 'true'` messages
   - Results returned in ascending chronological order (reversed from DESC fetch)

6. `POST /api/chat/conversations/[id]/messages` — Admin sends message with `role='assistant'`, Zod-validated. Updates `conversations.last_message`, `last_message_at`, `updated_at` after insert.

7. `POST /api/chat/conversations/[id]/status` — Updates conversation status to `'open'` or `'closed'` with strict Zod enum validation.

8. `GET /api/chat/settings` — Returns `displayName` and `avatarUrl` for the active org via `get_current_org_id()` RPC + organizations table lookup.

All endpoints:
- Export `const runtime = 'nodejs'`
- Auth-gate with `await getUser()` → 401 if no session
- Use `await createClient()` from `@/lib/supabase/server`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create src/types/chat.ts | 3fcf5b9 | src/types/chat.ts |
| 2 | Create GET /conversations and GET+DELETE /conversations/[id] | e4ca77b | src/app/api/chat/conversations/route.ts, src/app/api/chat/conversations/[id]/route.ts |
| 3 | Create messages, status, and settings endpoints | caf84a2 | src/app/api/chat/conversations/[id]/messages/route.ts, src/app/api/chat/conversations/[id]/status/route.ts, src/app/api/chat/settings/route.ts |

## Verification

- `grep -c "export interface ConversationSummary" src/types/chat.ts` → 1
- `grep -c "export interface ConversationMessage" src/types/chat.ts` → 1
- `grep "hasMore" src/app/api/chat/conversations/[id]/messages/route.ts` → 2 matches (pagination implemented)
- `grep "before" src/app/api/chat/conversations/[id]/messages/route.ts` → 3 matches (cursor param used)
- `grep "includeInternal" src/app/api/chat/conversations/[id]/messages/route.ts` → 2 matches
- `grep "z.enum" src/app/api/chat/conversations/[id]/status/route.ts` → 1 match
- `grep "widget_display_name" src/app/api/chat/settings/route.ts` → 1 match
- `npm run build` → exits with code 0, all 5 API routes listed in build output

## Deviations from Plan

None — plan executed exactly as written.

Note: Worktree branch required merging from `main` before execution because 06-01 commits were on main but not on this worktree branch. Fast-forward merge applied, then 06-02 executed cleanly.

## Self-Check: PASSED

- [x] src/types/chat.ts — exists (commit 3fcf5b9)
- [x] src/app/api/chat/conversations/route.ts — exists (commit e4ca77b)
- [x] src/app/api/chat/conversations/[id]/route.ts — exists (commit e4ca77b)
- [x] src/app/api/chat/conversations/[id]/messages/route.ts — exists (commit caf84a2)
- [x] src/app/api/chat/conversations/[id]/status/route.ts — exists (commit caf84a2)
- [x] src/app/api/chat/settings/route.ts — exists (commit caf84a2)
- [x] Build passes with no TypeScript errors
