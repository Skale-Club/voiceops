# Phase 4: Widget Embed Script - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 04-widget-embed-script
**Areas discussed:** Widget Isolation, Build Approach, Visual Design & Streaming UX, Session Continuity

---

## Widget Isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Shadow DOM | Widget attaches to a shadow root; host CSS cannot leak in or out. Industry standard for chat widgets. | ✓ |
| iframe | Full isolation via cross-origin iframe + postMessage. Overkill for this use case. | |
| Naked DOM | Injects directly into host DOM with scoped class names. Host styles can override. | |

**User's choice:** Shadow DOM
**Notes:** None

---

### Isolation — Style delivery inside Shadow DOM

| Option | Description | Selected |
|--------|-------------|----------|
| Inline CSS string | Template literal injected via `<style>` into shadow root at init. Zero deps. | ✓ |
| Adopted stylesheets | Constructable Stylesheets API — better performance but more complex. | |
| Tailwind CDN in shadow root | Adds a network request; non-standard inside Shadow DOM. | |

**User's choice:** Inline CSS string
**Notes:** None

---

## Build Approach

### How widget.js is built

| Option | Description | Selected |
|--------|-------------|----------|
| esbuild bundle | TypeScript source, esbuild output to public/widget.js via `npm run build:widget`. | ✓ |
| Plain vanilla JS | Hand-written JS in public/widget.js. No TypeScript, no bundler. | |
| Next.js API route | Serve widget JS from a route handler with runtime injection. | |

**User's choice:** esbuild bundle
**Notes:** None

---

### API base URL discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-coded at build time | Bakes production URL into the bundle via esbuild define. | |
| data-api attribute | Site owner sets data-api on the script tag. | |
| Auto-detect from script src | Widget reads `new URL(document.currentScript.src).origin`. | ✓ |

**User's choice:** Auto-detect from script src
**Notes:** User explicitly rejected hardcoding — "não quero nada hardcoded, esse projeto é whitelabel". White-label requirement means API URL must be derived at runtime.

---

## Visual Design & Streaming UX

### Bubble position

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom-right | Industry standard (Intercom, Crisp, HubSpot). | ✓ |
| Bottom-left | Avoids cookie banner conflicts on some sites. | |
| Configurable via data-position | Flexible but complicates install docs and Phase 5. | |

**User's choice:** Bottom-right
**Notes:** None

---

### Streamed token display

| Option | Description | Selected |
|--------|-------------|----------|
| Append token-by-token with blinking cursor | Each token event appends immediately. Cursor shows while streaming. | |
| Word-by-word (buffer tokens) | Buffer until space/punctuation then render. Smoother but more complex. | |
| Show full response at once | Accumulate all tokens, display on `done` event. | ✓ |

**User's choice:** Show full response at once
**Notes:** Simplifies widget rendering — buffer everything, render on `done`.

---

### Loading indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Animated typing dots | 3-dot pulsing animation (iMessage style). | ✓ |
| Spinner with status text | Spinner + "Thinking..." / "Searching..." text. | |
| Nothing (static) | No loading indicator. | |

**User's choice:** Animated typing dots
**Notes:** Covers both normal wait and `tool_call` wait — no need for separate states.

---

## Session Continuity

### Session persistence mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage | Survives page navigation and browser restarts. | ✓ |
| sessionStorage | Survives navigation within tab; clears on tab close. | |
| In-memory only | Lost on page navigation. | |

**User's choice:** localStorage
**Notes:** None

---

### localStorage key namespacing

| Option | Description | Selected |
|--------|-------------|----------|
| leaidear_{token}_sessionId | Scoped to product name + org token. Prevents multi-org collision. | ✓ |
| leaidear_sessionId | Scoped to product name only. Simpler but collision risk. | |
| You decide | Claude picks. | |

**User's choice:** `leaidear_{token}_sessionId`
**Notes:** None

---

## Claude's Discretion

- Exact chat panel dimensions, typography, bubble size
- Whether bubble shows welcome pulse animation on first load
- Error state UI design
- Whether `build:widget` runs as part of `npm run build` or stays a manual step
- Exact esbuild flags (target, platform, format)

## Deferred Ideas

None — discussion stayed within phase scope.
