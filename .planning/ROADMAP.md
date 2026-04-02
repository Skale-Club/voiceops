# VoiceOps Roadmap — v1.0 MVP

## Milestone v1.0: VoiceOps MVP

**Goal:** Build the complete operational layer for agencies running voice AI via Vapi.ai — multi-tenant foundation, Action Engine, Observability, Knowledge Base, and Outbound Campaigns in a single admin panel.
**Requirements:** 42 total | **Phases:** 5

---

## Phases

- [ ] **Phase 1: Foundation** - Multi-tenant org management, authentication, and RLS data isolation
- [ ] **Phase 2: Action Engine** - Vapi webhook receiver, integration credentials, GoHighLevel execution, and action logging
- [ ] **Phase 3: Observability** - End-of-call ingestion, call list, chat-format transcripts, inline tool badges, and dashboard
- [ ] **Phase 4: Knowledge Base** - Document upload, vectorization pipeline, and RAG semantic search during calls
- [ ] **Phase 5: Outbound Campaigns** - Campaign creation, CSV contact import, Vapi outbound dialing, and real-time status tracking

---

## Phase Details

### Phase 1: Foundation
**Goal:** Admins can securely log in, manage organizations, and all data is isolated by tenant from day one
**Depends on:** Nothing (first phase)
**Requirements:** TEN-01, TEN-02, TEN-03, TEN-04, TEN-05, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. Admin can log in with email and password, stay logged in across browser refreshes, and log out from any page
  2. Unauthenticated users visiting any dashboard route are redirected to the login page
  3. Admin can create, update, deactivate, and list organizations — each scoped to their account
  4. Admin can link a Vapi assistant ID to an organization and toggle the mapping active/inactive
  5. Any database query made by one organization cannot return data belonging to another organization (RLS enforced on all tables)
**Plans:** TBD
**UI hint:** yes

---

### Phase 2: Action Engine
**Goal:** When Vapi triggers a tool during a live call, the platform receives the webhook, executes GoHighLevel business logic, logs the result, and responds to Vapi within 500ms
**Depends on:** Phase 1
**Requirements:** ACTN-01, ACTN-02, ACTN-03, ACTN-04, ACTN-05, ACTN-06, ACTN-07, ACTN-08, ACTN-09, ACTN-10, ACTN-11, ACTN-12
**Success Criteria** (what must be TRUE):
  1. Admin can configure encrypted GoHighLevel credentials per organization — credentials are never visible in plain text in the UI or database
  2. Admin can create a tool configuration mapping a Vapi tool name to an action type (create contact, check availability, book appointment) with an assigned integration and fallback message
  3. A real Vapi tool-call webhook sent to /api/vapi/tools is routed to the correct organization based on assistant ID and executes the configured GoHighLevel action
  4. Every tool execution is logged with status (success/error/timeout), execution time in milliseconds, and the request and response payloads
  5. When a tool execution fails, Vapi receives the configured fallback message within 500ms — the call does not go silent
**Plans:** TBD
**UI hint:** yes

---

### Phase 3: Observability
**Goal:** Admins can see every call that happened, read the full transcript with tool execution markers, and check aggregated metrics on a dashboard
**Depends on:** Phase 2
**Requirements:** OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07
**Success Criteria** (what must be TRUE):
  1. After a call ends, Vapi's end-of-call webhook is ingested and the call appears in the database with transcript, summary, duration, status, and cost
  2. Admin can view a paginated list of calls and filter by date range, assistant, status, and call type, or search by phone number and contact name
  3. Admin can open a call detail page and read the conversation in chat format with speaker turns clearly distinguished
  4. Inline badges appear between transcript turns showing each tool that fired — including tool name, success or failure, execution time, and error detail on failure
  5. The main dashboard displays total calls (today, week, month), tool success rate percentage, 10 most recent calls, and recent failure alerts — all scoped to the admin's organization
**Plans:** TBD
**UI hint:** yes

---

### Phase 4: Knowledge Base
**Goal:** Admins can upload documents to their organization's knowledge base and the platform answers knowledge queries from Vapi during live calls using semantic search
**Depends on:** Phase 2
**Requirements:** KNOW-01, KNOW-02, KNOW-03, KNOW-04, KNOW-05, KNOW-06
**Success Criteria** (what must be TRUE):
  1. Admin can upload a PDF, text file, or CSV, or add a website URL — each upload appears in the document list with a processing status indicator (Processing, Ready, or Error)
  2. Admin can delete a document from the knowledge base and confirm it no longer appears in the list
  3. An uploaded document transitions from Processing to Ready after its text is extracted, chunked, and stored as vector embeddings in pgvector
  4. When Vapi calls the knowledge_base tool during a live call, the platform performs a tenant-scoped semantic search and returns the top matching chunks to Vapi within the 500ms budget
  5. A semantic search against organization A's knowledge base returns zero results from organization B's documents
**Plans:** TBD
**UI hint:** yes

---

### Phase 5: Outbound Campaigns
**Goal:** Admins can create outbound calling campaigns with a contact list, start them, and monitor per-contact call status in real time
**Depends on:** Phase 3
**Requirements:** CAMP-01, CAMP-02, CAMP-03, CAMP-04, CAMP-05, CAMP-06, CAMP-07
**Success Criteria** (what must be TRUE):
  1. Admin can create a campaign with a name, selected Vapi assistant, schedule, and calls-per-minute cadence
  2. Admin can import a CSV file of contacts (name, phone, custom data) and see them listed under the campaign
  3. Admin can start, pause, and stop a campaign — the platform respects the configured cadence when dialing contacts via the Vapi Outbound API
  4. Each contact shows a real-time status (pending, calling, completed, failed, no answer) that updates as Vapi end-of-call webhooks arrive
  5. The same contact is never dialed more than once per campaign attempt — duplicate calls do not appear in the logs
**Plans:** TBD
**UI hint:** yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/? | Not started | - |
| 2. Action Engine | 0/? | Not started | - |
| 3. Observability | 0/? | Not started | - |
| 4. Knowledge Base | 0/? | Not started | - |
| 5. Outbound Campaigns | 0/? | Not started | - |

---

## Coverage Map

| Category | Requirements | Phase |
|----------|-------------|-------|
| Multi-Tenancy | TEN-01, TEN-02, TEN-03, TEN-04, TEN-05 | Phase 1 |
| Authentication | AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05 | Phase 1 |
| Action Engine | ACTN-01, ACTN-02, ACTN-03, ACTN-04, ACTN-05, ACTN-06, ACTN-07, ACTN-08, ACTN-09, ACTN-10, ACTN-11, ACTN-12 | Phase 2 |
| Observability | OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07 | Phase 3 |
| Knowledge Base | KNOW-01, KNOW-02, KNOW-03, KNOW-04, KNOW-05, KNOW-06 | Phase 4 |
| Outbound Campaigns | CAMP-01, CAMP-02, CAMP-03, CAMP-04, CAMP-05, CAMP-06, CAMP-07 | Phase 5 |

**Total mapped: 42/42** — 100% coverage

---

*Roadmap created: 2026-04-02*
*Milestone: v1.0 VoiceOps MVP*
