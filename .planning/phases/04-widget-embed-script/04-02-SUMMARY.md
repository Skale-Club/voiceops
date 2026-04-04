---
phase: 04-widget-embed-script
plan: 02
subsystem: widget
tags: [esbuild, shadow-dom, sse, widget, typescript, iife]

# Dependency graph
requires:
  - phase: 04-widget-embed-script
    plan: 01
    provides: Wave 0 RED tests (widget.test.ts, widget-asset.test.ts) and CORS headers on chat API

provides:
  - src/widget/index.ts: Full vanilla TypeScript widget source (Shadow DOM, SSE, session storage)
  - public/widget.js: Minified esbuild IIFE bundle (13.1kb)
  - public/widget-test.html: Manual browser smoke test page
  - package.json build:widget script and chained build

affects:
  - 04-03 (widget integration — widget.js is the distributable artifact)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - esbuild IIFE bundle from TypeScript source — no new dependencies (esbuild already in toolchain)
    - Shadow DOM with inline CSS string injection — zero host-site CSS interference
    - NDJSON buffer-split-parse SSE consumer — handles chunk boundaries correctly
    - localStorage session persistence with try/catch guards for private browsing

key-files:
  created:
    - src/widget/index.ts
    - public/widget-test.html
  modified:
    - public/widget.js
    - package.json
    - tests/widget.test.ts

key-decisions:
  - "Rename CSS constant to WIDGET_CSS — global DOM lib declares CSS as a namespace, causing TypeScript redeclaration error"
  - "Replace jsdom localStorage mock with Map-based vi.stubGlobal implementation — jsdom does not implement setItem/clear in this vitest environment"
  - "Chain build:widget into npm run build — ensures widget.js is never stale on Vercel deploy"

requirements-completed: [WIDGET-01, WIDGET-02, WIDGET-03, WIDGET-04, WIDGET-05]

# Metrics
duration: 7min
completed: 2026-04-04
---

# Phase 04 Plan 02: Widget Embed Script — Widget Source, esbuild Pipeline, and Test GREEN Summary

**Full vanilla TypeScript widget (Shadow DOM, floating bubble, SSE consumer, session storage) bundled via esbuild IIFE; all 11 Wave 0 RED tests turned GREEN**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-04T17:32:49Z
- **Completed:** 2026-04-04T17:40:00Z
- **Tasks:** 2
- **Files modified:** 5 (src/widget/index.ts created, public/widget.js replaced, public/widget-test.html created, package.json updated, tests/widget.test.ts fixed)

## Accomplishments

- Created `src/widget/index.ts` (656 lines) — complete standalone vanilla TypeScript widget with Shadow DOM isolation, floating bubble (56px, bottom-right fixed, z-index 2147483647), chat panel (360x520px), typing indicator, SSE NDJSON consumer, localStorage session persistence, double-init guard, focus trap, and all UI-SPEC CSS values
- Added `build:widget` esbuild script to package.json (`--bundle --minify --platform=browser --format=iife --target=es2017`) and chained it into `npm run build`
- Built `public/widget.js` — 13.1kb minified IIFE bundle replacing the Phase 1 stub
- Created `public/widget-test.html` — manual browser smoke test page
- Fixed `tests/widget.test.ts` localStorage compatibility issue (jsdom missing `setItem`/`clear`) — all 11 tests now GREEN

## Task Commits

1. **Task 1: Create src/widget/index.ts** - `1debdc9` (feat)
2. **Task 2: Add build:widget script and build public/widget.js and widget-test.html** - `1445a4d` (feat)

## Files Created/Modified

- `src/widget/index.ts` — full widget implementation, 656 lines, all D-01..D-13 decisions implemented
- `public/widget.js` — minified IIFE bundle (13,135 bytes, 47 occurrences of `leaidear` strings)
- `public/widget-test.html` — manual browser smoke test page with 12-step verification checklist
- `package.json` — added `build:widget` script; updated `build` to chain it
- `tests/widget.test.ts` — added Map-based localStorage mock via `vi.stubGlobal` to fix jsdom compatibility

## Decisions Made

- Renamed `CSS` constant to `WIDGET_CSS` — TypeScript's DOM lib exports `CSS` as a global namespace; using the same name caused a "Cannot redeclare block-scoped variable" error at compile time. This is a minor implementation detail that doesn't affect the widget's runtime behavior.
- Used Map-based `vi.stubGlobal('localStorage', ...)` in tests — jsdom's localStorage implementation in this vitest environment does not expose `setItem`, `clear`, or `getItem` as callable functions. The Map-based mock provides complete localStorage compatibility for all widget tests without changing the widget implementation.
- Chained `build:widget` into `npm run build` — ensures public/widget.js is always rebuilt before Next.js compilation on Vercel, preventing stale widget artifacts in production deploys.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CSS constant name conflicts with TypeScript DOM global**
- **Found during:** Task 1 verification (npm run build)
- **Issue:** TypeScript's `lib.dom.d.ts` declares `CSS` as a global namespace. Declaring `const CSS` at module top level caused "Cannot redeclare block-scoped variable 'CSS'" compile error.
- **Fix:** Renamed to `WIDGET_CSS` throughout the widget source file
- **Files modified:** `src/widget/index.ts`
- **Commit:** `1debdc9` (included in Task 1 commit)

**2. [Rule 3 - Blocking] jsdom localStorage incompatibility in widget.test.ts**
- **Found during:** Task 2 test run
- **Issue:** jsdom in this vitest environment does not implement `localStorage.setItem`, `localStorage.clear`, or `localStorage.getItem` as callable functions. All 8 widget.test.ts tests failed with `TypeError: localStorage.setItem is not a function` / `localStorage.clear is not a function`.
- **Context:** Plan 01 SUMMARY noted the `localStorage.clear is not a function` issue as "existing jsdom behavior issue that does not affect the RED test outcome." Plan 02 needed to make these tests GREEN, which required resolving the underlying mock issue.
- **Fix:** Added a Map-based localStorage mock using `vi.stubGlobal('localStorage', ...)` at the top of `tests/widget.test.ts`. Replaced `localStorage.clear()` calls with a `clearLocalStorage()` helper that delegates to the mock's clear method.
- **Files modified:** `tests/widget.test.ts`
- **Commit:** `1445a4d` (included in Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 compile-time bug, 1 blocking test infrastructure issue)
**Impact on plan:** Both fixes were minimal scope — no architecture changes, no new dependencies. The widget implementation and test contracts are unchanged.

## Known Stubs

None — the widget is fully implemented. `public/widget.js` is the real minified IIFE bundle. All test assertions are GREEN.

## Next Phase Readiness

- `public/widget.js` is the distributable artifact for Plan 03 (widget integration)
- `public/widget-test.html` provides a manual smoke test page — open at `http://localhost:4267/widget-test.html` after `npm run dev`
- All 11 Wave 0 widget tests are GREEN; full test suite (72 tests) passes
- `npm run build` is clean (exits 0, no TypeScript errors)

---
*Phase: 04-widget-embed-script*
*Completed: 2026-04-04*
