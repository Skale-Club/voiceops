---
phase: 4
slug: widget-embed-script
status: draft
shadcn_initialized: false
preset: not applicable
created: 2026-04-04
---

# Phase 4 — UI Design Contract

> Visual and interaction contract for the embedded chat widget. This widget renders inside a Shadow DOM using inline CSS only. Tailwind, shadcn, and the host site's styles are fully isolated — every value in this contract is a literal CSS value injected as a string into the shadow root.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (inline CSS string in Shadow DOM) |
| Preset | not applicable |
| Component library | none — pure vanilla TypeScript |
| Icon library | inline SVG (no external icon library) |
| Font | system-ui, -apple-system, sans-serif (inherits nothing from host) |

**Rationale:** The widget must work on any host site regardless of framework or design system. All styles are delivered as a single inline `<style>` element injected into the shadow root at init. No external CSS files, no CDN dependencies.

**Note on shadcn:** The main dashboard uses shadcn/ui with base color `neutral` and `cssVariables: true`. The widget does NOT use these tokens — it defines its own parallel inline token set below. Phase 5's admin preview panel (which renders inside the dashboard) will use shadcn components.

---

## Spacing Scale

Declared values (multiples of 4 only):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, dot spacing in typing indicator |
| sm | 8px | Message bubble inner padding (vertical), input field padding (vertical) |
| md | 16px | Message bubble inner padding (horizontal), chat panel padding, send button padding |
| lg | 24px | Gap between consecutive messages from different senders |
| xl | 32px | Chat panel bottom offset from viewport edge |
| 2xl | 48px | Not used in widget |
| 3xl | 64px | Not used in widget |

Exceptions:
- Floating bubble: 56px diameter (touch-target minimum — not on 8-point scale by design; nearest accessible size above 44px that fits a chat icon at 24px)
- Bubble position offset from corner: 20px from right edge, 20px from bottom edge
- Message gap (same sender, consecutive): 4px (xs)
- Message gap (sender change): 12px (between sm and md — deliberate compact choice)
- Typing dots container: 12px vertical padding to match assistant message bubble height

---

## Typography

All font values are declared as literal CSS. The widget never inherits from the host site.

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Body / message text | 14px | 400 (normal) | 1.5 | User and assistant message content |
| Label / header | 14px | 600 (semibold) | 1.2 | Chat panel header — bot display name |
| Input | 14px | 400 (normal) | 1.4 | Message input field text |
| Timestamp / meta | 11px | 400 (normal) | 1.0 | Timestamp text (if shown) — secondary |

**Font stack (inline CSS):**
```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Sizing rationale:** 14px body is appropriate for a compact chat widget. Larger sizes waste panel space. No heading sizes needed — the panel header uses label weight only.

---

## Color

The widget ships with neutral/professional defaults. Phase 5 admin config will allow per-org override of `accent` (bubble color, send button, user message bubble). The contract below is the Phase 4 default before any admin config is applied.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#ffffff` | Chat panel background, input area background |
| Secondary (30%) | `#f4f4f5` | Assistant message bubble background, panel header background |
| Accent (10%) | `#18181b` | Floating bubble background, send button background, user message bubble background |
| Accent foreground | `#ffffff` | Text and icon on accent-colored surfaces |
| Foreground | `#09090b` | All primary text (user message text, assistant message text, input text) |
| Muted foreground | `#71717a` | Timestamp text, placeholder text in input |
| Border | `#e4e4e7` | Panel border, input field border, header bottom border |
| Destructive | `#ef4444` | Error state message text |
| Shadow | `rgba(0,0,0,0.12)` | Chat panel drop shadow, bubble drop shadow |

Accent reserved for: floating bubble background, send button background, user message bubble background only.

