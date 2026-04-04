# Phase 4: Widget Embed Script - Research

**Researched:** 2026-04-04
**Domain:** Vanilla TypeScript browser widget, esbuild bundling, Shadow DOM, SSE/ReadableStream consumer
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Widget renders inside a Shadow DOM — `document.body` → `div#leaidear-root` → `shadowRoot` → widget DOM. Host site CSS cannot reach inside; widget CSS cannot leak out.
- **D-02:** Styles are delivered as an **inline CSS string** injected via a `<style>` element into the shadow root at init time. No external stylesheets, no CDN dependencies.
- **D-03:** Widget source lives at `src/widget/index.ts` (TypeScript). A new `npm run build:widget` script uses esbuild to bundle and minify it into `public/widget.js`. This replaces the Phase 1 stub.
- **D-04:** The esbuild command: `esbuild src/widget/index.ts --bundle --minify --outfile=public/widget.js`. No new dependencies — esbuild is already in the Next.js toolchain.
- **D-05:** API base URL auto-detected from `document.currentScript.src` origin. Never hardcoded.
- **D-06:** Only required install-time attribute is `data-token`. Example: `<script src="https://myagency.com/widget.js" data-token="abc123"></script>`
- **D-07:** Floating bubble: bottom-right corner, fixed positioning, z-index maximum.
- **D-08:** Bubble click toggles chat panel open/closed from same shadow root.
- **D-09:** Typing dots (3-dot pulsing animation) during AI response generation.
- **D-10:** Response display: accumulate all tokens, show full response on `done` SSE event. No char-by-char reveal.
- **D-11:** SSE event types: `session`, `token`, `done`, `tool_call`.
- **D-12:** Session ID in `localStorage` keyed as `leaidear_{token}_sessionId`.
- **D-13:** On init, check localStorage for existing sessionId. If found, pass in POST body. If not found, store new ID from first `session` SSE event.

### Claude's Discretion

- Exact chat panel dimensions and typography (font size, line height, message bubble padding)
- Whether the bubble shows an unread badge or welcome pulse animation on first load
- Error state UI (network error, 401, etc.)
- Whether to also run `build:widget` as part of `npm run build` or keep it a separate manual step
- Exact esbuild flags (target, platform, format)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIDGET-01 | Admin can install the chat widget on any third-party site using a single `<script>` tag (no framework dependency on host) | esbuild IIFE bundle outputs a self-contained script; Shadow DOM prevents host CSS collisions |
| WIDGET-02 | Script tag is GTM-compatible (loads asynchronously, no blocking) | The `async` attribute on the script tag; `document.currentScript` captured synchronously at IIFE top before any async work |
| WIDGET-03 | Widget renders as a floating chat bubble that expands into a full chat panel | Shadow DOM + fixed positioning + z-index 2147483647; panel toggle via bubble click |
| WIDGET-04 | Widget is identified per-org via a public token embedded in the script tag | `data-token` attribute read from captured script element reference |
| WIDGET-05 | Widget works without visitor login or authentication | Anonymous session via `localStorage`; no auth headers sent; API validates via public org token only |
</phase_requirements>

---

## Summary

Phase 4 delivers a single self-contained JavaScript file (`public/widget.js`) produced by esbuild from `src/widget/index.ts`. The widget is entirely vanilla TypeScript — no React, no Tailwind, no external runtime dependencies. It uses Shadow DOM for style isolation, a `fetch + ReadableStream` loop to consume the SSE stream from Phase 3, and `localStorage` for session continuity across page loads.

The three hard technical problems in this phase are: (1) capturing `document.currentScript` before any async boundary so the script is GTM-compatible, (2) parsing the newline-delimited JSON SSE format correctly across chunk boundaries, and (3) making `position: fixed` inside a shadow root behave correctly relative to the viewport rather than the shadow host. All three have known, verified solutions documented below.

