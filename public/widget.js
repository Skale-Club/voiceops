"use strict";(()=>{var be=Object.defineProperty;var te=Object.getOwnPropertySymbols;var xe=Object.prototype.hasOwnProperty,ye=Object.prototype.propertyIsEnumerable;var oe=(e,o,i)=>o in e?be(e,o,{enumerable:!0,configurable:!0,writable:!0,value:i}):e[o]=i,J=(e,o)=>{for(var i in o||(o={}))xe.call(o,i)&&oe(e,i,o[i]);if(te)for(var i of te(o))ye.call(o,i)&&oe(e,i,o[i]);return e};var d={stageBg:"var(--bg-primary)",stageDots:"radial-gradient(circle, rgba(148,163,184,0.12) 1px, transparent 1px)",stageDotsSize:"16px 16px",panelBg:"#ceced2",headerBg:"#f4f4f5",borderColor:"#e4e4e7",assistantBubbleBg:null,inputFieldBg:"#ffffff",textPrimary:"#09090b",textSecondary:"#71717a",userBubbleRadius:"10px"};var ve=["top-left","top-right","middle-left","middle-right","bottom-left","bottom-right"],V="bottom-right";function q(e){return typeof e=="string"&&ve.includes(e)?e:V}function R(e,o=20){let i=typeof e=="number"?e:Number(e);return Number.isFinite(i)?Math.max(0,Math.min(200,Math.round(i))):o}function ne(e){return e.split("-")[0]}function se(e){return e.split("-")[1]}var k={displayName:"AI Assistant",primaryColor:"#18181B",welcomeMessage:"Hi! How can I help?",greetingEnabled:!0,greetingMessage:"Hi! How can I help?",greetingDelaySeconds:3,position:V,offsetX:20,offsetY:20},we=`
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
  background: ${d.panelBg};
  border: 1px solid ${d.borderColor};
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

/* Greeting composer (minimized "Write a message\u2026" prompt) */
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
/* Invisible hover bridge above the pill so moving the cursor up to the \xD7 keeps
   the greeting hovered (otherwise the \xD7 re-blurs before you can reach it). */
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
  background: ${d.inputFieldBg};
  border: 1px solid ${d.borderColor};
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
  color: ${d.textPrimary};
  font-family: inherit;
}
.opps-greeting-input::placeholder { color: ${d.textSecondary}; }
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
     during the transition \u2014 the destination (hover) state is fully crisp. */
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
  background: ${d.headerBg};
  border-bottom: 1px solid ${d.borderColor};
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
  color: ${d.textPrimary};
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
  background: ${d.panelBg};
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
  border-radius: ${d.userBubbleRadius};
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.opps-bubble-assistant {
  color: ${d.textPrimary};
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
  background: ${d.panelBg};
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.opps-input {
  flex: 1;
  height: 36px;
  background: ${d.inputFieldBg};
  border: 1px solid ${d.borderColor};
  border-radius: 18px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  color: ${d.textPrimary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
}
.opps-input::placeholder { color: ${d.textSecondary}; }
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

/* Product cards (contract \xA76 ui/product_cards) */
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
  background: ${d.panelBg};
  border: 1px solid ${d.borderColor};
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
  background: ${d.inputFieldBg};
}
.opps-card-title {
  font-size: 12px;
  font-weight: 600;
  color: ${d.textPrimary};
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
  color: ${d.textSecondary};
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
  color: ${d.textPrimary};
  text-decoration: none;
  border: 1px solid ${d.borderColor};
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
`,re='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',Ee='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',ge='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',ke='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',ae='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',Ce='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',M=document.currentScript,de,pe=(de=M==null?void 0:M.dataset.token)!=null?de:"",Se=M!=null&&M.src?new URL(M.src).origin:location.origin,ce,Te=(ce=M==null?void 0:M.dataset.contextEndpoint)!=null?ce:"";pe&&!document.getElementById("opps-root")&&Pe(pe,Se,Te);function fe(e){return`opps_${e}_sessionId`}function me(e){try{return localStorage.getItem(fe(e))}catch(o){return null}}function Ie(e,o){try{localStorage.setItem(fe(e),o)}catch(i){}}function Q(e,o){if(typeof e!="string")return o;let i=e.trim();return i.length>0?i:o}function Ne(e){if(typeof e!="string")return k.primaryColor;let o=e.trim();return/^#[0-9A-Fa-f]{6}$/.test(o)?o.toUpperCase():k.primaryColor}function Z(e){return e.trim().charAt(0).toUpperCase()||k.displayName.charAt(0)}function le(e,o){let i=q(o.position),c=ne(i);e.setAttribute("data-vpos",c),e.setAttribute("data-hpos",se(i)),e.style.setProperty("--opps-offset-x",`${R(o.offsetX)}px`),e.style.setProperty("--opps-offset-y",c==="middle"?"0px":`${R(o.offsetY)}px`)}async function Ae(e,o){try{let i=`${e}/api/widget/${o}/config?u=${encodeURIComponent(location.href)}`,c=await fetch(i,{method:"GET",headers:{Accept:"application/json"}});if(c.status===403)return{config:k,blocked:!0};if(!c.ok)return{config:k,blocked:!1};let p=await c.json(),g=Q(p.welcomeMessage,k.welcomeMessage),r=typeof p.greetingDelaySeconds=="number"?p.greetingDelaySeconds:k.greetingDelaySeconds;return{config:{displayName:Q(p.displayName,k.displayName),primaryColor:Ne(p.primaryColor),welcomeMessage:g,greetingEnabled:p.greetingEnabled!==!1,greetingMessage:Q(p.greetingMessage,g),greetingDelaySeconds:Math.max(0,Math.min(30,r)),position:q(p.position),offsetX:R(p.offsetX),offsetY:R(p.offsetY)},blocked:!1}}catch(i){return{config:k,blocked:!1}}}async function Me(e,o){var g;if(!e.body)return;let i=e.body.getReader(),c=new TextDecoder,p="";for(;;){let{done:r,value:b}=await i.read();if(r)break;p+=c.decode(b,{stream:!0});let m=p.split(`
`);p=(g=m.pop())!=null?g:"";for(let O of m){let w=O.trim();if(w)try{o(JSON.parse(w))}catch(_){}}}if(p.trim())try{o(JSON.parse(p.trim()))}catch(r){}}async function Le(e){let{apiBase:o,token:i,message:c,sessionId:p,commerceContext:g,onEvent:r}=e,b;try{b=await fetch(`${o}/api/chat/${i}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(J(J({message:c,pageUrl:location.href},p?{sessionId:p}:{}),g?{commerce_context:g}:{}))})}catch(m){r({event:"error"});return}if(!b.ok||!b.body){r({event:"error",sessionId:String(b.status)});return}await Me(b,r)}function De(e,o,i,c,p){let g=document.createElement("div");g.className="opps-panel",g.setAttribute("role","dialog"),g.setAttribute("aria-label","Chat"),g.setAttribute("aria-hidden","true");let r=document.createElement("div");r.className="opps-header";let b=document.createElement("div");b.className="opps-avatar",b.textContent=Z(k.displayName);let m=document.createElement("span");m.className="opps-bot-name",m.textContent=k.displayName;let O=document.createElement("div");O.className="opps-header-actions";let w=document.createElement("button");w.className="opps-header-btn",w.type="button",w.setAttribute("aria-label","Expand chat"),w.innerHTML=ae,O.appendChild(w),r.appendChild(b),r.appendChild(m),r.appendChild(O);let _=!1;w.addEventListener("click",()=>{_=!_,g.classList.toggle("opps-expanded",_),w.innerHTML=_?Ce:ae,w.setAttribute("aria-label",_?"Collapse chat":"Expand chat")});let l=document.createElement("div");l.className="opps-messages",l.setAttribute("aria-live","polite");let T=document.createElement("div");T.className="opps-empty";let I=document.createElement("div");I.className="opps-empty-avatar",I.textContent=Z(k.displayName);let L=document.createElement("p");L.className="opps-empty-heading",L.textContent=k.welcomeMessage;let E=document.createElement("p");E.className="opps-empty-body",E.textContent="Ask me anything \u2014 I\u2019m here to help.",T.appendChild(I),T.appendChild(L),T.appendChild(E),l.appendChild(T);let C=document.createElement("div");C.className="opps-input-area";let h=document.createElement("input");h.type="text",h.className="opps-input",h.placeholder="Type a message\u2026",h.setAttribute("aria-label","Message input");let y=document.createElement("button");y.className="opps-send",y.setAttribute("aria-label","Send message"),y.setAttribute("aria-disabled","true"),y.disabled=!0,y.innerHTML=ge,C.appendChild(h),C.appendChild(y),g.appendChild(r),g.appendChild(l),g.appendChild(C);let N=!1,D=me(o),Y=!1,P=null,z=0,F=crypto.randomUUID();function W(t){try{let s=t.length%4===0?"":"=".repeat(4-t.length%4);return JSON.parse(atob(t.replace(/-/g,"+").replace(/_/g,"/")+s))}catch(s){return null}}function j(t){var f;let s=W((f=t.split(".")[0])!=null?f:"");P=t,z=typeof(s==null?void 0:s.exp)=="number"?s.exp:Math.floor(Date.now()/1e3)+60}async function $(){if(!c)return null;let t=Math.floor(Date.now()/1e3);if(P&&z>t+5)return P;try{let s=await fetch(c+(c.includes("?")?"&":"?")+"cnonce="+encodeURIComponent(F),{credentials:"same-origin"});if(!s.ok)return null;let{token:f}=await s.json();return f?(j(f),P):null}catch(s){return null}}function B(t,s){Y||(T.remove(),Y=!0);let f=document.createElement("div");f.className=`opps-msg opps-msg-${s==="user"?"user":"assistant"}`;let x=document.createElement("div");x.className=s==="error"?"opps-bubble-error":`opps-bubble-${s}`,x.textContent=t,f.appendChild(x),l.appendChild(f),l.scrollTop=l.scrollHeight}function G(t){var x,S;let s=t.filter(u=>typeof u=="object"&&u!==null);if(!s.length)return;let f=document.createElement("div");f.className="opps-cards";for(let u of s){let a=document.createElement("div");if(a.className="opps-card",typeof u.thumbnail=="string"&&u.thumbnail){let v=document.createElement("img");v.className="opps-card-img",v.src=u.thumbnail,v.alt="",a.appendChild(v)}let K=document.createElement("div");if(K.className="opps-card-title",K.textContent=String((x=u.title)!=null?x:""),a.appendChild(K),typeof u.price=="string"&&u.price){let v=document.createElement("div");v.className="opps-card-price",v.textContent=u.price,a.appendChild(v)}let H=document.createElement("div");if(H.className="opps-card-actions",typeof u.url=="string"&&u.url&&(u.url.startsWith("/")||u.url.startsWith("https://"))){let v=document.createElement("a");v.className="opps-card-view",v.href=u.url,v.target="_top",v.rel="noopener",v.textContent="View",H.appendChild(v)}let he=String((S=u.title)!=null?S:""),U=document.createElement("button");U.className="opps-card-add",U.type="button",U.textContent="Add to cart",U.addEventListener("click",()=>{X(`Add "${he}" to my cart`)}),H.appendChild(U),a.appendChild(H),f.appendChild(a)}l.appendChild(f),l.scrollTop=l.scrollHeight}function n(){let t=document.createElement("div");t.className="opps-typing",t.setAttribute("aria-label","AI is typing");for(let s=0;s<3;s++){let f=document.createElement("div");f.className="opps-dot",t.appendChild(f)}return l.appendChild(t),l.scrollTop=l.scrollHeight,t}function A(t){h.disabled=!t,y.disabled=!t||h.value.trim()==="",y.setAttribute("aria-disabled",String(!t||h.value.trim()===""))}async function X(t){let s=t.trim();if(!s||N)return;N=!0,A(!1),B(s,"user");let f=n(),x="",S=[],u=await $();await Le({apiBase:i,token:o,message:s,sessionId:D,commerceContext:u,onEvent:a=>{if(a.event==="session"&&a.sessionId)D||(D=a.sessionId,Ie(o,D));else if(a.event==="token"&&a.text)x+=a.text;else if(a.event==="commerce")window.dispatchEvent(new CustomEvent("xphere:commerce",{detail:{action:a.action,cartId:a.cartId,itemCount:a.itemCount,sig:a.sig}})),a.action==="cart_created"&&(P=null,z=0);else if(a.event==="ui"&&a.component==="product_cards"&&Array.isArray(a.items))S=a.items.slice(0,5);else if(a.event==="done")f.remove(),x&&B(x,"assistant"),x="",S.length&&(G(S),S=[]),N=!1,A(!0),h.focus();else if(a.event!=="tool_call"){if(a.event==="error"){f.remove();let H=a.sessionId==="401"?"This chat is unavailable right now.":"Something went wrong. Please try again.";B(H,"error"),N=!1,A(!0)}}}}),N&&(f.remove(),x&&B(x,"assistant"),S.length&&(G(S),S=[]),N=!1,A(!0))}function ee(){let t=h.value.trim();!t||N||(h.value="",X(t))}h.addEventListener("input",()=>{y.disabled=h.value.trim()===""||N,y.setAttribute("aria-disabled",String(y.disabled))}),h.addEventListener("keydown",t=>{t.key==="Enter"&&!t.shiftKey&&(t.preventDefault(),ee())}),y.addEventListener("click",()=>{ee()}),g.addEventListener("keydown",t=>{if(t.key!=="Tab")return;let s=Array.from(g.querySelectorAll('button, input, [tabindex="0"]'));if(s.length===0)return;let f=s[0],x=s[s.length-1],S=e.activeElement;t.shiftKey?S===f&&(t.preventDefault(),x.focus()):S===x&&(t.preventDefault(),f.focus())});function ue(t){let s=Z(t.displayName);b.textContent=s,m.textContent=t.displayName,I.textContent=s,L.textContent=t.welcomeMessage}return{panel:g,applyConfig:ue,submitMessage:X,setContext:j}}function Pe(e,o,i){let c=document.createElement("div");c.id="opps-root",c.style.display="none",le(c,k),document.body.appendChild(c);let p=c.attachShadow({mode:"open"}),g=document.createElement("style");g.textContent=we,p.appendChild(g);let r=document.createElement("button");r.className="opps-bubble",r.setAttribute("aria-label","Open chat"),r.setAttribute("tabindex","0");let b=document.createElement("span");b.className="opps-bubble-icon",b.innerHTML=re,r.appendChild(b),me(e)||r.classList.add("opps-pulse");let{panel:m,applyConfig:O,submitMessage:w,setContext:_}=De(p,e,o,i,r);p.appendChild(r),p.appendChild(m);let l=document.createElement("div");l.className="opps-greeting",l.setAttribute("aria-hidden","true");let T=document.createElement("div");T.className="opps-greeting-row";let I=document.createElement("button");I.className="opps-greeting-close",I.setAttribute("aria-label","Dismiss greeting"),I.innerHTML=ke;let L=document.createElement("div");L.className="opps-greeting-pill";let E=document.createElement("input");E.type="text",E.className="opps-greeting-input",E.placeholder="Write a message\u2026",E.setAttribute("aria-label","Write a message");let C=document.createElement("button");C.className="opps-greeting-send",C.setAttribute("aria-label","Send message"),C.disabled=!0,C.innerHTML=ge,L.appendChild(E),L.appendChild(C),T.appendChild(I),T.appendChild(L),l.appendChild(T),p.appendChild(l);let h=`opps_${e}_greetingDismissed`;function y(){try{return sessionStorage.getItem(h)==="1"}catch(n){return!1}}function N(){try{sessionStorage.setItem(h,"1")}catch(n){}}let D=!1;function Y(){D||W||y()||(D=!0,l.setAttribute("aria-hidden","false"),l.classList.remove("opps-greeting-closing"),l.classList.add("opps-greeting-opening"))}function P(n){if(n&&N(),l.getAttribute("aria-hidden")==="true"){D=!1;return}l.classList.remove("opps-greeting-opening"),l.classList.add("opps-greeting-closing"),setTimeout(()=>{l.setAttribute("aria-hidden","true"),l.classList.remove("opps-greeting-closing")},200),D=!1}E.addEventListener("input",()=>{C.disabled=E.value.trim()===""});function z(){let n=E.value.trim();n&&(E.value="",C.disabled=!0,P(!0),$(),w(n))}E.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),z())}),C.addEventListener("click",()=>z()),I.addEventListener("click",()=>P(!0));let F=null;Ae(o,e).then(({config:n,blocked:A})=>{if(A){c.remove();return}c.style.display="",c.style.setProperty("--opps-primary-color",n.primaryColor),le(c,n),O(n),n.greetingEnabled&&!y()&&(F=setTimeout(Y,n.greetingDelaySeconds*1e3))});let W=!1;function j(n){let A=document.createElement("span");A.className="opps-bubble-icon opps-icon-entering",A.innerHTML=n,r.innerHTML="",r.appendChild(A)}function $(){F&&(clearTimeout(F),F=null),P(!1),W=!0,m.setAttribute("aria-hidden","false"),m.classList.remove("opps-panel-closing"),m.classList.add("opps-panel-opening"),r.setAttribute("aria-label","Close chat"),j(Ee);let n=m.querySelector(".opps-input");setTimeout(()=>n==null?void 0:n.focus(),330)}function B(){W=!1,m.classList.remove("opps-panel-opening"),m.classList.add("opps-panel-closing"),r.setAttribute("aria-label","Open chat"),j(re),setTimeout(()=>{m.setAttribute("aria-hidden","true"),m.classList.remove("opps-panel-closing")},220)}r.addEventListener("click",()=>{W?B():$()}),r.addEventListener("keydown",n=>{(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),W?B():$())});let G=window;G.Opps||(G.Opps={open:()=>{W||$()},close:()=>{W&&B()},sendMessage:n=>{typeof n!="string"||!n.trim()||($(),w(n))},setContext:n=>{typeof n=="string"&&n&&_(n)}})}})();
