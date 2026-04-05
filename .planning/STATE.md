---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Leaidear + Embedded Chatbot
status: Ready to execute
last_updated: "2026-04-05T04:22:32.678Z"
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 21
  completed_plans: 20
---

# Leaidear - State

## Current Position

Milestone: v1.2 Leaidear + Embedded Chatbot — in progress
Phase: 06 (chat-inbox) — EXECUTING
Plan: 5 of 5

Last session: 2026-04-05T04:22:32.671Z

## Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2: 🔄 In progress — [█████████░] 90% (19/21 plans complete — Phases 01-05 ✅, Phase 06 in progress 4/5)

## Project Reference

See `.planning/PROJECT.md` (updated 2026-04-03 after v1.1)

**Core value:** The Action Engine must work reliably for every tenant
**Current focus:** Phase 06 — chat-inbox

## Accumulated Context

- v1.0 shipped 2026-04-03 — 6 phases, 30 plans, full MVP
- v1.1 shipped 2026-04-03 — LangChain vector pipeline, schema migration 010
- Active known tech debt: no HMAC validation on Vapi webhooks, campaign calls don't appear in Observability, send_sms/custom_webhook are stubs
- 01-02 (2026-04-04): voiceops.skale.club canonical URL preserved — deployment host not brand label; vo_active_org cookie name preserved — internal prefix not brand-visible
- 01-03 (2026-04-04): redis npm package (not @upstash/redis) for provider-agnostic URL-based connection; globalThis HMR guard mirrors supabase singleton; widget.js is a static stub replaced in Phase 4
- 01-04 (2026-04-04): No anon-role RLS on chat tables — Phase 2 writes via service-role client bypassing RLS; organization_id denormalized on chat_messages for RLS without join; migration 011 applied to Supabase
- 02-01 (2026-04-04): widget_token backfilled with gen_random_uuid() without pgcrypto; session_key nullable until Wave 1 creates sessions; migration 012 applied to Supabase; 3 RED test scaffolds committed
- 02-02 (2026-04-04): session.ts + persist.ts helpers implemented; vi.hoisted() fix applied to chat-session test scaffold; 9/9 tests GREEN; build clean
- 04-03 (2026-04-04): Plan 03 is verification-only — widget built in Plan 02 passed all 21 browser checklist items unchanged; Shadow DOM CSS fix (Plan 02) resolved all styling concerns; all 5 WIDGET requirements confirmed in live browser
- 05-discuss (2026-04-04): Widget config will live on `organizations`; Phase 5 scope is display name, primary color, welcome message, embed code, preview, public config endpoint, and token regeneration. `system_prompt` remains out of scope.
- 05-plan (2026-04-04): Phase 5 is split into 4 plans: backend schema/config route, dashboard admin surface, widget runtime config hydration, and a blocking human verification checkpoint for token rotation + real embed behavior.
- 05-01 (2026-04-04): Migration 013 adds `widget_display_name`, `widget_primary_color`, and `widget_welcome_message` to `organizations`; `GET /api/widget/[token]/config` now returns only normalized public widget fields and focused tests cover valid token, invalid token, inactive org, and fallback behavior.
- 05-02 (2026-04-04): `/widget` is now a first-class dashboard page with active-org scoped server actions, live preview, canonical `https://voiceops.skale.club/widget.js` embed output, and explicit token rotation invalidation copy.
- 05-03 (2026-04-04): `public/widget.js` now hydrates display name, primary color, and welcome message from `GET /api/widget/[token]/config` after mount with Phase 4 defaults preserved on fetch failure; widget tests now cover hydration success, fallback boot, and invalid-token chat behavior.
- 06-01 (2026-04-05): Migration 015 renames chat_sessions → conversations and chat_messages → conversation_messages; adds admin-inbox columns (status, visitor_*, last_message, memory); persist.ts now updates conversations.last_message/last_message_at/updated_at after each message insert; database.ts types updated to new schema.

### Roadmap Evolution

- Phase 6 added: Chat Inbox — admin inbox to view/filter/reply to widget conversations; widget settings relocated under Chat in sidebar

## Recent Decisions

- Store widget appearance settings directly on `organizations` instead of introducing a separate widget table.
- Keep widget boot config on a dedicated token-scoped GET route with Phase 4 defaults used when org values are null or blank.
- Scope widget admin reads and writes through `get_current_org_id()` with cached auth helpers so the dashboard stays RLS-aligned.
- Mirror widget appearance with a local preview component instead of loading the real `widget.js` bundle inside admin pages.
- Normalize saved widget colors to uppercase `#RRGGBB` values so client and server validation enforce the same contract.
- Keep widget boot non-blocking by hydrating admin config after mount so synchronous `document.currentScript` token capture stays intact.
- Apply widget primary color through a shared Shadow DOM CSS variable so admin theming updates the bubble, avatars, user bubble, and send button together.
- Renamed chat_sessions/chat_messages to conversations/conversation_messages via migration 015; persistMessage now updates denormalized last_message/last_message_at/updated_at for admin inbox preview.
- 06-03 (2026-04-05): Chat inbox UI built — ConversationList (tabbed/searchable), ChatArea (bubble thread, debug toggle, send form), AdminChatLayout (dual-polling orchestrator, ResizablePanelGroup desktop, CSS-transform mobile slide). react-resizable-panels v4 API fix applied to resizable.tsx (Group/Panel/Separator + orientation prop).
- Use native fetch + setInterval for polling in chat UI components (no @tanstack/react-query — not installed in this project).
- resizable.tsx wrapper maps legacy direction prop to new orientation prop for react-resizable-panels v4 compatibility.