esbuild 0.27.0 is already installed in the project as a transitive dependency of Next.js. The `build:widget` script requires no new npm installs.

**Primary recommendation:** Use `esbuild src/widget/index.ts --bundle --minify --platform=browser --format=iife --outfile=public/widget.js`. Capture `document.currentScript` as the very first synchronous line of the IIFE so the reference is preserved through async callbacks.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| esbuild | 0.27.0 (already installed) | Bundle + minify `src/widget/index.ts` → `public/widget.js` | Already in Next.js toolchain; zero new deps; fastest bundler for this use case |
| TypeScript | ^5 (already installed) | Widget source type safety | Project-wide convention; esbuild strips types natively |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | Widget is 100% inline vanilla code | No runtime dependencies; everything bundled |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| esbuild IIFE | Rollup + terser | Rollup not in toolchain; more config; slower; no benefit here |
| `<style>` element in shadow root | `adoptedStyleSheets` | `adoptedStyleSheets` is more performant for multiple instances but adds complexity; single-instance widget does not need it |
| vanilla TS | React + bundler | React is overkill for a ~300-line widget; adds 40KB+ to bundle |

**Installation:** No new packages needed. esbuild 0.27.0 is already present.

**Version verification:** Confirmed via `node -e "require('./node_modules/esbuild/package.json').version"` → `0.27.0`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
  widget/
    index.ts       # Single entry point — all widget code
public/
  widget.js        # esbuild output (replaces Phase 1 stub)
```

The widget is intentionally a single-file source. There are no sub-modules to import because esbuild bundles everything into one IIFE and the widget logic is compact enough (~200-350 lines) that splitting would add build complexity without benefit.

---

### Pattern 1: Capture currentScript Before Any Async Boundary (WIDGET-02, GTM)

**What:** `document.currentScript` is only non-null during synchronous execution of the `<script>` element. Once the IIFE invokes any async operation (fetch, setTimeout, Promise), the property becomes `null` in all browsers.

**When to use:** Every widget that reads `data-*` attributes from its own `<script>` tag.

**The trap:** GTM injects scripts with the `async` attribute. `document.currentScript` IS still accessible during the synchronous top-level IIFE execution even for async scripts — the async attribute affects *when* the script runs relative to HTML parsing, not whether `document.currentScript` is set during execution. The key rule is: capture it before returning to the event loop.

**Example:**
```typescript
// Source: MDN Web Docs — Document.currentScript
// FIRST LINE of the IIFE — before any async work
const _scriptEl = document.currentScript as HTMLScriptElement | null
const _token = _scriptEl?.dataset.token ?? ''
const _apiBase = _scriptEl?.src ? new URL(_scriptEl.src).origin : ''

// Safe to use _token and _apiBase in any async callback later
async function init() {
  // _token is captured — not null even here
  const sessionId = localStorage.getItem(`leaidear_${_token}_sessionId`)
  await fetch(`${_apiBase}/api/chat/${_token}`, { /* ... */ })
}

