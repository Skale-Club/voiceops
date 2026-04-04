# Phase 4: Widget Embed Script - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Build and serve the client-side JavaScript widget that site owners install via a single `<script>` tag. This phase delivers:
- `src/widget/index.ts` — TypeScript widget source
- esbuild pipeline (`npm run build:widget`) that outputs to `public/widget.js`
- Shadow DOM-isolated chat UI: floating bubble (bottom-right) + expandable chat panel
- SSE stream consumer that buffers tokens and displays the full response on `done`
- Session ID persisted via `localStorage` using a per-org namespaced key
- API base URL auto-detected from the widget's own `<script src>` origin (white-label safe)

This phase does NOT add admin configuration UI, widget appearance settings, or embed code generation — those are Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Widget Isolation
- **D-01:** Widget renders inside a **Shadow DOM** — `document.body` → `div#leaidear-root` → `shadowRoot` → widget DOM. Host site CSS cannot reach inside; widget CSS cannot leak out.
- **D-02:** Styles are delivered as an **inline CSS string** injected via a `<style>` element into the shadow root at init time. No external stylesheets, no CDN dependencies.

### Build Approach
- **D-03:** Widget source lives at `src/widget/index.ts` (TypeScript). A new `npm run build:widget` script uses esbuild to bundle and minify it into `public/widget.js`. This replaces the Phase 1 stub.
- **D-04:** The esbuild command: `esbuild src/widget/index.ts --bundle --minify --outfile=public/widget.js`. No new dependencies — esbuild is already in the Next.js toolchain.
- **D-05:** **No hardcoded API URL.** The widget auto-detects the API base from its own `<script src>` origin at runtime:
  ```js
  const src = document.currentScript.src;
  const apiBase = new URL(src).origin;
  // → "https://myagency.com" (whatever domain serves widget.js)
  ```
  This makes the widget fully white-label — it works on any domain without rebuilding.
- **D-06:** The only install-time attribute required on the script tag is `data-token`. Example:
  ```html
  <script src="https://myagency.com/widget.js" data-token="abc123"></script>
  ```

### Visual Design
- **D-07:** Floating bubble position: **bottom-right corner** of the host page. Fixed positioning, `z-index` high enough to sit above most host content.
- **D-08:** Clicking the bubble opens a **chat panel** (overlay/popup attached to the same shadow root). Clicking again (or an X button) collapses it back to the bubble.
- **D-09:** While the AI is generating a response, display **animated typing dots** (3-dot pulsing animation) in the message area. This covers both normal token streaming wait and `tool_call` event wait time.
- **D-10:** Response display: **accumulate all tokens, show the full response when the `done` SSE event arrives.** No character-by-character reveal. Typing dots visible from first `fetch` call until `done`.
- **D-11:** SSE event types to handle (per Phase 3 protocol):
  - `session` — store `sessionId` in localStorage; ignore if already have one
  - `token` — accumulate text in buffer
  - `done` — append accumulated text to chat as assistant message; hide typing dots
  - `tool_call` — no separate UI state needed (typing dots already showing)

### Session Continuity
- **D-12:** Session ID is stored in **localStorage** with key `leaidear_{token}_sessionId` (namespaced by product name + org token to prevent collision if multiple org widgets appear on the same host site).
- **D-13:** On widget init, check localStorage for an existing sessionId. If found, pass it in the first POST body. If not found, the first `session` SSE event provides the new ID — store it immediately.

### Claude's Discretion
- Exact chat panel dimensions and typography (font size, line height, message bubble padding)
- Whether the bubble shows an unread badge or welcome pulse animation on first load
- Error state UI (network error, 401, etc.)
- Whether to also run `build:widget` as part of `npm run build` or keep it a separate manual step
- Exact esbuild flags (target, platform, format)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing stub to replace
- `public/widget.js` — current Phase 1 stub (comment only); Phase 4 esbuild output replaces this file

### SSE protocol (Phase 3 — MUST follow exactly)
- `.planning/phases/03-ai-conversation-engine/03-CONTEXT.md` — D-01 through D-04 define the SSE event format the widget must parse. D-02 is critical: `session`, `token`, `done`, `tool_call` JSON events.

### API endpoint
- `src/app/api/chat/[token]/route.ts` — the POST endpoint the widget calls. Widget passes `{ message, sessionId }` in the body.

### Session schema (what localStorage sessionId maps to)
- `supabase/migrations/012_org_widget_token.sql` — `widget_token` and `session_key` columns

### Project conventions
- `CLAUDE.md` — Node.js runtime, API route patterns, production origin (`voiceops.skale.club`)
- `.planning/codebase/CONVENTIONS.md` — Coding conventions

### No external specs — requirements fully captured in decisions above

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public/widget.js` (stub) — esbuild output goes here; no other file changes needed to serve it
- Phase 3 SSE stream format is fixed and documented — widget just needs a `fetch + ReadableStream` reader

### Established Patterns
- Widget is pure client-side JS — no Next.js App Router, no React, no Tailwind on the widget side
- All API calls from widget → `/api/chat/[token]` (POST, JSON body, ReadableStream response)
- Production origin is `https://voiceops.skale.club` but widget auto-detects origin so this isn't baked in

### Integration Points
- `public/widget.js` is the only artifact. Phase 5 will read `widget_token` from the DB and generate the `<script>` tag — it does not modify widget.js itself.
- Phase 5 admin config (name, color, welcome message) will be fetched by the widget at init time via a config API — researcher/planner for Phase 5 should design that endpoint. Phase 4 can use hardcoded defaults.

</code_context>

<specifics>
## Specific Ideas

- White-label requirement confirmed: API URL must NEVER be hardcoded. Auto-detect from `document.currentScript.src` origin is the chosen approach.
- Embed tag is intentionally minimal: `<script src="..." data-token="...">` only. No `data-api`, no `data-color`, etc. — Phase 5 owns appearance config.
- Typing dots are the sole loading indicator — no status text, no spinner, no per-event messaging.
- Full response shown at once (not streamed char-by-char) — simplifies the widget's rendering logic significantly.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-widget-embed-script*
*Context gathered: 2026-04-04*
