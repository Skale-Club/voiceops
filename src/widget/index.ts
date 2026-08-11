// src/widget/index.ts
// Opps embeddable chat widget | standalone vanilla TypeScript, no React/Next.js imports
import { WIDGET_THEME as T } from './theme'
import {
  horizontalAnchor,
  normalizeWidgetOffset,
  normalizeWidgetPosition,
  verticalAnchor,
  WIDGET_OFFSET_DEFAULT,
  WIDGET_POSITION_DEFAULT,
  type WidgetPosition,
} from '../lib/widget/position'

interface WidgetConfig {
  displayName: string
  primaryColor: string
  welcomeMessage: string
  greetingEnabled: boolean
  greetingMessage: string
  greetingDelaySeconds: number
  position: WidgetPosition
  offsetX: number
  offsetY: number
}

const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
  greetingEnabled: true,
  greetingMessage: 'Hi! How can I help?',
  greetingDelaySeconds: 3,
  position: WIDGET_POSITION_DEFAULT,
  offsetX: WIDGET_OFFSET_DEFAULT,
  offsetY: WIDGET_OFFSET_DEFAULT,
}

// --- CSS constant (inline string, full UI-SPEC values) ---
const WIDGET_CSS = `
/* Theme */
:host {
  --opps-primary-color: #18181B;

  /* --- Placement -----------------------------------------------------------
     The host carries data-vpos (top|middle|bottom) and data-hpos (left|right),
     set at runtime from the org's widget settings. The offsets are the gap from
     the two screen edges the bubble hugs. Defaults reproduce the historical
     hardcoded bottom-right / 20px placement exactly. */
  --opps-offset-x: 20px;
  --opps-offset-y: 20px;
  /* How far the panel and greeting must clear the bubble: 56px + 12px gap. */
  --opps-lead: 68px;
  /* Transform-origin halves, so one rule serves all six anchors. */
  --opps-origin-y: bottom;
  --opps-origin-x: right;
  /* Self-centering shift for the greeting pill, and the slide direction of the
     panel open/close animation. Both flip with the vertical anchor and are read
     from inside @keyframes, which resolves them per-element. */
  --opps-greet-shift: 50%;
  --opps-panel-shift: 20px;
}
:host([data-vpos="top"])    { --opps-origin-y: top;    --opps-greet-shift: -50%; --opps-panel-shift: -20px; }
:host([data-vpos="middle"]) { --opps-origin-y: center; --opps-greet-shift: -50%; }
:host([data-hpos="left"])   { --opps-origin-x: left; }

/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Animations */
@keyframes opps-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(24,24,27,0.35); }
  70%  { box-shadow: 0 0 0 12px rgba(24,24,27,0); }
  100% { box-shadow: 0 0 0 0 rgba(24,24,27,0); }
}
@keyframes opps-dot-pulse {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30%            { opacity: 1;    transform: translateY(-4px); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

/* Bubble */
.opps-bubble {
  position: fixed;
  z-index: 2147483647;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  transition: transform 200ms ease;
}
.opps-bubble:hover { transform: scale(1.06); }
.opps-bubble:active { transform: scale(0.96); }
.opps-bubble.opps-pulse {
  animation: opps-pulse 1.4s ease-out 1.2s 2 both;
}

/* --- Anchoring -------------------------------------------------------------
   Every fixed element resolves its two edges from the host's data-vpos/data-hpos.
   The middle anchors center on the viewport rather than an edge, so
   widget_offset_y has no effect there (the settings UI disables it to match).
   The bubble is centered by offsetting half its height (28px) instead of a
   translate, so :hover/:active keep sole ownership of transform. */
:host([data-hpos="right"]) .opps-bubble,
:host([data-hpos="right"]) .opps-panel { right: var(--opps-offset-x); left: auto; }
:host([data-hpos="left"])  .opps-bubble,
:host([data-hpos="left"])  .opps-panel { left: var(--opps-offset-x); right: auto; }

:host([data-vpos="bottom"]) .opps-bubble { bottom: var(--opps-offset-y); top: auto; }
:host([data-vpos="top"])    .opps-bubble { top: var(--opps-offset-y); bottom: auto; }
:host([data-vpos="middle"]) .opps-bubble { top: calc(50% - 28px); bottom: auto; }

/* The panel clears the bubble on the side the anchor leaves free. */
:host([data-vpos="bottom"]) .opps-panel {
  bottom: calc(var(--opps-offset-y) + var(--opps-lead));
  top: auto;
  max-height: calc(100vh - var(--opps-offset-y) - var(--opps-lead) - 20px);
}
:host([data-vpos="top"]) .opps-panel {
  top: calc(var(--opps-offset-y) + var(--opps-lead));
  bottom: auto;
  max-height: calc(100vh - var(--opps-offset-y) - var(--opps-lead) - 20px);
}
:host([data-vpos="middle"]) .opps-panel {
  top: max(12px, calc(50% - var(--opps-panel-h) / 2));
  bottom: auto;
  max-height: calc(100vh - 24px);
}

/* Panel */
.opps-panel {
  position: fixed;
  z-index: 2147483646;
  width: 360px;
  /* Mirrored into a var so the middle anchor can center on the real height. */
  --opps-panel-h: 520px;
  height: var(--opps-panel-h);
  background: ${T.panelBg};
  border: 1px solid ${T.borderColor};
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transform-origin: var(--opps-origin-y) var(--opps-origin-x);
  transition: width 240ms cubic-bezier(0.2,0,0,1), height 240ms cubic-bezier(0.2,0,0,1);
}
.opps-panel[aria-hidden="true"] {
  display: none;
}
/* Expanded (desktop): a bit larger, still on the org's anchor. The max-height
   comes from the anchor rules above, which know the offsets. */
.opps-panel.opps-expanded {
  width: 420px;
  --opps-panel-h: 680px;
}
/* Mobile: expanded = fullscreen. Selector is host-qualified so it outranks the
   :host([data-vpos]) anchor rules above and can pin all four edges to 0. */
@media (max-width: 640px) {
  :host([data-vpos]) .opps-panel.opps-expanded {
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    --opps-panel-h: 100%;
    max-height: 100%;
    border-radius: 0;
    border: none;
  }
}
.opps-panel-opening {
  animation: opps-panel-open 320ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.opps-panel-closing {
  animation: opps-panel-close 220ms cubic-bezier(0.36, 0, 0.66, -0.3) forwards;
}
@keyframes opps-panel-open {
  from { opacity: 0; transform: scale(0.82) translateY(var(--opps-panel-shift)); }
  to   { opacity: 1; transform: scale(1)    translateY(0);                       }
}
@keyframes opps-panel-close {
  from { opacity: 1; transform: scale(1)    translateY(0);                       }
  to   { opacity: 0; transform: scale(0.82) translateY(var(--opps-panel-shift)); }
}

/* Bubble icon flip animation on toggle */
.opps-bubble-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
              opacity   180ms ease;
}
.opps-bubble-icon.opps-icon-entering {
  animation: opps-icon-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes opps-icon-in {
  from { transform: rotate(-90deg) scale(0.6); opacity: 0; }
  to   { transform: rotate(0deg)   scale(1);   opacity: 1; }
}

/* Greeting composer (minimized "Write a message…" prompt) */
.opps-greeting {
  position: fixed;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  max-width: 300px;
  /* Anchored to the bubble's centerline (see rules below) and shifted half its
     own height, so the pill centers on the bubble whatever its height. */
  transform: translateY(var(--opps-greet-shift));
  transform-origin: var(--opps-origin-y) var(--opps-origin-x);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
/* The greeting sits beside the bubble, on the inward side of the anchor. */
:host([data-hpos="right"]) .opps-greeting {
  right: calc(var(--opps-offset-x) + var(--opps-lead));
  left: auto;
  align-items: flex-end;
}
:host([data-hpos="left"]) .opps-greeting {
  left: calc(var(--opps-offset-x) + var(--opps-lead));
  right: auto;
  align-items: flex-start;
}
/* 28px = half the bubble, i.e. its centerline. */
:host([data-vpos="bottom"]) .opps-greeting { bottom: calc(var(--opps-offset-y) + 28px); top: auto; }
:host([data-vpos="top"])    .opps-greeting { top: calc(var(--opps-offset-y) + 28px); bottom: auto; }
:host([data-vpos="middle"]) .opps-greeting { top: 50%; bottom: auto; }

.opps-greeting[aria-hidden="true"] { display: none; }
.opps-greeting-opening { animation: opps-greeting-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
.opps-greeting-closing { animation: opps-greeting-out 200ms ease forwards; }
@keyframes opps-greeting-in {
  from { opacity: 0; transform: translateY(calc(var(--opps-greet-shift) + 12px)) scale(0.96); }
  to   { opacity: 1; transform: translateY(var(--opps-greet-shift))              scale(1);    }
}
@keyframes opps-greeting-out {
  from { opacity: 1; transform: translateY(var(--opps-greet-shift))              scale(1);    }
  to   { opacity: 0; transform: translateY(calc(var(--opps-greet-shift) + 12px)) scale(0.96); }
}
.opps-greeting-row { position: relative; display: flex; align-items: center; }
/* Invisible hover bridge above the pill so moving the cursor up to the × keeps
   the greeting hovered (otherwise the × re-blurs before you can reach it). */
.opps-greeting-row::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -36px;
  height: 38px;
}
/* Anchored at the top of the screen there is no room above the pill, so the
   dismiss button and its hover bridge flip below it. */
:host([data-vpos="top"]) .opps-greeting-row::before { top: auto; bottom: -36px; }
.opps-greeting-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 264px;
  max-width: 72vw;
  background: ${T.inputFieldBg};
  border: 1px solid ${T.borderColor};
  border-radius: 24px;
  padding: 4px 4px 4px 16px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.opps-greeting-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: ${T.textPrimary};
  font-family: inherit;
}
.opps-greeting-input::placeholder { color: ${T.textSecondary}; }
.opps-greeting-send {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 150ms ease;
}
.opps-greeting-send:hover:not(:disabled) { opacity: 0.92; }
.opps-greeting-send:disabled { background: #d4d4d8; cursor: default; }
:host([data-vpos="top"])  .opps-greeting-close { top: auto; bottom: -28px; }
:host([data-hpos="left"]) .opps-greeting-close { left: auto; right: -7px; }
.opps-greeting-close {
  position: absolute;
  top: -28px;
  left: -7px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #2e2e2e;
  border: none;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  /* Hidden until the visitor hovers the greeting. The blur + alpha exist ONLY
     during the transition — the destination (hover) state is fully crisp. */
  opacity: 0;
  filter: blur(4px);
  pointer-events: none;
  transition: opacity 200ms ease, filter 200ms ease, background 150ms ease;
}
.opps-greeting:hover .opps-greeting-close,
.opps-greeting:focus-within .opps-greeting-close {
  opacity: 1;
  filter: blur(0);
  pointer-events: auto;
}
.opps-greeting-close:hover { background: #242424; }

/* Header */
.opps-header {
  height: 52px;
  min-height: 52px;
  background: ${T.headerBg};
  border-bottom: 1px solid ${T.borderColor};
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.opps-bot-name {
  font-size: 14px;
  font-weight: 600;
  color: ${T.textPrimary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.opps-header-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms ease;
}
.opps-header-btn:hover { background: rgba(0,0,0,0.06); }

/* Message list */
.opps-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: ${T.panelBg};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  scroll-behavior: smooth;
}

/* Empty state */
.opps-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  text-align: center;
  padding: 16px;
}
.opps-empty-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}
.opps-empty-heading {
  font-size: 14px;
  font-weight: 600;
  color: #09090b;
}
.opps-empty-body {
  font-size: 14px;
  font-weight: 400;
  color: #71717a;
  line-height: 1.5;
}

/* Message bubbles */
.opps-msg {
  display: flex;
  max-width: 75%;
  word-break: break-word;
}
.opps-msg-user {
  align-self: flex-end;
  justify-content: flex-end;
  margin-top: 12px;
}
.opps-msg-user:first-of-type { margin-top: 0; }
.opps-msg-assistant {
  align-self: flex-start;
  justify-content: flex-start;
  margin-top: 4px;
}
.opps-bubble-user {
  background: var(--opps-primary-color);
  color: #ffffff;
  padding: 8px 16px;
  border-radius: ${T.userBubbleRadius};
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.opps-bubble-assistant {
  color: ${T.textPrimary};
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  padding: 2px 4px;
}
.opps-bubble-error {
  background: #f4f4f5;
  color: #ef4444;
  padding: 8px 16px;
  border-radius: 16px 16px 16px 4px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}

/* Typing indicator */
.opps-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #f4f4f5;
  padding: 12px 16px;
  border-radius: 16px 16px 16px 4px;
  align-self: flex-start;
  margin-top: 4px;
}
.opps-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #71717a;
}
.opps-dot:nth-child(1) { animation: opps-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0s; }
.opps-dot:nth-child(2) { animation: opps-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.2s; }
.opps-dot:nth-child(3) { animation: opps-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.4s; }

/* Input area */
.opps-input-area {
  background: ${T.panelBg};
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.opps-input {
  flex: 1;
  height: 36px;
  background: ${T.inputFieldBg};
  border: 1px solid ${T.borderColor};
  border-radius: 18px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  color: ${T.textPrimary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
}
.opps-input::placeholder { color: ${T.textSecondary}; }
.opps-input:focus { border-color: #a1a1aa; }
.opps-input:disabled { opacity: 0.5; pointer-events: none; }
.opps-send {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #18181b;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms ease;
  flex-shrink: 0;
}
.opps-send:hover:not(:disabled) { opacity: 0.92; }
.opps-send:active:not(:disabled) { opacity: 0.84; }
.opps-send:disabled { background: #d4d4d8; cursor: default; }

/* Product cards (contract §6 ui/product_cards) */
.opps-cards {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  overflow-x: auto;
  padding: 8px 0 4px;
  margin-top: 4px;
  align-self: stretch;
  max-width: 100%;
}
.opps-card {
  flex: 0 0 auto;
  width: 148px;
  background: ${T.panelBg};
  border: 1px solid ${T.borderColor};
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-card-img {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
  background: ${T.inputFieldBg};
}
.opps-card-title {
  font-size: 12px;
  font-weight: 600;
  color: ${T.textPrimary};
  padding: 8px 10px 0;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.opps-card-price {
  font-size: 12px;
  font-weight: 400;
  color: ${T.textSecondary};
  padding: 2px 10px 0;
}
.opps-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px 10px;
  margin-top: auto;
}
.opps-card-view {
  font-size: 11px;
  font-weight: 500;
  color: ${T.textPrimary};
  text-decoration: none;
  border: 1px solid ${T.borderColor};
  border-radius: 6px;
  padding: 5px 8px;
  white-space: nowrap;
}
.opps-card-view:hover { background: rgba(0,0,0,0.04); }
.opps-card-add {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  background: var(--opps-primary-color);
  border: none;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 150ms ease;
}
.opps-card-add:hover { opacity: 0.92; }
.opps-card-add:active { opacity: 0.84; }
`