init()
```

---

### Pattern 2: esbuild IIFE Build Command (D-03, D-04)

**What:** esbuild wraps all code in an immediately-invoked function expression, so top-level variables don't pollute `window`. `--platform=browser` ensures browser-appropriate polyfill choices and no Node.js builtins.

**When to use:** Any browser script that must work via `<script>` tag with no module system.

**Exact command (for package.json `scripts`):**
```bash
esbuild src/widget/index.ts --bundle --minify --platform=browser --format=iife --outfile=public/widget.js
```

**Flag breakdown:**
- `--bundle` — tree-shake and inline all imports into one file (widget has no external imports, so this is defensive)
- `--minify` — minify identifiers, whitespace, and syntax for production
- `--platform=browser` — use browser environment assumptions; prevents Node.js globals from appearing
- `--format=iife` — wrap output in `(function(){...})()` so top-level names don't become globals
- `--outfile=public/widget.js` — replaces the Phase 1 stub in place

**Note on `--global-name`:** Not needed. The widget has no exports to expose on `window`. The IIFE runs on load and self-initializes.

**Optional target flag:** `--target=es2017` matches the project tsconfig `target: "ES2017"` and ensures broad browser compatibility including Edge 18+, Chrome 61+, Firefox 60+.

**package.json script entry:**
```json
"build:widget": "esbuild src/widget/index.ts --bundle --minify --platform=browser --format=iife --outfile=public/widget.js"
```

---

### Pattern 3: Shadow DOM Initialization (D-01, D-02, WIDGET-01)

**What:** Attach an open shadow root to a dedicated host element, inject a `<style>` element with all CSS, then build widget DOM inside the shadow root.

**When to use:** Any widget that must not be affected by host site CSS or pollute host site CSS.

**Critical z-index behavior:** `position: fixed` inside a shadow root positions relative to the **viewport** (not the shadow host), same as in regular DOM. The shadow host must NOT have `transform`, `filter`, `perspective`, or `will-change` set on it, or fixed positioning reverts to that transformed ancestor. Since `div#leaidear-root` is a plain unstyled div appended to `document.body`, there is no transform ancestor and `position: fixed` works correctly. z-index: 2147483647 (max 32-bit signed int) ensures the widget floats above most host content, but a host page stacking context with its own z-index hierarchy could still obscure it — this is a known, acceptable limitation of third-party widgets.

**Style isolation:** The `<style>` element injected into the shadow root is fully scoped to that root. Host page selectors (even `* { ... }`) do not reach inside. Widget selectors do not reach outside.

**Example:**
```typescript
// Source: MDN — Using shadow DOM
function initWidget(token: string, apiBase: string): void {
  if (document.getElementById('leaidear-root')) return // guard against double-init

  const host = document.createElement('div')
  host.id = 'leaidear-root'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = CSS_STRING // the full inline CSS literal
  shadow.appendChild(style)

  // Build bubble and panel elements, append to shadow
  const bubble = buildBubble()
  const panel = buildPanel()
  shadow.appendChild(bubble)
  shadow.appendChild(panel)
}
```

---

### Pattern 4: SSE ReadableStream Consumer (D-10, D-11)

**What:** Consume the Phase 3 SSE stream, which uses newline-delimited JSON (not standard `data:` SSE format). Each line is a JSON object: `{"event":"session","sessionId":"..."}`, `{"event":"token","text":"..."}`, `{"event":"done"}`.

**Critical detail from stream.ts:** The encoder is:
```typescript
const enc = new TextEncoder()
return (obj: object) => enc.encode(JSON.stringify(obj) + '\n')
```
This means each event is one JSON object followed by a newline `\n`. There are NO `data:` prefixes, NO `event:` prefixes, NO blank-line separators — this is NOT standard EventSource format. The widget must parse it as NDJSON, not as standard SSE.

**Why not EventSource?** The standard `EventSource` API does not support POST requests, and the chat API requires a POST body (`{message, sessionId}`). Use `fetch` with `ReadableStream`.

**Chunk boundary pitfall:** A single `read()` call may return multiple JSON lines, or a JSON line split across two chunks. The parser must buffer incomplete lines.

**Example:**
```typescript
// Source: MDN — ReadableStreamDefaultReader.read()
async function consumeStream(
  response: Response,
  onEvent: (evt: { event: string; [k: string]: unknown }) => void
): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? '' // last part may be incomplete — keep in buffer

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      try {
        const evt = JSON.parse(trimmed) as { event: string; [k: string]: unknown }
        onEvent(evt)
      } catch {
        // Malformed line — skip
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as { event: string; [k: string]: unknown })
    } catch { /* skip */ }
  }
}
```

**This pattern is proven:** `tests/helpers/stream.ts` uses the identical buffer-split-parse approach and is confirmed GREEN in the Phase 3 test suite.

