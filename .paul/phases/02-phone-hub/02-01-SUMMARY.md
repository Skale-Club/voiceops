---
phase: 02-phone-hub
plan: 01
subsystem: ui
tags: [next.js, routing, tabs, sidebar, shadcn]

requires:
  - phase: 01-data-layer
    provides: schema and TypeScript types already aligned

provides:
  - /phone page with Calls, Campaigns, Assistants tabs
  - URL-driven tab state (?tab=calls|campaigns|assistants)
  - Redirects from /calls, /outbound, /assistants to /phone

affects: []

tech-stack:
  added: []
  patterns:
    - "URL searchParam drives active tab in server component; client component handles navigation only"

key-files:
  created:
    - src/app/(dashboard)/phone/page.tsx
    - src/app/(dashboard)/phone/_tabs.tsx
  modified:
    - src/app/(dashboard)/calls/page.tsx
    - src/app/(dashboard)/outbound/page.tsx
    - src/app/(dashboard)/assistants/page.tsx
    - src/components/layout/app-sidebar.tsx

key-decisions:
  - "Tab state in URL searchParam (not React state) — server component renders correct data per tab"
  - "CallsTabContent extracted as inline server component to avoid IIFE in JSX"
  - "Active detection on sidebar covers /calls, /outbound, /assistants for back-navigation from sub-routes"

patterns-established:
  - "Phone sub-routes (/calls/[callId], /outbound/[id]) stay at original paths — only list pages redirect"

duration: ~20min
started: 2026-04-08T00:00:00Z
completed: 2026-04-08T00:00:00Z
---

# Phase 02 Plan 01: Phone Hub Summary

**Unified Calls, Campaigns, and Assistants under a single `/phone` page with URL-driven tabs; sidebar reduced from 3 items to 1.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~20 min |
| Tasks | 4/4 completed |
| Files created | 2 |
| Files modified | 4 |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: /phone renders with tabs | Pass | Default tab: Calls |
| AC-2: Tab switching updates URL | Pass | router.push('/phone?tab=X') on change |
| AC-3: Assistants tab works | Pass | Full CRUD via AssistantMappingsTable |
| AC-4: Old routes redirect | Pass | /calls → /phone?tab=calls, etc. |
| AC-5: Sidebar single "Phone" entry | Pass | 3 items → 1, active on /phone and legacy paths |
| AC-6: Deep links unaffected | Pass | /calls/[callId] and /outbound/[id] untouched |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/app/(dashboard)/phone/page.tsx` | Created | Server component; fetches data for active tab only |
| `src/app/(dashboard)/phone/_tabs.tsx` | Created | Client tab switcher; navigates via router.push |
| `src/app/(dashboard)/calls/page.tsx` | Modified | Replaced with redirect to /phone?tab=calls |
| `src/app/(dashboard)/outbound/page.tsx` | Modified | Replaced with redirect to /phone?tab=campaigns |
| `src/app/(dashboard)/assistants/page.tsx` | Modified | Replaced with redirect to /phone?tab=assistants |
| `src/components/layout/app-sidebar.tsx` | Modified | Removed PhoneCall/Bot icons and 3 entries; added Phone + active detection for legacy paths |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| URL searchParam for tab state | Server component renders only the active tab's data — no client-side data waterfalls | Future tabs can add their own searchParams without conflict |
| `_tabs.tsx` client component is navigation-only | Tab content remains server-rendered; clean separation | Tab switches trigger full server re-render (correct for filtering) |
| `CallsTabContent` helper component | Avoids IIFE pattern in JSX, TypeScript-clean | Pattern reusable if more tabs are added |
| Sidebar active detection covers legacy paths | Back navigation from /calls/[callId] still highlights Phone | No broken navigation state from sub-routes |

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | npm install required before build |
| Scope additions | 0 | — |
| Deferred | 0 | — |

**Auto-fix:** `npm install` was necessary — packages were declared in `package.json` but not installed in `node_modules`. Pre-existing issue unrelated to this plan.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| IIFE pattern in JSX caused potential TS issues | Extracted as `CallsTabContent` server component inline |
| `esbuild` not found during `npm run build` | Pre-existing — `build:widget` script requires esbuild CLI; used `npx next build` directly to verify. Not introduced by this plan. |

## Next Phase Readiness

**Ready:**
- Phone hub is live; all three sections accessible via /phone
- Sub-routes (/calls/[callId], /outbound/[id], /outbound/new) fully functional
- Whitelabel config.ts is in place for APP_NAME

**Concerns:**
- `build:widget` (esbuild) is broken in the local environment — pre-existing, unblocking for app development but needs fix before full production build
- Calls tab filter searchParams reset on tab switch (by design) — if users want filter persistence across tab switches, that would be a future enhancement

**Blockers:** None
