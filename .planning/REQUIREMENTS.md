# Leaidear v1.2 Requirements

## Milestone: v1.2 — Leaidear + Embedded Chatbot

**Goal:** Rename the platform to Leaidear and ship an embeddable chat widget for third-party sites, backed by the existing knowledge base and action engine.

---

## v1.2 Requirements

### BRAND — Platform Rename

- [x] **BRAND-01**: Platform UI displays "Leaidear" name instead of "VoiceOps" across all pages, navigation, and branding elements
- [x] **BRAND-02**: Page titles, sidebar, login page, and any hardcoded references updated to Leaidear

### WIDGET — Embeddable Chat Widget

- [ ] **WIDGET-01**: Admin can install the chat widget on any third-party site using a single `<script>` tag (no framework dependency on host)
- [ ] **WIDGET-02**: Script tag is GTM-compatible (loads asynchronously, no blocking)
- [ ] **WIDGET-03**: Widget renders as a floating chat bubble that expands into a full chat panel
- [ ] **WIDGET-04**: Widget is identified per-org via a public token embedded in the script tag
- [ ] **WIDGET-05**: Widget works without visitor login or authentication

### CHAT — Conversation Engine

- [ ] **CHAT-01**: Visitor can send messages and receive streamed AI responses in real time (SSE)
- [ ] **CHAT-02**: AI responses draw from the org's knowledge base (LangChain SupabaseVectorStore)
- [ ] **CHAT-03**: AI can call org tools during conversation (action engine `executeAction`)
- [ ] **CHAT-04**: Conversation context is maintained within a session using Redis short-term memory
- [ ] **CHAT-05**: Conversation history is persisted to Supabase long-term memory (per org, per session)
- [ ] **CHAT-06**: Each conversation session is identified by a unique session ID (anonymous visitor)

### ADMIN — Widget Configuration

- [ ] **ADMIN-01**: Admin can configure widget appearance per org (display name, primary color, welcome message)
- [ ] **ADMIN-02**: Admin page shows the embed `<script>` tag ready to copy
- [ ] **ADMIN-03**: Admin page shows a live preview of the widget with current configuration
- [ ] **ADMIN-04**: Admin can regenerate the org's widget public token (invalidates old installs)

### INFRA — Backend Infrastructure

- [x] **INFRA-01**: Redis connection configured and available for chat session storage
- [ ] **INFRA-02**: Supabase schema includes `chat_sessions` and `chat_messages` tables with RLS
- [ ] **INFRA-03**: Public-facing chat API route (`/api/chat/[token]`) validates org token and scopes all queries to the org
- [x] **INFRA-04**: Widget asset served from the platform's own domain (no external CDN dependency required)

---

## Future Requirements (Deferred)

- Widget analytics dashboard (message volume, session count, resolution rate) — v1.3+
- Visitor identity (optional name/email collection before chat) — v1.3+
- Conversation handoff to human agent — v1.3+
- Widget multi-language support — v1.3+
- Vapi webhook HMAC/secret validation — backlog
- `send_sms` action type (Twilio) — backlog
- `custom_webhook` action type — backlog
- Campaign calls auto-appear in Observability — backlog

---

## Out of Scope

- Visitor login or OAuth for widget users — public token is sufficient
- White-label domain for widget hosting — uses platform domain
- Mobile native SDK — web widget covers mobile browsers
- Real-time operator monitoring of live chats — v1.3+
- Widget A/B testing — v1.3+

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| BRAND-01 | Phase 1 | Complete |
| BRAND-02 | Phase 1 | Complete |
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | pending |
| INFRA-04 | Phase 1 | Complete |
| CHAT-04 | Phase 2 | pending |
| CHAT-05 | Phase 2 | pending |
| CHAT-06 | Phase 2 | pending |
| INFRA-03 | Phase 2 | pending |
| CHAT-01 | Phase 3 | pending |
| CHAT-02 | Phase 3 | pending |
| CHAT-03 | Phase 3 | pending |
| WIDGET-01 | Phase 4 | pending |
| WIDGET-02 | Phase 4 | pending |
| WIDGET-03 | Phase 4 | pending |
| WIDGET-04 | Phase 4 | pending |
| WIDGET-05 | Phase 4 | pending |
| ADMIN-01 | Phase 5 | pending |
| ADMIN-02 | Phase 5 | pending |
| ADMIN-03 | Phase 5 | pending |
| ADMIN-04 | Phase 5 | pending |