---

### Pattern 5: Session Lifecycle (D-12, D-13, WIDGET-05)

**What:** Read/write `localStorage` to persist sessionId across page reloads without any login.

**Storage key format:** `leaidear_{token}_sessionId` — namespaced so multiple org widgets on the same host page don't collide.

**Example:**
```typescript
const STORAGE_KEY = `leaidear_${token}_sessionId`

function getStoredSession(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // private browsing mode may throw
  }
}

function storeSession(sessionId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, sessionId)
  } catch {
    // Silent fail — session continuity is nice-to-have, not blocking
  }
}
```

**Note:** `localStorage` access throws in some private browsing modes. Always wrap in try/catch.

---

### Pattern 6: TypeScript Source for esbuild (WIDGET-01)

**What:** esbuild natively strips TypeScript types without running `tsc`. The existing `tsconfig.json` (strict, noEmit, lib: dom) is suitable for type-checking the widget source with `npm run build` (Next.js build also runs tsc). However, the widget source at `src/widget/index.ts` must NOT import from `@/lib/*` or Next.js modules — it is a browser-only standalone bundle.

**Key constraint:** `src/widget/index.ts` must use NO server-side imports. All logic must be self-contained vanilla JS/TS with only `lib: ["dom", "esnext"]` types used. The widget may share type interfaces (e.g., the SSE event shape) by inlining them — not by importing from `@/lib/chat/stream.ts`.

**Tsconfig approach:** The existing `tsconfig.json` already includes `lib: ["dom", "dom.iterable", "esnext"]` which covers all DOM APIs the widget needs (Shadow DOM, fetch, localStorage, ReadableStream, TextDecoder). No separate tsconfig for the widget is required.

---

### Pattern 7: Focus Trap for Accessibility (UI-SPEC requirement)

**What:** When the chat panel is open, Tab key must cycle within the panel, not escape to the host page. The shadow root boundary does NOT automatically trap focus — it must be implemented explicitly.

**Example (minimal focus trap):**
```typescript
function trapFocus(panel: HTMLElement): void {
  panel.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = Array.from(
      panel.querySelectorAll('button, input, [tabindex="0"]')
    ) as HTMLElement[]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  })
}
```

**Shadow DOM note:** `document.activeElement` inside a shadow root returns the shadow-root-level active element correctly in all modern browsers (Chrome 53+, Firefox 63+, Safari 10.1+).

---

### Anti-Patterns to Avoid

- **Calling `document.currentScript` inside any callback or async function:** It will be `null`. Always capture at IIFE top.
- **Using `EventSource` for the SSE stream:** EventSource only supports GET requests. The chat API requires POST.
- **Injecting CSS via a `<link>` element into the shadow root:** External stylesheets require an extra HTTP round-trip and create a CDN dependency. Use the inline `<style>` string as decided.
- **Applying `transform` or `filter` to `div#leaidear-root`:** This creates a stacking context that breaks `position: fixed` inside the shadow root.
- **Importing from `@/lib/*` in `src/widget/index.ts`:** These are Next.js server modules. esbuild will fail or produce broken output.
- **Using `new EventSource()` or standard SSE `data:` parsing:** The server sends plain NDJSON lines, not standard SSE format.
- **Forgetting to wrap `localStorage` calls in try/catch:** Private browsing mode throws `SecurityError` on localStorage access.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript stripping | Custom tsc compile step | esbuild native TS support | esbuild handles TS natively; no tsc transpile step needed |
| CSS isolation | Iframe | Shadow DOM | Shadow DOM is lighter, same-origin, no resize complexity |
| NDJSON stream parsing | Home-grown streaming parser | The buffer-split-parse pattern (already proven in tests/helpers/stream.ts) | Chunk boundaries require careful buffering; the pattern is tested |
| Session ID generation | Custom UUID impl | `crypto.randomUUID()` (browser API) | Available in all modern browsers; no library needed |