// --- SVG icon constants ---
const ICON_CHAT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`

const ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

const ICON_SEND = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`

const ICON_CLOSE_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

// Header expand / collapse (maximize-2 / minimize-2). Dark stroke for the light header.
const ICON_EXPAND = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
const ICON_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`

// --- Synchronous captures | MUST be before any async boundary ---
const _script = document.currentScript as HTMLScriptElement | null
const _token = _script?.dataset.token ?? ''
const _apiBase = _script?.src ? new URL(_script.src).origin : location.origin
const _contextEndpoint = _script?.dataset.contextEndpoint ?? ''

// --- Double-init guard and entry point ---
if (_token && !document.getElementById('opps-root')) {
  initWidget(_token, _apiBase, _contextEndpoint)
}

// --- Session storage helpers (D-12, D-13, Pattern 5) ---
function getStorageKey(token: string): string {
  return `opps_${token}_sessionId`
}

function readSession(token: string): string | null {
  try {
    return localStorage.getItem(getStorageKey(token))
  } catch {
    return null
  }
}

function storeSession(token: string, sessionId: string): void {
  try {
    localStorage.setItem(getStorageKey(token), sessionId)
  } catch {
    // Silent fail | private browsing mode (Safari) may throw SecurityError
  }
}

function normalizeWidgetText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function normalizePrimaryColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_WIDGET_CONFIG.primaryColor

  const trimmed = value.trim()
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed)
    ? trimmed.toUpperCase()
    : DEFAULT_WIDGET_CONFIG.primaryColor
}

function getDisplayInitial(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || DEFAULT_WIDGET_CONFIG.displayName.charAt(0)
}

/**
 * Project the org's placement settings onto the shadow host. The CSS does the
 * rest: data-vpos/data-hpos select the anchor rules, and the two offset vars
 * feed the edge gaps. Vertical spacing is dropped for the middle-* anchors
 * (viewport-centered), so a stale offsetY can't nudge a centered widget.
 */
function applyPlacement(host: HTMLElement, config: WidgetConfig): void {
  const position = normalizeWidgetPosition(config.position)
  const vpos = verticalAnchor(position)
  host.setAttribute('data-vpos', vpos)
  host.setAttribute('data-hpos', horizontalAnchor(position))
  host.style.setProperty('--opps-offset-x', `${normalizeWidgetOffset(config.offsetX)}px`)
  host.style.setProperty('--opps-offset-y', vpos === 'middle' ? '0px' : `${normalizeWidgetOffset(config.offsetY)}px`)
}

// Result of the config fetch. `blocked` is true only when the server explicitly
// denies this URL (HTTP 403 from the widget's URL rules) — the signal the widget
// uses to keep itself hidden. Any other failure falls back to defaults and shows
// the widget (fail-open on transient errors; the chat endpoint still enforces).
interface WidgetConfigResult {
  config: WidgetConfig
  blocked: boolean
}

async function fetchWidgetConfig(apiBase: string, token: string): Promise<WidgetConfigResult> {
  try {
    // Send the full page URL so the server can enforce URL rules at path level
    // (browsers strip the path from cross-origin Referer).
    const url = `${apiBase}/api/widget/${token}/config?u=${encodeURIComponent(location.href)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (response.status === 403) {
      return { config: DEFAULT_WIDGET_CONFIG, blocked: true }
    }

    if (!response.ok) {
      return { config: DEFAULT_WIDGET_CONFIG, blocked: false }
    }

    const payload = await response.json() as Record<string, unknown>

    const welcomeMessage = normalizeWidgetText(payload.welcomeMessage, DEFAULT_WIDGET_CONFIG.welcomeMessage)
    const rawDelay = typeof payload.greetingDelaySeconds === 'number' ? payload.greetingDelaySeconds : DEFAULT_WIDGET_CONFIG.greetingDelaySeconds
    return {
      config: {
        displayName: normalizeWidgetText(payload.displayName, DEFAULT_WIDGET_CONFIG.displayName),
        primaryColor: normalizePrimaryColor(payload.primaryColor),
        welcomeMessage,
        greetingEnabled: payload.greetingEnabled !== false,
        greetingMessage: normalizeWidgetText(payload.greetingMessage, welcomeMessage),
        greetingDelaySeconds: Math.max(0, Math.min(30, rawDelay)),
        position: normalizeWidgetPosition(payload.position),
        offsetX: normalizeWidgetOffset(payload.offsetX),
        offsetY: normalizeWidgetOffset(payload.offsetY),
      },
      blocked: false,
    }
  } catch {
    return { config: DEFAULT_WIDGET_CONFIG, blocked: false }
  }
}

