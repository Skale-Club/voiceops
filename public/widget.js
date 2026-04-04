"use strict";(()=>{var P=Object.defineProperty;var L=Object.getOwnPropertySymbols;var _=Object.prototype.hasOwnProperty,K=Object.prototype.propertyIsEnumerable;var N=(n,t,r)=>t in n?P(n,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):n[t]=r,T=(n,t)=>{for(var r in t||(t={}))_.call(t,r)&&N(n,r,t[r]);if(L)for(var r of L(t))K.call(t,r)&&N(n,r,t[r]);return n};var R=`
/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Animations */
@keyframes leaidear-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(24,24,27,0.35); }
  70%  { box-shadow: 0 0 0 12px rgba(24,24,27,0); }
  100% { box-shadow: 0 0 0 0 rgba(24,24,27,0); }
}
@keyframes leaidear-dot-pulse {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30%            { opacity: 1;    transform: translateY(-4px); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

/* Bubble */
.leaidear-bubble {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #18181b;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  transition: transform 200ms ease;
}
.leaidear-bubble:hover { transform: scale(1.06); }
.leaidear-bubble:active { transform: scale(0.96); }
.leaidear-bubble.leaidear-pulse {
  animation: leaidear-pulse 1.4s ease-out 1.2s 2 both;
}

/* Panel */
.leaidear-panel {
  position: fixed;
  bottom: 88px;
  right: 20px;
  z-index: 2147483646;
  width: 360px;
  height: 520px;
  background: #ffffff;
  border: 1px solid #e4e4e7;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transform-origin: bottom right;
}
.leaidear-panel[aria-hidden="true"] {
  display: none;
}
.leaidear-panel-opening {
  animation: leaidear-panel-open 200ms ease forwards;
}
.leaidear-panel-closing {
  animation: leaidear-panel-close 160ms ease forwards;
}
@keyframes leaidear-panel-open {
  from { opacity: 0; transform: scale(0.95) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes leaidear-panel-close {
  from { opacity: 1; transform: scale(1) translateY(0); }
  to   { opacity: 0; transform: scale(0.95) translateY(8px); }
}

/* Header */
.leaidear-header {
  height: 52px;
  min-height: 52px;
  background: #f4f4f5;
  border-bottom: 1px solid #e4e4e7;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.leaidear-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #18181b;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.leaidear-bot-name {
  font-size: 14px;
  font-weight: 600;
  color: #09090b;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Message list */
.leaidear-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  scroll-behavior: smooth;
}

/* Empty state */
.leaidear-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  text-align: center;
  padding: 16px;
}
.leaidear-empty-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #18181b;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}
.leaidear-empty-heading {
  font-size: 14px;
  font-weight: 600;
  color: #09090b;
}
.leaidear-empty-body {
  font-size: 14px;
  font-weight: 400;
  color: #71717a;
  line-height: 1.5;
}

/* Message bubbles */
.leaidear-msg {
  display: flex;
  max-width: 75%;
  word-break: break-word;
}
.leaidear-msg-user {
  align-self: flex-end;
  justify-content: flex-end;
  margin-top: 12px;
}
.leaidear-msg-user:first-of-type { margin-top: 0; }
.leaidear-msg-assistant {
  align-self: flex-start;
  justify-content: flex-start;
  margin-top: 4px;
}
.leaidear-bubble-user {
  background: #18181b;
  color: #ffffff;
  padding: 8px 16px;
  border-radius: 16px 16px 4px 16px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.leaidear-bubble-assistant {
  background: #f4f4f5;
  color: #09090b;
  padding: 8px 16px;
  border-radius: 16px 16px 16px 4px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.leaidear-bubble-error {
  background: #f4f4f5;
  color: #ef4444;
  padding: 8px 16px;
  border-radius: 16px 16px 16px 4px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}

/* Typing indicator */
.leaidear-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #f4f4f5;
  padding: 12px 16px;
  border-radius: 16px 16px 16px 4px;
  align-self: flex-start;
  margin-top: 4px;
}
.leaidear-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #71717a;
}
.leaidear-dot:nth-child(1) { animation: leaidear-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0s; }
.leaidear-dot:nth-child(2) { animation: leaidear-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.2s; }
.leaidear-dot:nth-child(3) { animation: leaidear-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.4s; }

/* Input area */
.leaidear-input-area {
  height: 56px;
  min-height: 56px;
  background: #ffffff;
  border-top: 1px solid #e4e4e7;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.leaidear-input {
  flex: 1;
  height: 36px;
  background: #f4f4f5;
  border: 1px solid #e4e4e7;
  border-radius: 18px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  color: #09090b;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
}
.leaidear-input::placeholder { color: #71717a; }
.leaidear-input:focus { border-color: #a1a1aa; }
.leaidear-input:disabled { opacity: 0.5; pointer-events: none; }
.leaidear-send {
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
.leaidear-send:hover:not(:disabled) { background: #3f3f46; }
.leaidear-send:active:not(:disabled) { background: #52525b; }
.leaidear-send:disabled { background: #d4d4d8; cursor: default; }
`,M='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',Y='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',U='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',x=document.currentScript,B,H=(B=x==null?void 0:x.dataset.token)!=null?B:"",$=x!=null&&x.src?new URL(x.src).origin:location.origin;H&&!document.getElementById("leaidear-root")&&G(H,$);function z(n){return`leaidear_${n}_sessionId`}function j(n){try{return localStorage.getItem(z(n))}catch(t){return null}}function F(n,t){try{localStorage.setItem(z(n),t)}catch(r){}}async function J(n,t){var e;if(!n.body)return;let r=n.body.getReader(),b=new TextDecoder,i="";for(;;){let{done:s,value:m}=await r.read();if(s)break;i+=b.decode(m,{stream:!0});let l=i.split(`
`);i=(e=l.pop())!=null?e:"";for(let g of l){let c=g.trim();if(c)try{t(JSON.parse(c))}catch(y){}}}if(i.trim())try{t(JSON.parse(i.trim()))}catch(s){}}async function q(n){let{apiBase:t,token:r,message:b,sessionId:i,onEvent:e}=n,s;try{s=await fetch(`${t}/api/chat/${r}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(T({message:b},i?{sessionId:i}:{}))})}catch(m){e({event:"error"});return}if(!s.ok||!s.body){e({event:"error",sessionId:String(s.status)});return}await J(s,e)}function W(n,t,r,b){let i=document.createElement("div");i.className="leaidear-panel",i.setAttribute("role","dialog"),i.setAttribute("aria-label","Chat"),i.setAttribute("aria-hidden","true");let e=document.createElement("div");e.className="leaidear-header";let s=document.createElement("div");s.className="leaidear-avatar",s.textContent="A";let m=document.createElement("span");m.className="leaidear-bot-name",m.textContent="AI Assistant",e.appendChild(s),e.appendChild(m);let l=document.createElement("div");l.className="leaidear-messages",l.setAttribute("aria-live","polite");let g=document.createElement("div");g.className="leaidear-empty";let c=document.createElement("div");c.className="leaidear-empty-avatar",c.textContent="A";let y=document.createElement("p");y.className="leaidear-empty-heading",y.textContent="Hi! How can I help?";let S=document.createElement("p");S.className="leaidear-empty-body",S.textContent="Ask me anything \u2014 I\u2019m here to help.",g.appendChild(c),g.appendChild(y),g.appendChild(S),l.appendChild(g);let v=document.createElement("div");v.className="leaidear-input-area";let f=document.createElement("input");f.type="text",f.className="leaidear-input",f.placeholder="Type a message\u2026",f.setAttribute("aria-label","Message input");let u=document.createElement("button");u.className="leaidear-send",u.setAttribute("aria-label","Send message"),u.setAttribute("aria-disabled","true"),u.disabled=!0,u.innerHTML=U,v.appendChild(f),v.appendChild(u),i.appendChild(e),i.appendChild(l),i.appendChild(v);let h=!1,w=j(t),A=!1;function k(a,p){A||(g.remove(),A=!0);let d=document.createElement("div");d.className=`leaidear-msg leaidear-msg-${p==="user"?"user":"assistant"}`;let o=document.createElement("div");o.className=p==="error"?"leaidear-bubble-error":`leaidear-bubble-${p}`,o.textContent=a,d.appendChild(o),l.appendChild(d),l.scrollTop=l.scrollHeight}function O(){let a=document.createElement("div");a.className="leaidear-typing",a.setAttribute("aria-label","AI is typing");for(let p=0;p<3;p++){let d=document.createElement("div");d.className="leaidear-dot",a.appendChild(d)}return l.appendChild(a),l.scrollTop=l.scrollHeight,a}function E(a){f.disabled=!a,u.disabled=!a||f.value.trim()==="",u.setAttribute("aria-disabled",String(!a||f.value.trim()===""))}async function I(){let a=f.value.trim();if(!a||h)return;h=!0,f.value="",E(!1),k(a,"user");let p=O(),d="";await q({apiBase:r,token:t,message:a,sessionId:w,onEvent:o=>{if(o.event==="session"&&o.sessionId)w||(w=o.sessionId,F(t,w));else if(o.event==="token"&&o.text)d+=o.text;else if(o.event==="done")p.remove(),d&&k(d,"assistant"),d="",h=!1,E(!0),f.focus();else if(o.event!=="tool_call"){if(o.event==="error"){p.remove();let D=o.sessionId==="401"?"This chat is unavailable right now.":"Something went wrong. Please try again.";k(D,"error"),h=!1,E(!0)}}}}),h&&(p.remove(),d&&k(d,"assistant"),h=!1,E(!0))}return f.addEventListener("input",()=>{u.disabled=f.value.trim()===""||h,u.setAttribute("aria-disabled",String(u.disabled))}),f.addEventListener("keydown",a=>{a.key==="Enter"&&!a.shiftKey&&(a.preventDefault(),I())}),u.addEventListener("click",()=>void I()),i.addEventListener("keydown",a=>{if(a.key!=="Tab")return;let p=Array.from(i.querySelectorAll('button, input, [tabindex="0"]'));if(p.length===0)return;let d=p[0],o=p[p.length-1],C=n.activeElement;a.shiftKey?C===d&&(a.preventDefault(),o.focus()):C===o&&(a.preventDefault(),d.focus())}),i}function G(n,t){let r=document.createElement("div");r.id="leaidear-root",document.body.appendChild(r);let b=r.attachShadow({mode:"open"}),i=document.createElement("style");i.textContent=R,b.appendChild(i);let e=document.createElement("button");e.className="leaidear-bubble",e.setAttribute("aria-label","Open chat"),e.setAttribute("tabindex","0"),e.innerHTML=M,j(n)||e.classList.add("leaidear-pulse");let s=W(b,n,t,e);b.appendChild(e),b.appendChild(s);let m=!1;function l(){m=!0,s.setAttribute("aria-hidden","false"),s.classList.remove("leaidear-panel-closing"),s.classList.add("leaidear-panel-opening"),e.setAttribute("aria-label","Close chat"),e.innerHTML=Y;let c=s.querySelector(".leaidear-input");setTimeout(()=>c==null?void 0:c.focus(),210)}function g(){m=!1,s.classList.remove("leaidear-panel-opening"),s.classList.add("leaidear-panel-closing"),e.setAttribute("aria-label","Open chat"),e.innerHTML=M,setTimeout(()=>{s.setAttribute("aria-hidden","true"),s.classList.remove("leaidear-panel-closing")},160)}e.addEventListener("click",()=>{m?g():l()}),e.addEventListener("keydown",c=>{(c.key==="Enter"||c.key===" ")&&(c.preventDefault(),m?g():l())})}})();