**Key insight:** The widget is intentionally zero-dependency. The only tool needed beyond browser APIs is esbuild, which is already installed.

---

## Common Pitfalls

### Pitfall 1: document.currentScript Is Null After First Async Boundary
**What goes wrong:** Widget reads `data-token` inside an async init function and gets `null` for the script element, causing the widget to silently fail with no token.
**Why it happens:** `document.currentScript` is reset to `null` as soon as script execution yields to the event loop.
**How to avoid:** Capture `const _script = document.currentScript` as the absolute first line of the IIFE body, before any `async`, `fetch`, `Promise`, or `setTimeout`.
**Warning signs:** Widget initializes but has empty token; `_apiBase` is empty string.

### Pitfall 2: Chunk-Boundary NDJSON Split
**What goes wrong:** A `{"event":"token","text":"Hello"}` line arrives split across two `read()` calls, e.g., `{"event":"tok` in chunk 1 and `en","text":"Hello"}\n` in chunk 2. Parsing chunk 1 immediately throws a JSON parse error.
**Why it happens:** TCP/HTTP chunks do not align with logical message boundaries.
**How to avoid:** Use the buffer-accumulate-split-parse pattern shown in Pattern 4. Always keep the last incomplete segment in the buffer.
**Warning signs:** Intermittent "unexpected end of JSON input" errors in the widget console.

### Pitfall 3: position:fixed Broken by Transformed Ancestor
**What goes wrong:** A host page with `transform: translateX(0)` on `<body>` or any ancestor of `div#leaidear-root` causes the fixed-position bubble and panel to be positioned relative to that transformed ancestor instead of the viewport.
**Why it happens:** CSS spec: `position: fixed` is relative to the nearest ancestor that has a transform/filter/perspective.
**How to avoid:** Keep `div#leaidear-root` as a plain `<div>` with no styles applied to it. The shadow host itself must be unstyled.
**Warning signs:** Bubble appears in wrong position; bug is host-page-specific.

### Pitfall 4: localStorage Throws in Private Browsing
**What goes wrong:** `localStorage.setItem(...)` or `localStorage.getItem(...)` throws `SecurityError` in private/incognito mode in some browsers (Safari in particular).
**Why it happens:** Safari blocks localStorage in private mode entirely.
**How to avoid:** Wrap all localStorage calls in try/catch. Treat missing/failed session storage as a new session.
**Warning signs:** Widget crashes on first message in Safari private mode.

### Pitfall 5: Double Widget Init
**What goes wrong:** GTM fires the widget script twice (e.g., tag fires on multiple triggers) causing two bubbles to appear.
**Why it happens:** GTM can fire a tag multiple times if configured with multiple triggers.
**How to avoid:** Guard init with `if (document.getElementById('leaidear-root')) return` as the first thing `init()` does after the currentScript capture.
**Warning signs:** Two bubbles visible; two parallel SSE connections per message.