// --- SSE event type ---
interface SSEEvent {
  event: string
  sessionId?: string
  text?: string
  name?: string
  action?: string
  cartId?: string
  itemCount?: number
  sig?: string
  component?: string
  items?: unknown[]
}

// --- SSE stream consumer (D-10, D-11, Pattern 4) ---
async function consumeStream(
  response: Response,
  onEvent: (evt: SSEEvent) => void
): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      try {
        onEvent(JSON.parse(trimmed) as SSEEvent)
      } catch {
        // Malformed line | skip
      }
    }
  }
  // Flush any remaining buffer
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as SSEEvent)
    } catch { /* skip */ }
  }
}

// --- sendMessage function ---
async function sendMessage(params: {
  apiBase: string
  token: string
  message: string
  sessionId: string | null
  commerceContext: string | null
  onEvent: (evt: SSEEvent) => void
}): Promise<void> {
  const { apiBase, token, message, sessionId, commerceContext, onEvent } = params
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/chat/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        pageUrl: location.href,
        ...(sessionId ? { sessionId } : {}),
        ...(commerceContext ? { commerce_context: commerceContext } : {}),
      }),
    })
  } catch {
    onEvent({ event: 'error' })
    return
  }

  if (!res.ok || !res.body) {
    onEvent({ event: 'error', sessionId: String(res.status) })
    return
  }

  await consumeStream(res, onEvent)
}

