---
phase: "06-chat-inbox"
plan: "04"
subsystem: chat-inbox-routing
tags: [routing, sidebar, navigation, next-app-router]
dependency_graph:
  requires: [06-03]
  provides: [chat-page-route, sidebar-chat-group]
  affects: [dashboard-navigation]
tech_stack:
  added: []
  patterns:
    - server-component-page-shell
    - sidebar-group-labelled
key_files:
  created:
    - src/app/(dashboard)/chat/page.tsx
  modified:
    - src/components/layout/app-sidebar.tsx
decisions:
  - Chat group replaces standalone Widget nav item in sidebar; Widget Settings lives under Chat > Settings to reduce nav clutter
  - /chat page is a server component shell delegating auth to layout and rendering client AdminChatLayout
metrics:
  duration: "8m"
  completed_date: "2026-04-05"
  tasks_completed: 2
  files_modified: 2
---

# Phase 06 Plan 04: Chat Inbox Routing and Sidebar Wiring Summary

**One-liner:** /chat page server component shell renders AdminChatLayout; sidebar gains a Chat group (Inbox + Settings) replacing the standalone Widget item.

## What Was Built

1. **`src/app/(dashboard)/chat/page.tsx`** (Task 1):
   - Server component (no `'use client'`) — auth delegated to `(dashboard)/layout.tsx`
   - `h-full flex flex-col` container fills the `<main className="flex-1 overflow-auto">` layout wrapper
   - Imports and renders `AdminChatLayout` (client component from plan 06-03)

2. **`src/components/layout/app-sidebar.tsx`** (Task 2):
   - Removed `{ icon: MessageSquare, label: 'Widget', href: '/widget', active: true }` from `navItems`
   - Added `chatItems` array: `[{ icon: Inbox, label: 'Inbox', href: '/chat' }, { icon: Settings2, label: 'Settings', href: '/widget' }]`
   - Added `Chat` `SidebarGroup` with `MessageSquare` icon label placed after main nav group
   - Added imports: `Inbox`, `Settings2` from lucide-react; `SidebarGroupLabel` from sidebar ui
   - Both items use `pathname === item.href || pathname.startsWith(item.href + '/')` for active state

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create /chat page server component shell | d824368 | src/app/(dashboard)/chat/page.tsx |
| 2 | Update sidebar — add Chat group, remove standalone Widget | dbde135 | src/components/layout/app-sidebar.tsx |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing npm dependencies in worktree**
- **Found during:** Task 2 build verification
- **Issue:** The worktree was at an older commit (`1411b11`) that predated plan 06-03. After merging main (`5ab1333`), the chat components were present but `react-resizable-panels`, `@radix-ui/react-scroll-area`, and `@radix-ui/react-tabs` were not installed in the worktree's `node_modules`.
- **Fix:** Ran `npm install react-resizable-panels @radix-ui/react-scroll-area @radix-ui/react-tabs` in the worktree. Build then passed cleanly.
- **Files modified:** package-lock.json (not committed — dep already in package.json from main)

## Known Stubs

None. The /chat route wires directly to AdminChatLayout which polls live API endpoints.

## Self-Check: PASSED

- [x] src/app/(dashboard)/chat/page.tsx — exists (commit d824368)
- [x] AdminChatLayout imported and rendered in page
- [x] No `'use client'` in page.tsx (server component)
- [x] No `getUser()` in page.tsx (auth delegated to layout)
- [x] `label: 'Widget'` removed from sidebar navItems (0 matches)
- [x] `chatItems` present in sidebar (2 matches)
- [x] `/chat` href in sidebar (1 match — Inbox item)
- [x] `/widget` href in sidebar (1 match — Settings item)
- [x] `Inbox` imported and used in sidebar (2 matches)
- [x] `npm run build` exits with code 0 — /chat route appears in route table