### Pitfall 6: CORS on API Calls
**What goes wrong:** Widget hosted on `customer.com` calls `/api/chat/[token]` on `voiceops.skale.club` and the browser blocks with CORS error.
**Why it happens:** The widget auto-detects its origin from `<script src>`. If the script is served from the platform domain (not a CDN or customer domain), the API is same-origin and CORS is not an issue. The CONTEXT.md white-label scenario (serving widget.js from a custom domain) would require CORS headers on the chat API.
**How to avoid for Phase 4:** The widget.js is served from `public/widget.js` on the platform domain. Visitors on third-party host pages will make cross-origin fetch calls to the platform domain. The Next.js route at `/api/chat/[token]` must return `Access-Control-Allow-Origin: *` (or the widget's origin) and `Access-Control-Allow-Methods: POST`. **This is a blocking requirement** — without it, the widget cannot send messages from third-party host pages.
**Warning signs:** Console shows "CORS policy: No 'Access-Control-Allow-Origin' header"; no messages can be sent.

### Pitfall 7: Existing widget-asset.test.ts Will Fail After esbuild Replaces Stub
**What goes wrong:** The test at `tests/widget-asset.test.ts` checks `content.toContain('// Leaidear widget')` — this comment is in the Phase 1 stub. After esbuild outputs minified production JS, the comment is stripped.
**Why it happens:** esbuild `--minify` removes all comments.
**How to avoid:** Wave 0 of this phase must update `widget-asset.test.ts` to assert the output file exists and is non-empty (or contains a widget-specific identifier like the function name or the `leaidear` string that survives minification, such as `leaidear-root` or `leaidear_`).
**Warning signs:** `widget-asset.test.ts` turns RED after first `build:widget` run.

---

## Code Examples

### Complete Widget Init Skeleton

```typescript
// Source: MDN currentScript + Shadow DOM patterns
// src/widget/index.ts

// --- 1. Capture script reference SYNCHRONOUSLY (must be first) ---
const _script = document.currentScript as HTMLScriptElement | null
const _token = _script?.dataset.token ?? ''
const _apiBase = _script?.src ? new URL(_script.src).origin : location.origin

// --- 2. Guard against double-init ---
if (!_token || document.getElementById('leaidear-root')) {
  // No token = misconfigured; already exists = already inited
} else {
  initWidget(_token, _apiBase)
}

function initWidget(token: string, apiBase: string): void {
  // 3. Create shadow host
  const host = document.createElement('div')
  host.id = 'leaidear-root'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  // 4. Inject styles
  const style = document.createElement('style')
  style.textContent = CSS  // full CSS string constant
  shadow.appendChild(style)

  // 5. Build UI
  const bubble = buildBubble(shadow, token, apiBase)
  shadow.appendChild(bubble)

  // 6. First-load pulse if no stored session
  const storedSession = readSession(token)
  if (!storedSession) {
    bubble.classList.add('leaidear-pulse')
  }
}
```

### SSE Fetch + NDJSON Parse

```typescript
// Source: tests/helpers/stream.ts (proven pattern, Phase 3 GREEN)
async function sendMessage(
  apiBase: string,
  token: string,
  message: string,
  sessionId: string | null,
  onEvent: (evt: Record<string, unknown>) => void
): Promise<void> {
  const res = await fetch(`${apiBase}/api/chat/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
  })

  if (!res.ok || !res.body) {
    onEvent({ event: 'error', status: res.status })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const t = part.trim()
      if (!t) continue
      try { onEvent(JSON.parse(t) as Record<string, unknown>) } catch { /* skip */ }
    }
  }
  if (buffer.trim()) {
    try { onEvent(JSON.parse(buffer.trim()) as Record<string, unknown>) } catch { /* skip */ }
  }
}
```

### CORS Headers on the Chat API Route

The current `src/app/api/chat/[token]/route.ts` does NOT add CORS headers. This must be addressed in Wave 0 or Wave 1 of Phase 4. The route needs:

```typescript
// Add to POST handler return and OPTIONS handler:
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// OPTIONS handler for preflight:
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// In the POST handler, spread CORS_HEADERS into every Response:
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...CORS_HEADERS,
  },
})
```

---

## SSE Wire Format Reference

Exact bytes emitted by `src/lib/chat/stream.ts` (Phase 3):

```
{"event":"session","sessionId":"<uuid>"}\n
{"event":"token","text":"Hello"}\n
{"event":"token","text":" world"}\n
{"event":"tool_call","name":"get_availability"}\n
{"event":"done"}\n
```

- Each line: JSON object + `\n`
- No `data:` prefix
- No blank-line separators
- No standard SSE field names
- Widget must parse with NDJSON approach, NOT `EventSource`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build step (esbuild) | Yes | v25.6.0 | — |
| esbuild | `npm run build:widget` | Yes | 0.27.0 | — |
| TypeScript | `src/widget/index.ts` type checking | Yes | ^5 | — |
| Vitest | Widget tests | Yes | ^4.1.2 | — |

**No missing dependencies.** esbuild is confirmed at `node_modules/esbuild` version 0.27.0.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (environment: 'node') |
| Quick run command | `npx vitest run tests/widget-asset.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIDGET-01 | widget.js is a non-empty browser JS file after build | build smoke | `npx vitest run tests/widget-asset.test.ts` | ✅ (needs update) |
| WIDGET-02 | Script tag attributes readable without async boundary issues | unit | `npx vitest run tests/widget.test.ts` | ❌ Wave 0 |
| WIDGET-03 | Shadow DOM bubble + panel render correctly | unit (jsdom) | `npx vitest run tests/widget.test.ts` | ❌ Wave 0 |
| WIDGET-04 | data-token attribute is read and passed to API calls | unit | `npx vitest run tests/widget.test.ts` | ❌ Wave 0 |
| WIDGET-05 | POST to chat API is unauthenticated; sessionId from localStorage | unit + integration | `npx vitest run tests/widget.test.ts` | ❌ Wave 0 |