// --- buildPanel (creates the full chat panel DOM) ---
function buildPanel(
  shadow: ShadowRoot,
  token: string,
  apiBase: string,
  contextEndpoint: string,
  _bubble: HTMLButtonElement
): {
  panel: HTMLDivElement
  applyConfig: (config: WidgetConfig) => void
  submitMessage: (text: string) => Promise<void>
  setContext: (token: string) => void
} {
  const panel = document.createElement('div')
  panel.className = 'opps-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Chat')
  panel.setAttribute('aria-hidden', 'true')

  // Header
  const header = document.createElement('div')
  header.className = 'opps-header'
  const avatar = document.createElement('div')
  avatar.className = 'opps-avatar'
  avatar.textContent = getDisplayInitial(DEFAULT_WIDGET_CONFIG.displayName)
  const botName = document.createElement('span')
  botName.className = 'opps-bot-name'
  botName.textContent = DEFAULT_WIDGET_CONFIG.displayName

  // Expand / collapse toggle (desktop: larger panel · mobile: fullscreen)
  const headerActions = document.createElement('div')
  headerActions.className = 'opps-header-actions'
  const expandBtn = document.createElement('button')
  expandBtn.className = 'opps-header-btn'
  expandBtn.type = 'button'
  expandBtn.setAttribute('aria-label', 'Expand chat')
  expandBtn.innerHTML = ICON_EXPAND
  headerActions.appendChild(expandBtn)

  header.appendChild(avatar)
  header.appendChild(botName)
  header.appendChild(headerActions)

  let isExpanded = false
  expandBtn.addEventListener('click', () => {
    isExpanded = !isExpanded
    panel.classList.toggle('opps-expanded', isExpanded)
    expandBtn.innerHTML = isExpanded ? ICON_COLLAPSE : ICON_EXPAND
    expandBtn.setAttribute('aria-label', isExpanded ? 'Collapse chat' : 'Expand chat')
  })

  // Message list
  const msgList = document.createElement('div')
  msgList.className = 'opps-messages'
  msgList.setAttribute('aria-live', 'polite')

  // Empty state
  const emptyState = document.createElement('div')
  emptyState.className = 'opps-empty'
  const emptyAvatar = document.createElement('div')
  emptyAvatar.className = 'opps-empty-avatar'
  emptyAvatar.textContent = getDisplayInitial(DEFAULT_WIDGET_CONFIG.displayName)
  const emptyHeading = document.createElement('p')
  emptyHeading.className = 'opps-empty-heading'
  emptyHeading.textContent = DEFAULT_WIDGET_CONFIG.welcomeMessage
  const emptyBody = document.createElement('p')
  emptyBody.className = 'opps-empty-body'
  emptyBody.textContent = 'Ask me anything \u2014 I\u2019m here to help.'
  emptyState.appendChild(emptyAvatar)
  emptyState.appendChild(emptyHeading)
  emptyState.appendChild(emptyBody)
  msgList.appendChild(emptyState)

  // Input area
  const inputArea = document.createElement('div')
  inputArea.className = 'opps-input-area'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'opps-input'
  input.placeholder = 'Type a message\u2026'
  input.setAttribute('aria-label', 'Message input')
  const sendBtn = document.createElement('button')
  sendBtn.className = 'opps-send'
  sendBtn.setAttribute('aria-label', 'Send message')
  sendBtn.setAttribute('aria-disabled', 'true')
  sendBtn.disabled = true
  sendBtn.innerHTML = ICON_SEND
  inputArea.appendChild(input)
  inputArea.appendChild(sendBtn)

  panel.appendChild(header)
  panel.appendChild(msgList)
  panel.appendChild(inputArea)

  // --- State ---
  let isStreaming = false
  let sessionId: string | null = readSession(token)
  let hasMessages = false

  // --- Commerce context cache (CTX-03) ---
  // The widget only decodes the payload locally to read `exp` (unix seconds) —
  // it never verifies the HMAC and never reads cus/email client-side. The
  // server-side chat route is the trust boundary.
  let cachedToken: string | null = null
  let cachedExp = 0 // unix seconds

  function b64urlToJson(b64: string): { exp?: number } | null {
    try {
      const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
      return JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad)) as { exp?: number }
    } catch {
      return null
    }
  }

  function setContext(newToken: string): void {
    const payload = b64urlToJson(newToken.split('.')[0] ?? '')
    cachedToken = newToken
    cachedExp = typeof payload?.exp === 'number' ? payload.exp : Math.floor(Date.now() / 1000) + 60
  }

  async function ensureContext(): Promise<string | null> {
    if (!contextEndpoint) return null
    const now = Math.floor(Date.now() / 1000)
    if (cachedToken && cachedExp > now + 5) return cachedToken
    try {
      // SAME-ORIGIN against the host page (storefront) — never prefixed with
      // apiBase. The storefront mints this token from its own httpOnly cookies.
      const res = await fetch(contextEndpoint, { credentials: 'same-origin' })
      if (!res.ok) return null
      const { token: fetchedToken } = (await res.json()) as { token?: string }
      if (!fetchedToken) return null
      setContext(fetchedToken)
      return cachedToken
    } catch {
      return null // never block chat
    }
  }

  // --- Helpers ---
  function appendMessage(text: string, role: 'user' | 'assistant' | 'error'): void {
    if (!hasMessages) {
      emptyState.remove()
      hasMessages = true
    }
    const wrapper = document.createElement('div')
    wrapper.className = `opps-msg opps-msg-${role === 'user' ? 'user' : 'assistant'}`
    const bubble = document.createElement('div')
    bubble.className = role === 'error' ? 'opps-bubble-error' : `opps-bubble-${role}`
    bubble.textContent = text
    wrapper.appendChild(bubble)
    msgList.appendChild(wrapper)
    msgList.scrollTop = msgList.scrollHeight
  }

  // Renders the contract §6 ui/product_cards payload — createElement +
  // textContent + img.src + anchor ONLY, NEVER innerHTML (XSS surface on
  // host stores; product titles/prices are untrusted store data). "Add to
  // cart" routes through the existing agent send path (submitMessage), never
  // a direct store/API call.
  function renderCards(items: unknown[]): void {
    const list = items.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    if (!list.length) return
    const container = document.createElement('div')
    container.className = 'opps-cards'
    for (const it of list) {
      const card = document.createElement('div')
      card.className = 'opps-card'
      if (typeof it.thumbnail === 'string' && it.thumbnail) {
        const img = document.createElement('img')
        img.className = 'opps-card-img'
        img.src = it.thumbnail // attribute assignment, not markup
        img.alt = ''
        card.appendChild(img)
      }
      const title = document.createElement('div')
      title.className = 'opps-card-title'
      title.textContent = String(it.title ?? '') // textContent, never innerHTML
      card.appendChild(title)
      if (typeof it.price === 'string' && it.price) {
        const price = document.createElement('div')
        price.className = 'opps-card-price'
        price.textContent = it.price
        card.appendChild(price)
      }
      const actions = document.createElement('div')
      actions.className = 'opps-card-actions'
      if (typeof it.url === 'string' && it.url) {
        const view = document.createElement('a')
        view.className = 'opps-card-view'
        view.href = it.url
        view.target = '_top'
        view.rel = 'noopener'
        view.textContent = 'View'
        actions.appendChild(view)
      }
      const t = String(it.title ?? '')
      const add = document.createElement('button')
      add.className = 'opps-card-add'
      add.type = 'button'
      add.textContent = 'Add to cart'
      add.addEventListener('click', () => { void submitMessage(`Add "${t}" to my cart`) }) // existing agent path, never a direct API call
      actions.appendChild(add)
      card.appendChild(actions)
      container.appendChild(card)
    }
    msgList.appendChild(container)
    msgList.scrollTop = msgList.scrollHeight
  }

  function showTyping(): HTMLDivElement {
    const typing = document.createElement('div')
    typing.className = 'opps-typing'
    typing.setAttribute('aria-label', 'AI is typing')
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div')
      dot.className = 'opps-dot'
      typing.appendChild(dot)
    }
    msgList.appendChild(typing)
    msgList.scrollTop = msgList.scrollHeight
    return typing
  }

  function setInputEnabled(enabled: boolean): void {
    input.disabled = !enabled
    sendBtn.disabled = !enabled || input.value.trim() === ''
    sendBtn.setAttribute('aria-disabled', String(!enabled || input.value.trim() === ''))
  }

  // Core send path | called by the panel input, the greeting composer, and the
  // public JS API (window.Opps.sendMessage). Caller passes the raw text.
  async function submitMessage(rawText: string): Promise<void> {
    const text = rawText.trim()
    if (!text || isStreaming) return

    isStreaming = true
    setInputEnabled(false)
    appendMessage(text, 'user')
    const typing = showTyping()

    let tokenBuffer = ''
    let pendingCards: unknown[] = []
    const commerceContext = await ensureContext()

    await sendMessage({
      apiBase,
      token,
      message: text,
      sessionId,
      commerceContext,
      onEvent: (evt) => {
        if (evt.event === 'session' && evt.sessionId) {
          if (!sessionId) {
            sessionId = evt.sessionId
            storeSession(token, sessionId)
          }
        } else if (evt.event === 'token' && evt.text) {
          tokenBuffer += evt.text
        } else if (evt.event === 'commerce') {
          // Re-dispatch to the host page so the (frozen) storefront commerce
          // bridge can adopt/refresh the cart. Detail shape is contract §6 —
          // exact keys, do not rename.
          window.dispatchEvent(new CustomEvent('xphere:commerce', {
            detail: { action: evt.action, cartId: evt.cartId, itemCount: evt.itemCount, sig: evt.sig },
          }))
          if (evt.action === 'cart_created') {
            // Cart cookie changed server-side — force a re-fetch on the next send.
            cachedToken = null
            cachedExp = 0
          }
        } else if (evt.event === 'ui' && evt.component === 'product_cards' && Array.isArray(evt.items)) {
          // Buffer only — never render mid-stream. Flushed after 'done' below.
          pendingCards = evt.items.slice(0, 5)
        } else if (evt.event === 'done') {
          typing.remove()
          if (tokenBuffer) appendMessage(tokenBuffer, 'assistant')
          tokenBuffer = ''
          if (pendingCards.length) { renderCards(pendingCards); pendingCards = [] }
          isStreaming = false
          setInputEnabled(true)
          input.focus()
        } else if (evt.event === 'tool_call') {
          // Typing dots already showing | no extra UI state needed (per D-09)
        } else if (evt.event === 'error') {
          typing.remove()
          const status = evt.sessionId // reused this field for status code
          const msg = status === '401'
            ? 'This chat is unavailable right now.'
            : 'Something went wrong. Please try again.'
          appendMessage(msg, 'error')
          isStreaming = false
          setInputEnabled(true)
        }
      },
    })

    // Safety fallback: if stream ends without 'done'
    if (isStreaming) {
      typing.remove()
      if (tokenBuffer) appendMessage(tokenBuffer, 'assistant')
      if (pendingCards.length) { renderCards(pendingCards); pendingCards = [] }
      isStreaming = false
      setInputEnabled(true)
    }
  }

  // Panel input → clear field then submit.
  function handleSend(): void {
    const text = input.value.trim()
    if (!text || isStreaming) return
    input.value = ''
    void submitMessage(text)
  }

  // --- Event listeners ---
  input.addEventListener('input', () => {
    sendBtn.disabled = input.value.trim() === '' || isStreaming
    sendBtn.setAttribute('aria-disabled', String(sendBtn.disabled))
  })

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  })

  sendBtn.addEventListener('click', () => void handleSend())

  // Focus trap (per UI-SPEC accessibility contract, Pattern 7)
  panel.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = shadow.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (active === first) { e.preventDefault(); last.focus() }
    } else {
      if (active === last) { e.preventDefault(); first.focus() }
    }
  })

  function applyConfig(config: WidgetConfig): void {
    const displayInitial = getDisplayInitial(config.displayName)
    avatar.textContent = displayInitial
    botName.textContent = config.displayName
    emptyAvatar.textContent = displayInitial
    emptyHeading.textContent = config.welcomeMessage
  }

  return { panel, applyConfig, submitMessage, setContext }
}

