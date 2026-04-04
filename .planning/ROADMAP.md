# Leaidear Roadmap

## Milestones

- ✅ **v1.0 MVP** — 6 phases, 30 plans (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** — LangChain vector pipeline (shipped 2026-04-03)
- 🚧 **v1.2 Leaidear + Embedded Chatbot** — active (5 phases)

## Shipped

<details>
<summary>✅ v1.0 MVP — SHIPPED 2026-04-03</summary>

See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

- [x] Phase 1: Foundation
- [x] Phase 2: Action Engine
- [x] Phase 3: Observability
- [x] Phase 4: Knowledge Base
- [x] Phase 5: Outbound Campaigns
- [x] Phase 6: API Key Admin

</details>

<details>
<summary>✅ v1.1 Knowledge Base — SHIPPED 2026-04-03</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

- [x] Data Layer — LangChain schema, match_documents RPC
- [x] File Pipeline — upload → chunk → embed → pgvector
- [x] URL Pipeline — scrape → chunk → embed → pgvector
- [x] UI & Wiring — limits, OpenAI banner, AlertDialog, semantic search

</details>

---

## v1.2 — Leaidear + Embedded Chatbot

**Goal:** Rename the platform to Leaidear and ship an embeddable chat widget for third-party sites, backed by the existing knowledge base and action engine.

### Phases

- [x] **Phase 1: Foundation** - Redis, Supabase schema, brand rename, and static widget asset — everything downstream phases require (completed 2026-04-04)
- [ ] **Phase 2: Chat API** - Public `/api/chat/[token]` route with token validation, session management, and conversation persistence
- [ ] **Phase 3: AI Conversation Engine** - Streaming responses via Vercel AI SDK, knowledge base retrieval, and action engine tool calls
- [ ] **Phase 4: Widget Embed Script** - Client-side JS widget loaded via `<script>` tag with floating bubble and chat panel UI
- [ ] **Phase 5: Admin Configuration** - Widget config page with appearance settings, live preview, embed code generator, and token regen

---

## Phase Details

### Phase 1: Foundation
**Goal**: Infrastructure and branding prerequisites are in place so all downstream phases can build without blockers
**Depends on**: Nothing
**Requirements**: BRAND-01, BRAND-02, INFRA-01, INFRA-02, INFRA-04
**Success Criteria** (what must be TRUE):
  1. Every page, nav element, login screen, and page title displays "Leaidear" — no "VoiceOps" string is visible in the running app
  2. A Redis connection is live and accessible to server-side code in the Next.js app
  3. `chat_sessions` and `chat_messages` tables exist in Supabase with RLS policies that scope reads and writes to the owning org
  4. A static JS asset for the widget is served from the platform's own domain (route or public file), confirming no external CDN is required
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Wave 0 test scaffolds (brand, redis, widget tests)
- [x] 01-02-PLAN.md — Brand rename: VoiceOps → Leaidear across all src/ and doc files
- [x] 01-03-PLAN.md — Redis singleton client module and widget placeholder
- [x] 01-04-PLAN.md — Supabase chat schema migration (chat_sessions, chat_messages)

### Phase 2: Chat API
**Goal**: The public chat API is live, authenticates requests via org token, and persists conversation state
**Depends on**: Phase 1
**Requirements**: CHAT-04, CHAT-05, CHAT-06, INFRA-03
**Success Criteria** (what must be TRUE):
  1. A POST request to `/api/chat/[token]` with a valid org token is accepted and scoped to that org; an invalid or missing token returns a 401
  2. Each conversation receives a unique anonymous session ID that persists across messages within the same session
  3. Active session context is read from and written to Redis on every message exchange within a session
  4. Completed conversation turns are stored in `chat_messages` in Supabase and are queryable by org and session ID
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Wave 0: migration 012 (widget_token + session_key) and RED test scaffolds
- [x] 02-02-PLAN.md — Wave 1: session.ts and persist.ts helper implementations
- [ ] 02-03-PLAN.md — Wave 2: POST /api/chat/[token] route handler

### Phase 3: AI Conversation Engine
**Goal**: The chat API returns streamed AI responses that draw from the org's knowledge base and can invoke the action engine during conversation
**Depends on**: Phase 2
**Requirements**: CHAT-01, CHAT-02, CHAT-03
**Success Criteria** (what must be TRUE):
  1. A visitor message produces a streamed SSE response that begins arriving before the full answer is complete (not a single bulk response)
  2. When a visitor asks a question answerable from the org's knowledge base, the AI response accurately reflects that content
  3. When conversation context matches an org tool trigger, the action engine `executeAction` is called and its result is incorporated into the AI response
**Plans**: TBD
**UI hint**: yes

### Phase 4: Widget Embed Script
**Goal**: Any third-party site can install the chat widget with a single script tag and visitors can converse without logging in
**Depends on**: Phase 3
**Requirements**: WIDGET-01, WIDGET-02, WIDGET-03, WIDGET-04, WIDGET-05
**Success Criteria** (what must be TRUE):
  1. Pasting a single `<script>` tag into any HTML page (no framework, no build step) causes the chat widget to appear on that page
  2. The script loads asynchronously and does not block page rendering — the tag can be added via Google Tag Manager
  3. The widget appears as a floating bubble in the corner of the host page; clicking it expands a full chat panel
  4. The widget automatically connects to the correct org using the public token embedded in the script tag's attributes
  5. A visitor can send a message and receive a response without creating an account or completing any login flow
**Plans**: TBD
**UI hint**: yes

### Phase 5: Admin Configuration
**Goal**: Admins can customize, preview, and deploy the chat widget for their org from the Leaidear dashboard
**Depends on**: Phase 4
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04
**Success Criteria** (what must be TRUE):
  1. An admin can set the widget display name, primary color, and welcome message for their org and save the configuration
  2. The admin page shows a live preview of the widget that visually reflects any unsaved configuration changes
  3. The admin page shows a ready-to-copy embed `<script>` tag containing the org's public token
  4. An admin can regenerate the org's public token; the previously issued embed script stops working and a new one with the updated token must be installed
**Plans**: TBD
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete   | 2026-04-04 |
| 2. Chat API | 2/3 | In Progress|  |
| 3. AI Conversation Engine | 0/? | Not started | - |
| 4. Widget Embed Script | 0/? | Not started | - |
| 5. Admin Configuration | 0/? | Not started | - |

---

## Coverage

| REQ-ID | Phase |
|--------|-------|
| BRAND-01 | Phase 1 |
| BRAND-02 | Phase 1 |
| INFRA-01 | Phase 1 |
| INFRA-02 | Phase 1 |
| INFRA-04 | Phase 1 |
| CHAT-04 | Phase 2 |
| CHAT-05 | Phase 2 |
| CHAT-06 | Phase 2 |
| INFRA-03 | Phase 2 |
| CHAT-01 | Phase 3 |
| CHAT-02 | Phase 3 |
| CHAT-03 | Phase 3 |
| WIDGET-01 | Phase 4 |
| WIDGET-02 | Phase 4 |
| WIDGET-03 | Phase 4 |
| WIDGET-04 | Phase 4 |
| WIDGET-05 | Phase 4 |
| ADMIN-01 | Phase 5 |
| ADMIN-02 | Phase 5 |
| ADMIN-03 | Phase 5 |
| ADMIN-04 | Phase 5 |

**Total: 21/21 requirements mapped.**

---

*Last updated: 2026-04-04 — Phase 2 plans created (3 plans, 3 waves)*