### Testing Approach for Browser Widget in Vitest (node environment)

The existing Vitest config uses `environment: 'node'`, not jsdom. Three options for widget testing:

1. **Simple HTML test page (preferred for Phase 4):** Create `public/widget-test.html` that loads the built `widget.js` with a test token. Manual smoke test — open in browser. No Vitest needed for UI behavior.

2. **Vitest with jsdom:** Add `environment: 'jsdom'` to a specific test file via inline config comment `// @vitest-environment jsdom`. Vitest supports per-file environment overrides. This enables programmatic DOM testing without a browser.

3. **Build output assertion (existing pattern):** Keep `widget-asset.test.ts` but update it to assert the built file exists and contains widget-specific strings that survive minification (e.g., the `leaidear` namespace string `leaidear_`).

**Recommendation:** Wave 0 adds `tests/widget.test.ts` with jsdom environment for unit-level assertions (token extraction logic, session storage read/write, SSE event dispatch). The HTML test page is the integration smoke test run manually.

### Sampling Rate

- **Per task commit:** `npx vitest run tests/widget-asset.test.ts tests/widget.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + manual browser smoke test before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/widget.test.ts` — new test file with `// @vitest-environment jsdom` covering WIDGET-02 through WIDGET-05
- [ ] `tests/widget-asset.test.ts` — update existing test: remove `toContain('// Leaidear widget')` assertion (comment stripped by minify); add assertion that file is non-empty and contains `leaidear` string (which survives minification as part of CSS class names and localStorage key)
- [ ] `public/widget-test.html` — manual integration smoke test page (not a Vitest file)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| iframe embed | Shadow DOM | ~2020 (Chrome 53+) | Same-origin, no resize hacks, cleaner isolation |
| Vanilla SSE (EventSource) | fetch + ReadableStream for POST SSE | N/A — EventSource never supported POST | Enables POST body with message + sessionId |
| Global CSS injection | Shadow DOM `<style>` element | ~2019 | Zero host-site CSS conflict |
| document.write embed | async `<script>` + init() | ~2010 | GTM-compatible; non-blocking |

**Deprecated/outdated:**
- `document.write()` for widget injection: blocks parser, not GTM-compatible
- `ShadowRoot.adoptedStyleSheets` with `CSSStyleSheet()`: more complex, identical result for single-instance widget; `<style>` element approach is simpler and equally valid

---

## Open Questions

1. **CORS on `/api/chat/[token]`**
   - What we know: The route returns no CORS headers. The widget will make cross-origin POST requests from third-party host pages.
   - What's unclear: Whether Next.js on Vercel Hobby adds any default CORS headers.
   - Recommendation: Add explicit CORS headers to the route in Wave 1. Treat this as a blocking requirement, not optional polish. Add an OPTIONS handler for preflight.

