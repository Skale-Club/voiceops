---
phase: "06-chat-inbox"
plan: "03"
subsystem: chat-inbox-ui
tags: [react, chat-inbox, typescript, shadcn, polling, mobile-responsive]
dependency_graph:
  requires: [06-02]
  provides: [conversation-list-component, chat-area-component, admin-chat-layout-component]
  affects: [06-04-chat-page]
tech_stack:
  added:
    - react-resizable-panels (shadcn resizable via npx shadcn@latest add)
    - @radix-ui/react-tabs (shadcn tabs)
    - @radix-ui/react-scroll-area (shadcn scroll-area)
  patterns:
    - native-fetch-polling (setInterval, no React Query)
    - optimistic-update-with-rollback
    - css-transform-mobile-slide (300ms ease-in-out)
    - resizable-panel-group-desktop
key_files:
  created:
    - src/components/ui/resizable.tsx
    - src/components/ui/tabs.tsx
    - src/components/ui/scroll-area.tsx
    - src/components/chat/conversation-list.tsx
    - src/components/chat/chat-area.tsx
    - src/components/chat/admin-chat-layout.tsx
  modified:
    - src/components/ui/resizable.tsx (fixed for react-resizable-panels v4 API)
    - package.json (added 3 new peer deps)
decisions:
  - Use native fetch + setInterval for polling (no @tanstack/react-query — not installed in project)
  - ConversationList is purely presentational; all data fetching lives in AdminChatLayout
  - Fix resizable.tsx to map legacy direction prop to new orientation prop for react-resizable-panels v4
metrics:
  duration: "22m"
  completed_date: "2026-04-05"
  tasks_completed: 3
  files_modified: 6
---

# Phase 06 Plan 03: Chat Inbox UI Components Summary

**One-liner:** Three client components — ConversationList (tabbed/searchable), ChatArea (bubble thread with debug toggle + send form), and AdminChatLayout (dual-polling orchestrator with ResizablePanelGroup desktop and CSS-transform mobile slide) — deliver the admin inbox frontend.

## What Was Built

1. **shadcn components installed** (Task 1):
   - `src/components/ui/resizable.tsx` — ResizablePanelGroup for desktop split pane
   - `src/components/ui/tabs.tsx` — tabbed filter for Open/Archived/All
   - `src/components/ui/scroll-area.tsx` — scrollable conversation list

2. **`src/components/chat/conversation-list.tsx`** (Task 2):
   - Tabs: Open / Archived / All (maps to `status === 'open'`, `status === 'closed'`, all)
   - Search input filters on `visitorName`, `lastMessage`, `visitorEmail` (case-insensitive)
   - Each row: visitor name (`visitorName ?? visitorEmail ?? 'Anonymous'`), "Archived" badge, relative time via `formatDistanceToNow` from date-fns, `line-clamp-2` last message preview
   - Selected row: `bg-slate-100 border-slate-300 dark:bg-slate-800/80 dark:border-slate-700`
   - Hover: `hover:bg-slate-100 dark:hover:bg-slate-800/70`
   - Selected row reveals Archive/Reopen button and Delete (AlertDialog-gated) inline
   - Empty state: "No conversations found."
   - Scrollable via `ScrollArea`

3. **`src/components/chat/chat-area.tsx`** (Task 3):
   - Empty state (no conversation selected): `MessageSquare` at 20% opacity with heading/subtext
   - Header: Avatar with initial, visitor name/email, "Show debug" checkbox, DropdownMenu with Archive/Reopen and Delete options
   - Message bubbles:
     - Visitor (right-aligned): `bg-blue-600 text-white rounded-2xl px-4 py-2 max-w-[75%]`
     - Assistant (left-aligned): small Avatar + `bg-white dark:bg-slate-800 border rounded-2xl px-4 py-2 max-w-[75%]`
     - Internal/debug: centered monospace, color-coded by `metadata.type` (tool_call=blue, tool_result=green, error=red, other=muted)
   - `showDebug` local state controls `filter(m => showDebug || !m.metadata?.internal)`
   - Auto-scroll: `messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })` on messages change
   - Textarea min-h `44px` max-h `150px`; Enter sends, Shift+Enter = newline
   - Mobile back button (`ArrowLeft`) visible via `md:hidden`

4. **`src/components/chat/admin-chat-layout.tsx`** (Task 3):
   - State: `conversations`, `selectedConversationId`, `messages`, `isMessagesLoading`, `isMobileListVisible`
   - Conversations polling: 30s normally, 15s when a conversation is selected
   - Messages polling: 15s when `document.visibilityState === 'visible'`
   - `handleSendMessage`: optimistic append of temp message → POST → reload → rollback on error
   - `handleStatusChange`: POST status endpoint → reload conversations
   - `handleDelete`: DELETE endpoint → clear selection → reload conversations
   - Desktop: `ResizablePanelGroup direction="horizontal"` with 25/75 split, minSize 20, maxSize 40, min-w-[280px]
   - Mobile: two `absolute inset-0` divs with `transition-transform duration-300 ease-in-out`, `translate-x-0`/`-translate-x-full`/`translate-x-full` CSS transforms

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install shadcn resizable, tabs, scroll-area | 8eff331 | src/components/ui/resizable.tsx, tabs.tsx, scroll-area.tsx |
| 2 | Create ConversationList component | 20cf278 | src/components/chat/conversation-list.tsx |
| 3 | Create ChatArea and AdminChatLayout | 8abfb97 | src/components/chat/chat-area.tsx, admin-chat-layout.tsx, resizable.tsx (fix) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed resizable.tsx for react-resizable-panels v4 API incompatibility**
- **Found during:** Task 3 build (TypeScript error on `PanelGroup` and `PanelResizeHandle` not existing)
- **Issue:** `npx shadcn@latest add resizable` generated code using `react-resizable-panels` v1 API (`PanelGroup`, `Panel`, `PanelResizeHandle`). The installed package is v4.9.0 which exports `Group`, `Panel`, `Separator` with `orientation` prop instead of `direction`.
- **Fix:** Rewrote `resizable.tsx` to import `Group`, `Panel`, `Separator` from `react-resizable-panels`. Added backward-compat `direction` prop mapping to `orientation` on `ResizablePanelGroup` so the shadcn API contract (`direction="horizontal"`) still works for callers.
- **Files modified:** `src/components/ui/resizable.tsx`
- **Commit:** 8abfb97

## Known Stubs

None. All components wire to live API endpoints via the polling pattern in `AdminChatLayout`.

## Self-Check: PASSED

- [x] src/components/ui/resizable.tsx — exists (commit 8eff331, updated 8abfb97)
- [x] src/components/ui/tabs.tsx — exists (commit 8eff331)
- [x] src/components/ui/scroll-area.tsx — exists (commit 8eff331)
- [x] src/components/chat/conversation-list.tsx — exists (commit 20cf278)
- [x] src/components/chat/chat-area.tsx — exists (commit 8abfb97)
- [x] src/components/chat/admin-chat-layout.tsx — exists (commit 8abfb97)
- [x] `npm run build` passes with zero TypeScript errors
