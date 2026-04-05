---
phase: "06-chat-inbox"
plan: "01"
subsystem: chat-schema
tags: [database, migration, schema-rename, chat-inbox, typescript]
dependency_graph:
  requires: [01-foundation, 02-chat-api]
  provides: [conversations-table, conversation_messages-table, typed-schema]
  affects: [persist.ts, database.ts, chat-api-route]
tech_stack:
  added: []
  patterns: [supabase-migration, service-role-writes, rls-org-isolation]
key_files:
  created:
    - supabase/migrations/015_conversations.sql
  modified:
    - src/lib/chat/persist.ts
    - src/types/database.ts
decisions:
  - Renamed chat_sessions -> conversations and chat_messages -> conversation_messages via migration 015, preserving service-role write pattern
  - persistMessage now updates conversations.last_message/last_message_at/updated_at after each insert for admin inbox preview
  - Kept function signatures in persist.ts unchanged so route.ts required no modifications
metrics:
  duration: "15m"
  completed_date: "2026-04-05"
  tasks_completed: 3
  files_modified: 3
---

# Phase 06 Plan 01: Chat Inbox Schema Rename Summary

**One-liner:** Migration 015 renames chat_sessions/chat_messages to conversations/conversation_messages, adds admin-inbox columns (status, visitor_*, last_message, memory), and updates persist.ts + database.ts to write to the new schema.

## What Was Built

Migration 015 applied to Supabase that:
1. Renames `chat_sessions` → `conversations` and `chat_messages` → `conversation_messages`
2. Renames `organization_id` → `org_id` on both tables
3. Renames `session_id` → `conversation_id` on conversation_messages
4. Adds admin-inbox columns to conversations: `status`, `updated_at`, `last_message_at`, `first_page_url`, `visitor_name`, `visitor_phone`, `visitor_email`, `last_message`, `memory`
5. Adds `metadata` JSONB column to conversation_messages (for tool call/result tracking)
6. Drops old role check constraint and recreates RLS policies with new column names
7. Creates index on `conversations.status` for filtering

`persist.ts` updated to:
- Write to `conversations` (org_id, widget_token, session_key)
- Write to `conversation_messages` (conversation_id, org_id, role, content)
- Update `conversations.last_message`, `last_message_at`, and `updated_at` after each persistMessage call

`src/types/database.ts` updated with full `conversations` and `conversation_messages` type definitions matching the new schema.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration 015 — rename tables and add inbox columns | f2c18ed | supabase/migrations/015_conversations.sql |
| 2 | Update persist.ts to use new table/column names | 7c824b8 | src/lib/chat/persist.ts |
| 3 | Update database.ts types with new table definitions | eb8ef7d | src/types/database.ts |

## Verification

- `grep -r "chat_sessions\|chat_messages" src/` → 0 functional references (1 comment only)
- `grep -c "from('conversations')" src/lib/chat/persist.ts` → 2 (insert + update)
- `grep -c "from('conversation_messages')" src/lib/chat/persist.ts` → 1
- `grep -c "last_message:" src/lib/chat/persist.ts` → 1
- `npm run build` → exits with code 0, no TypeScript errors
- `npx supabase db push` → applied migration 015 successfully

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] supabase/migrations/015_conversations.sql — exists (commit f2c18ed)
- [x] src/lib/chat/persist.ts — updated (commit 7c824b8)
- [x] src/types/database.ts — updated (commit eb8ef7d)
- [x] Build passes with no TypeScript errors
- [x] Migration applied to Supabase