2. **`build:widget` as part of `npm run build` (Claude's Discretion)**
   - What we know: Running `build:widget` separately means the artifact could be stale after code changes.
   - What's unclear: Whether Vercel build pipeline should chain `build:widget` into the Next.js build.
   - Recommendation: Add `"build": "npm run build:widget && next build"` so the widget is always rebuilt before deployment. The build:widget step is fast (~100ms with esbuild) and adds negligible CI time.

3. **jsdom Support for Shadow DOM APIs**
   - What we know: jsdom has partial Shadow DOM support. `attachShadow` and shadow root DOM manipulation are available in recent versions. The full CSS animation and rendering behavior is NOT simulated.
   - What's unclear: Whether `localStorage`, `fetch`, and `ReadableStream` are available in jsdom for widget unit tests.
   - Recommendation: Test the pure logic (token extraction, session read/write, SSE event dispatch) in jsdom. Do NOT attempt to test CSS animations or visual output in Vitest. Use the manual HTML test page for visual validation.

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies to Phase 4 |
|-----------|-------------------|
| Always run `npm run build` after changes to catch type errors | Yes — run after implementing widget source |
| Server components by default; client components use 'use client' | Not applicable — widget is not Next.js React |
| Forms use react-hook-form + zod | Not applicable — widget uses plain HTML input |
| Toasts use sonner | Not applicable — widget has its own error UI |
| Never edit old migrations; add new ones | Not applicable — no DB changes in Phase 4 |
| `src/lib/crypto.ts` — do not change encryption format | Respected — widget does not touch crypto |
| `src/app/api/vapi/` — keep webhook handlers fast and Node.js-compatible | Respected — only change is to `/api/chat/[token]` |
| Canonical production origin: `https://voiceops.skale.club` | Used in CORS example; widget auto-detects, does not hardcode |
| Runtime: Node.js for dashboard pages and API routes | `/api/chat/[token]` already has `export const runtime = 'nodejs'` |

---

## Sources

### Primary (HIGH confidence)
- MDN Web Docs — [Document.currentScript](https://developer.mozilla.org/en-US/docs/Web/API/Document/currentScript) — async/null behavior
- MDN Web Docs — [Using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM) — attachShadow pattern
- MDN Web Docs — [ReadableStreamDefaultReader.read()](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader/read) — stream consumer pattern
- esbuild official API — [esbuild.github.io/api](https://esbuild.github.io/api/) — IIFE format, platform, bundle flags
- `tests/helpers/stream.ts` (project source) — NDJSON buffer-split-parse pattern, confirmed GREEN
- `src/lib/chat/stream.ts` (project source) — exact wire format: `JSON.stringify(obj) + '\n'`
- `node_modules/esbuild/package.json` — confirmed version 0.27.0 installed

### Secondary (MEDIUM confidence)
- [Embeddable community — Z-index & Shadow DOM](https://community.embeddable.com/t/z-index-shadow-dom-how-stacking-works/146) — fixed positioning behavior inside shadow root
- [WICG/webcomponents issue #672](https://github.com/WICG/webcomponents/issues/672) — shadow DOM stacking context behavior
- [webpack/webpack issue #10510](https://github.com/webpack/webpack/issues/10510) — currentScript null in async chunks, workaround pattern

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — esbuild version directly verified; no new deps required
- Architecture: HIGH — patterns verified against project's own proven stream helper and MDN official docs
- Pitfalls: HIGH — CORS gap and currentScript capture rule verified against MDN; chunk boundary issue verified against project test helper
- Test approach: MEDIUM — jsdom Shadow DOM support not fully verified; manual HTML page is the reliable integration path

**Research date:** 2026-04-04
**Valid until:** 2026-07-04 (stable APIs — Shadow DOM, esbuild IIFE, fetch/ReadableStream are stable)