**White-label note:** `accent` (#18181b) and `accent foreground` (#ffffff) are the two values Phase 5 admin config will expose as a single color picker. The neutral-dark default ensures contrast compliance on any host page color.

---

## Component Inventory

These are the visual elements the widget renders inside the Shadow DOM. No shadcn components — each is a plain HTML element with inline-CSS class.

### 1. Floating Bubble

| Property | Value |
|----------|-------|
| Shape | Circle — `border-radius: 50%` |
| Size | 56px × 56px |
| Background | accent (#18181b) |
| Icon | Chat icon — inline SVG, 24px × 24px, fill `#ffffff` |
| Position | `position: fixed; bottom: 20px; right: 20px; z-index: 2147483647` |
| Shadow | `box-shadow: 0 4px 16px rgba(0,0,0,0.18)` |
| Cursor | `pointer` |
| Transition | `transform 200ms ease` |
| Hover state | `transform: scale(1.06)` |
| Active state | `transform: scale(0.96)` |

**Open/close toggle:** When the panel is open, the bubble icon switches from chat SVG to a close (X) SVG using the same 24px inline SVG. No separate close button outside the bubble. Icon swap is instantaneous (no fade needed).

**Welcome pulse (first load only):** On the very first page load (no existing sessionId in localStorage), apply a single attention-seeking pulse:
```css
@keyframes leaidear-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(24,24,27,0.35); }
  70%  { box-shadow: 0 0 0 12px rgba(24,24,27,0); }
  100% { box-shadow: 0 0 0 0 rgba(24,24,27,0); }
}
```
Animation: `leaidear-pulse 1.4s ease-out 1.2s 2 both`. Runs twice, then stops. Does NOT loop.

### 2. Chat Panel

| Property | Value |
|----------|-------|
| Width | 360px |
| Height | 520px |
| Position | `position: fixed; bottom: 88px; right: 20px; z-index: 2147483646` |
| Background | #ffffff |
| Border | `1px solid #e4e4e7` |
| Border radius | 12px |
| Shadow | `box-shadow: 0 8px 32px rgba(0,0,0,0.12)` |
| Open animation | `transform: scale(0.95) translateY(8px)` → `scale(1) translateY(0)` + `opacity: 0` → `1`, duration 200ms ease |
| Close animation | reverse of open, 160ms ease |
| Overflow | hidden (panel clips content at rounded corners) |

**Panel layout (top to bottom):**
1. Header bar — 52px height
2. Message list — fills remaining height, `overflow-y: auto`
3. Input area — 56px height, fixed at bottom

### 3. Panel Header

| Property | Value |
|----------|-------|
| Height | 52px |
| Background | #f4f4f5 |
| Border bottom | `1px solid #e4e4e7` |
| Padding | 0 16px |
| Layout | flex, align-items center, gap 10px |
| Avatar | 28px circle, background accent (#18181b), initial letter of bot name in 11px semibold #ffffff |
| Bot name text | 14px, weight 600, color #09090b |

Bot display name default: `"AI Assistant"`. Phase 5 admin config overrides this. Widget fetches the name from a config API response at init (Phase 5 concern) — Phase 4 hardcodes `"AI Assistant"`.

### 4. Message List

| Property | Value |
|----------|-------|
| Padding | 16px |
| Gap between messages (same sender) | 4px |
| Gap between messages (sender change) | 12px |
| Scroll behavior | `scroll-behavior: smooth` on new message append |
| Background | #ffffff |

**User message bubble:**
- Align: right (`display: flex; justify-content: flex-end`)
- Background: accent (#18181b)
- Text color: #ffffff
- Padding: 8px 16px
- Border radius: 16px 16px 4px 16px (sharp bottom-right corner)
- Max width: 75% of panel width (270px)
- Font: 14px, weight 400, line-height 1.5
- Word wrap: `word-break: break-word`

**Assistant message bubble:**
- Align: left (`display: flex; justify-content: flex-start`)
- Background: #f4f4f5
- Text color: #09090b
- Padding: 8px 16px
- Border radius: 16px 16px 16px 4px (sharp bottom-left corner)
- Max width: 75% of panel width (270px)
- Font: 14px, weight 400, line-height 1.5
- Word wrap: `word-break: break-word`

**Timestamp display:** NOT shown per message. Timestamps add visual clutter in a compact widget. No timestamp copy in this phase.

### 5. Typing Indicator

Shown from the moment the `fetch()` call is initiated until the `done` SSE event fires. This covers both normal token streaming wait and tool_call latency.

| Property | Value |
|----------|-------|
| Container | Same layout as assistant message bubble (left-aligned) |
| Background | #f4f4f5 |
| Padding | 12px 16px |
| Border radius | 16px 16px 16px 4px |
| Layout | flex, align-items center, gap 4px |
| Dot size | 7px × 7px circle |
| Dot color | #71717a |

**Dot animation:**
```css
@keyframes leaidear-dot-pulse {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30%            { opacity: 1;    transform: translateY(-4px); }
}
```
- Dot 1: `animation: leaidear-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0s`
- Dot 2: `animation: leaidear-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.2s`
- Dot 3: `animation: leaidear-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.4s`

### 6. Input Area

| Property | Value |
|----------|-------|
| Height | 56px |
| Background | #ffffff |
| Border top | `1px solid #e4e4e7` |
| Padding | 8px 12px |
| Layout | flex, align-items center, gap 8px |

**Text input field:**
- Flex: 1 (fills available width)
- Height: 36px
- Background: #f4f4f5
- Border: `1px solid #e4e4e7`
- Border radius: 18px (fully rounded — pill shape)
- Padding: 0 14px
- Font: 14px, weight 400, line-height 1.4, color #09090b
- Placeholder color: #71717a
- Outline: none on focus (use border color change instead)
- Focus border: `1px solid #a1a1aa`
- Disabled state (while awaiting response): `opacity: 0.5; pointer-events: none`

**Send button:**
- Size: 36px × 36px, circle (`border-radius: 50%`)
- Background: accent (#18181b)
- Icon: send/arrow SVG, 16px × 16px, fill #ffffff, inline SVG
- Border: none
- Cursor: pointer
- Disabled state (input empty OR awaiting response): `background: #d4d4d8; cursor: default`
- Hover (enabled): `background: #3f3f46`
- Active (enabled): `background: #52525b`
- Transition: `background 150ms ease`

**Send trigger:** Both button click and Enter key (without Shift). Shift+Enter inserts a newline. Input is a single-line `<input type="text">` in Phase 4 (not `<textarea>`) — no multi-line needed until explicitly required.

---

## Interaction States

| State | Trigger | Visual |
|-------|---------|--------|
| Panel closed | Initial load | Only floating bubble visible |
| Panel opening | Bubble click (closed) | Panel animates in (200ms scale+fade), bubble icon → X |
| Panel open | After opening | Panel + message list + input visible |
| Panel closing | Bubble click (open) | Panel animates out (160ms), bubble icon → chat |
| Sending | User submits message | User bubble appears, typing indicator appears, input disabled |
| Receiving | SSE streaming | Typing indicator remains, input stays disabled |
| Response received | `done` SSE event | Typing indicator removed, assistant bubble appears with full text, input re-enabled, input cleared |
| Error | Network fail or non-2xx response | Error message shown as assistant bubble (see Copywriting) |
| Input empty | No text typed | Send button disabled (#d4d4d8) |
| Input has text | Any character present | Send button enabled (#18181b) |

---

## Welcome / Empty State

Shown when the panel opens for the first time and there are no messages (empty message list).

| Element | Specification |
|---------|---------------|
| Layout | Centered vertically in the message list area |
| Bot avatar | 44px circle, background accent (#18181b), initial letter 16px semibold #ffffff |
| Heading | `"Hi! How can I help?"` — 14px, weight 600, color #09090b, text-align center |
| Body | `"Ask me anything — I'm here to help."` — 14px, weight 400, color #71717a, text-align center |
| Spacing | 12px gap between avatar, heading, and body |

Once the first message is sent, the empty state is replaced by the message list. It does not reappear within the same session.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Bot display name (default) | `AI Assistant` |
| Bubble aria-label (open) | `Open chat` |
| Bubble aria-label (close) | `Close chat` |
| Panel header | `{bot display name}` (default: `AI Assistant`) |
| Input placeholder | `Type a message…` |
| Send button aria-label | `Send message` |
| Empty state heading | `Hi! How can I help?` |
| Empty state body | `Ask me anything — I'm here to help.` |
| Network error | `Something went wrong. Please try again.` |
| 401 / token error | `This chat is unavailable right now.` |
| Generic error | `Something went wrong. Please try again.` |
| Typing indicator aria-label | `AI is typing` |

No destructive actions in Phase 4. No confirmation dialogs.

---

## Animation Summary

| Animation | Duration | Easing | Trigger |
|-----------|----------|--------|---------|
| Panel open | 200ms | ease | Bubble click (panel closed) |
| Panel close | 160ms | ease | Bubble click (panel open) |
| Bubble hover scale | 200ms | ease | `mouseenter` on bubble |
| Bubble active scale | immediate | — | `mousedown` on bubble |
| Welcome pulse (first load) | 1.4s × 2 runs, delay 1.2s | ease-out | Page load, no stored session |
| Typing dot bounce | 1.2s, infinite | ease-in-out | Typing indicator visible |
| Send button background | 150ms | ease | Hover/active/disabled state changes |

All animations use `prefers-reduced-motion` guard:
```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```
This block is injected into the shadow root alongside all other styles.

---

## Accessibility Contract

| Requirement | Implementation |
|-------------|---------------|
| Bubble keyboard access | `tabindex="0"`, responds to Enter and Space keys |
| Panel focus trap | When panel is open, Tab cycles within panel only |
| First focus on open | Input field receives focus when panel opens |
| ARIA role on panel | `role="dialog"` with `aria-label="Chat"` |
| ARIA live region | Message list has `aria-live="polite"` — new messages announced |
| Typing indicator | `aria-label="AI is typing"` on indicator container |
| Send button | `aria-label="Send message"`, `aria-disabled` when disabled |
| Color contrast | All text/background pairs meet WCAG AA (4.5:1 for 14px body) |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none (widget uses no shadcn components) | not applicable |
| third-party | none | not applicable |

The widget is 100% inline — no component registry entries, no npm packages beyond esbuild (already in toolchain), no external scripts.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
