// src/widget/index.ts
// Leaidear embeddable chat widget — standalone vanilla TypeScript, no React/Next.js imports

// --- CSS constant (inline string, full UI-SPEC values) ---
const WIDGET_CSS = `
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
`

// --- SVG icon constants ---
const ICON_CHAT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`

const ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

const ICON_SEND = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`

// --- Synchronous captures — MUST be before any async boundary ---
const _script = document.currentScript as HTMLScriptElement | null
const _token = _script?.dataset.token ?? ''
const _apiBase = _script?.src ? new URL(_script.src).origin : location.origin

// --- Double-init guard and entry point ---
if (_token && !document.getElementById('leaidear-root')) {
  initWidget(_token, _apiBase)
}

// --- Session storage helpers (D-12, D-13, Pattern 5) ---
function getStorageKey(token: string): string {
  return `leaidear_${token}_sessionId`
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
    // Silent fail — private browsing mode (Safari) may throw SecurityError
  }
}

// --- SSE event type ---
interface SSEEvent {
  event: string
  sessionId?: string
  text?: string
  name?: string
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
        // Malformed line — skip
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
  onEvent: (evt: SSEEvent) => void
}): Promise<void> {
  const { apiBase, token, message, sessionId, onEvent } = params
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/chat/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
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
  _bubble: HTMLButtonElement
): HTMLDivElement {
  const panel = document.createElement('div')
  panel.className = 'leaidear-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Chat')
  panel.setAttribute('aria-hidden', 'true')

  // Header
  const header = document.createElement('div')
  header.className = 'leaidear-header'
  const avatar = document.createElement('div')
  avatar.className = 'leaidear-avatar'
  avatar.textContent = 'A'
  const botName = document.createElement('span')
  botName.className = 'leaidear-bot-name'
  botName.textContent = 'AI Assistant'
  header.appendChild(avatar)
  header.appendChild(botName)

  // Message list
  const msgList = document.createElement('div')
  msgList.className = 'leaidear-messages'
  msgList.setAttribute('aria-live', 'polite')

  // Empty state
  const emptyState = document.createElement('div')
  emptyState.className = 'leaidear-empty'
  const emptyAvatar = document.createElement('div')
  emptyAvatar.className = 'leaidear-empty-avatar'
  emptyAvatar.textContent = 'A'
  const emptyHeading = document.createElement('p')
  emptyHeading.className = 'leaidear-empty-heading'
  emptyHeading.textContent = 'Hi! How can I help?'
  const emptyBody = document.createElement('p')
  emptyBody.className = 'leaidear-empty-body'
  emptyBody.textContent = 'Ask me anything \u2014 I\u2019m here to help.'
  emptyState.appendChild(emptyAvatar)
  emptyState.appendChild(emptyHeading)
  emptyState.appendChild(emptyBody)
  msgList.appendChild(emptyState)

  // Input area
  const inputArea = document.createElement('div')
  inputArea.className = 'leaidear-input-area'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'leaidear-input'
  input.placeholder = 'Type a message\u2026'
  input.setAttribute('aria-label', 'Message input')
  const sendBtn = document.createElement('button')
  sendBtn.className = 'leaidear-send'
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

  // --- Helpers ---
  function appendMessage(text: string, role: 'user' | 'assistant' | 'error'): void {
    if (!hasMessages) {
      emptyState.remove()
      hasMessages = true
    }
    const wrapper = document.createElement('div')
    wrapper.className = `leaidear-msg leaidear-msg-${role === 'user' ? 'user' : 'assistant'}`
    const bubble = document.createElement('div')
    bubble.className = role === 'error' ? 'leaidear-bubble-error' : `leaidear-bubble-${role}`
    bubble.textContent = text
    wrapper.appendChild(bubble)
    msgList.appendChild(wrapper)
    msgList.scrollTop = msgList.scrollHeight
  }

  function showTyping(): HTMLDivElement {
    const typing = document.createElement('div')
    typing.className = 'leaidear-typing'
    typing.setAttribute('aria-label', 'AI is typing')
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div')
      dot.className = 'leaidear-dot'
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

  async function handleSend(): Promise<void> {
    const text = input.value.trim()
    if (!text || isStreaming) return

    isStreaming = true
    input.value = ''
    setInputEnabled(false)
    appendMessage(text, 'user')
    const typing = showTyping()

    let tokenBuffer = ''

    await sendMessage({
      apiBase,
      token,
      message: text,
      sessionId,
      onEvent: (evt) => {
        if (evt.event === 'session' && evt.sessionId) {
          if (!sessionId) {
            sessionId = evt.sessionId
            storeSession(token, sessionId)
          }
        } else if (evt.event === 'token' && evt.text) {
          tokenBuffer += evt.text
        } else if (evt.event === 'done') {
          typing.remove()
          if (tokenBuffer) appendMessage(tokenBuffer, 'assistant')
          tokenBuffer = ''
          isStreaming = false
          setInputEnabled(true)
          input.focus()
        } else if (evt.event === 'tool_call') {
          // Typing dots already showing — no extra UI state needed (per D-09)
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
      isStreaming = false
      setInputEnabled(true)
    }
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

  return panel
}

// --- initWidget (top-level orchestrator, per Pattern 3) ---
function initWidget(token: string, apiBase: string): void {
  // Shadow host (must be unstyled — no transform/filter or position:fixed breaks)
  const host = document.createElement('div')
  host.id = 'leaidear-root'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  // Inject styles
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS
  shadow.appendChild(style)

  // Build bubble
  const bubble = document.createElement('button')
  bubble.className = 'leaidear-bubble'
  bubble.setAttribute('aria-label', 'Open chat')
  bubble.setAttribute('tabindex', '0')
  bubble.innerHTML = ICON_CHAT

  // Show welcome pulse on first load (no stored session)
  if (!readSession(token)) {
    bubble.classList.add('leaidear-pulse')
  }

  // Build panel
  const panel = buildPanel(shadow, token, apiBase, bubble)
  shadow.appendChild(bubble)
  shadow.appendChild(panel)

  // Toggle open/closed
  let isOpen = false

  function openPanel(): void {
    isOpen = true
    panel.setAttribute('aria-hidden', 'false')
    panel.classList.remove('leaidear-panel-closing')
    panel.classList.add('leaidear-panel-opening')
    bubble.setAttribute('aria-label', 'Close chat')
    bubble.innerHTML = ICON_CLOSE
    // Focus the input inside the panel
    const input = panel.querySelector<HTMLInputElement>('.leaidear-input')
    setTimeout(() => input?.focus(), 210) // after open animation
  }

  function closePanel(): void {
    isOpen = false
    panel.classList.remove('leaidear-panel-opening')
    panel.classList.add('leaidear-panel-closing')
    bubble.setAttribute('aria-label', 'Open chat')
    bubble.innerHTML = ICON_CHAT
    // Hide after animation completes
    setTimeout(() => {
      panel.setAttribute('aria-hidden', 'true')
      panel.classList.remove('leaidear-panel-closing')
    }, 160)
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
}