// --- initWidget (top-level orchestrator, per Pattern 3) ---
function initWidget(token: string, apiBase: string, contextEndpoint: string): void {
  // Shadow host (must be unstyled | no transform/filter or position:fixed breaks)
  const host = document.createElement('div')
  host.id = 'opps-root'
  // Keep hidden until the config fetch authorizes this URL — avoids any flash of
  // the bubble on pages where the widget's URL rules disallow it.
  host.style.display = 'none'
  // Seed the default anchor so the CSS has something to match before the config
  // arrives; applyPlacement() overwrites it with the org's setting.
  applyPlacement(host, DEFAULT_WIDGET_CONFIG)
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  // Inject styles
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS
  shadow.appendChild(style)

  // Build bubble
  const bubble = document.createElement('button')
  bubble.className = 'opps-bubble'
  bubble.setAttribute('aria-label', 'Open chat')
  bubble.setAttribute('tabindex', '0')
  const initialIcon = document.createElement('span')
  initialIcon.className = 'opps-bubble-icon'
  initialIcon.innerHTML = ICON_CHAT
  bubble.appendChild(initialIcon)

  // Show welcome pulse on first load (no stored session)
  if (!readSession(token)) {
    bubble.classList.add('opps-pulse')
  }

  // Build panel
  const { panel, applyConfig, submitMessage, setContext } = buildPanel(shadow, token, apiBase, contextEndpoint, bubble)
  shadow.appendChild(bubble)
  shadow.appendChild(panel)

  // --- Greeting composer (minimized "Write a message…" prompt) ---
  const greeting = document.createElement('div')
  greeting.className = 'opps-greeting'
  greeting.setAttribute('aria-hidden', 'true')

  const greetingRow = document.createElement('div')
  greetingRow.className = 'opps-greeting-row'

  const greetingClose = document.createElement('button')
  greetingClose.className = 'opps-greeting-close'
  greetingClose.setAttribute('aria-label', 'Dismiss greeting')
  greetingClose.innerHTML = ICON_CLOSE_SM

  const greetingPill = document.createElement('div')
  greetingPill.className = 'opps-greeting-pill'
  const greetingInput = document.createElement('input')
  greetingInput.type = 'text'
  greetingInput.className = 'opps-greeting-input'
  greetingInput.placeholder = 'Write a message…'
  greetingInput.setAttribute('aria-label', 'Write a message')
  const greetingSend = document.createElement('button')
  greetingSend.className = 'opps-greeting-send'
  greetingSend.setAttribute('aria-label', 'Send message')
  greetingSend.disabled = true
  greetingSend.innerHTML = ICON_SEND
  greetingPill.appendChild(greetingInput)
  greetingPill.appendChild(greetingSend)

  greetingRow.appendChild(greetingClose)
  greetingRow.appendChild(greetingPill)
  greeting.appendChild(greetingRow)
  shadow.appendChild(greeting)

  // sessionStorage flag so a dismissed greeting stays gone for the visit.
  const greetingDismissKey = `opps_${token}_greetingDismissed`
  function greetingDismissed(): boolean {
    try { return sessionStorage.getItem(greetingDismissKey) === '1' } catch { return false }
  }
  function markGreetingDismissed(): void {
    try { sessionStorage.setItem(greetingDismissKey, '1') } catch { /* private mode */ }
  }

  let greetingShown = false
  function showGreeting(): void {
    if (greetingShown || isOpen || greetingDismissed()) return
    greetingShown = true
    greeting.setAttribute('aria-hidden', 'false')
    greeting.classList.remove('opps-greeting-closing')
    greeting.classList.add('opps-greeting-opening')
  }
  function hideGreeting(dismiss: boolean): void {
    if (dismiss) markGreetingDismissed()
    if (greeting.getAttribute('aria-hidden') === 'true') { greetingShown = false; return }
    greeting.classList.remove('opps-greeting-opening')
    greeting.classList.add('opps-greeting-closing')
    setTimeout(() => {
      greeting.setAttribute('aria-hidden', 'true')
      greeting.classList.remove('opps-greeting-closing')
    }, 200)
    greetingShown = false
  }

  greetingInput.addEventListener('input', () => {
    greetingSend.disabled = greetingInput.value.trim() === ''
  })
  function sendFromGreeting(): void {
    const text = greetingInput.value.trim()
    if (!text) return
    greetingInput.value = ''
    greetingSend.disabled = true
    hideGreeting(true)
    openPanel()
    void submitMessage(text)
  }
  greetingInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromGreeting() }
  })
  greetingSend.addEventListener('click', () => sendFromGreeting())
  greetingClose.addEventListener('click', () => hideGreeting(true))

  let greetingTimer: ReturnType<typeof setTimeout> | null = null

  void fetchWidgetConfig(apiBase, token).then(({ config, blocked }) => {
    // URL rules deny this page → remove the widget entirely, never reveal it.
    if (blocked) {
      host.remove()
      return
    }
    host.style.display = '' // authorized → reveal
    host.style.setProperty('--opps-primary-color', config.primaryColor)
    applyPlacement(host, config)
    applyConfig(config)
    if (config.greetingEnabled && !greetingDismissed()) {
      greetingTimer = setTimeout(showGreeting, config.greetingDelaySeconds * 1000)
    }
  })

  // Toggle open/closed
  let isOpen = false

  function setBubbleIcon(svg: string): void {
    const wrapper = document.createElement('span')
    wrapper.className = 'opps-bubble-icon opps-icon-entering'
    wrapper.innerHTML = svg
    bubble.innerHTML = ''
    bubble.appendChild(wrapper)
  }

  function openPanel(): void {
    if (greetingTimer) { clearTimeout(greetingTimer); greetingTimer = null }
    hideGreeting(false)
    isOpen = true
    panel.setAttribute('aria-hidden', 'false')
    panel.classList.remove('opps-panel-closing')
    panel.classList.add('opps-panel-opening')
    bubble.setAttribute('aria-label', 'Close chat')
    setBubbleIcon(ICON_CLOSE)
    // Focus the input inside the panel
    const input = panel.querySelector<HTMLInputElement>('.opps-input')
    setTimeout(() => input?.focus(), 330) // after open animation (320ms)
  }

  function closePanel(): void {
    isOpen = false
    panel.classList.remove('opps-panel-opening')
    panel.classList.add('opps-panel-closing')
    bubble.setAttribute('aria-label', 'Open chat')
    setBubbleIcon(ICON_CHAT)
    // Hide after animation completes (220ms)
    setTimeout(() => {
      panel.setAttribute('aria-hidden', 'true')
      panel.classList.remove('opps-panel-closing')
    }, 220)
  }

  bubble.addEventListener('click', () => {
    if (isOpen) closePanel()
    else openPanel()
  })

  // Enter/Space key on bubble
  bubble.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (isOpen) closePanel()
      else openPanel()
    }
  })

  // --- Minimal public JS API (window.Opps) ---
  // Lets the host site control the widget from its own buttons. Guarded so a
  // second script init never clobbers an existing instance.
  const w = window as unknown as { Opps?: Record<string, unknown> }
  if (!w.Opps) {
    w.Opps = {
      open: () => { if (!isOpen) openPanel() },
      close: () => { if (isOpen) closePanel() },
      sendMessage: (text: string) => {
        if (typeof text !== 'string' || !text.trim()) return
        openPanel()
        void submitMessage(text)
      },
      setContext: (contextToken: string) => {
        if (typeof contextToken === 'string' && contextToken) setContext(contextToken)
      },
    }
  }
}
