# Requirements: VoiceOps

**Defined:** 2026-03-30
**Core Value:** The Action Engine must work — when Vapi triggers a Tool during a live call, the platform receives the webhook, executes the business logic, and returns the result in under 500ms.

## v1 Requirements

### Multi-Tenancy

- [ ] **TEN-01**: Admin can create, update, and deactivate organizations (tenants)
- [ ] **TEN-02**: All database queries are automatically scoped to the user's organization via Supabase RLS
- [ ] **TEN-03**: Admin can link Vapi assistant IDs to specific organizations (assistant mapping)
- [ ] **TEN-04**: Admin can activate/deactivate assistant mappings without deleting them
- [ ] **TEN-05**: Admin can view a list of all organizations and their status

### Authentication

- [ ] **AUTH-01**: Admin can log in with email and password via Supabase Auth
- [ ] **AUTH-02**: Admin session persists across browser refreshes
- [ ] **AUTH-03**: Admin can log out from any page
- [ ] **AUTH-04**: Unauthenticated users are redirected to login page
- [ ] **AUTH-05**: User account is associated with an organization and role (admin/member)

### Action Engine

- [ ] **ACTN-01**: Platform receives Vapi tool-call webhooks via Edge Function and identifies the organization by assistant ID
- [ ] **ACTN-02**: Platform routes tool calls to the correct tool configuration for that organization
- [ ] **ACTN-03**: Admin can configure integration credentials per organization (GoHighLevel, Twilio, Cal.com, custom webhook)
- [ ] **ACTN-04**: Integration credentials are encrypted at rest and never exposed in the UI
- [ ] **ACTN-05**: Admin can test integration connections via a "Test Connection" button
- [ ] **ACTN-06**: Admin can create tool configurations mapping a Vapi tool name to an action type (create_contact, get_availability, create_appointment, send_sms, knowledge_base, custom_webhook)
- [ ] **ACTN-07**: Admin can assign a specific integration to each tool configuration
- [ ] **ACTN-08**: Admin can set a fallback message per tool that Vapi speaks if execution fails
- [ ] **ACTN-09**: Platform executes GoHighLevel actions (create contact, check availability, book appointment) using configured credentials
- [ ] **ACTN-10**: Platform logs every tool execution with status (success/error/timeout), execution time in ms, request payload, and response payload
- [ ] **ACTN-11**: Platform returns fallback message to Vapi if tool execution fails, preventing bot silence during live calls
- [ ] **ACTN-12**: Edge Function responds to Vapi within 500ms — heavy processing is delegated asynchronously via EdgeRuntime.waitUntil()

### Observability

- [ ] **OBS-01**: Platform receives end-of-call webhooks from Vapi and stores call logs with transcript, summary, duration, status, cost, and timestamps
- [ ] **OBS-02**: Admin can view a paginated call list with columns: date/time, duration, type (inbound/outbound), phone number, contact name, status
- [ ] **OBS-03**: Admin can filter calls by date range, assistant, status, and call type
- [ ] **OBS-04**: Admin can search calls by phone number or contact name
- [ ] **OBS-05**: Admin can view call detail with chat-format transcript showing conversation turns
- [ ] **OBS-06**: Call detail displays inline tool execution badges between transcript turns showing tool name, success/fail status, execution time, and error details on failure
- [ ] **OBS-07**: Main dashboard displays total calls (today, week, month), tool success rate percentage, 10 most recent calls, and recent failure alerts

### Knowledge Base

- [ ] **KNOW-01**: Admin can upload documents (PDF, text, CSV) to the organization's knowledge base
- [ ] **KNOW-02**: Admin can add website URLs for content extraction and vectorization
- [ ] **KNOW-03**: Platform processes uploaded content: extract text, split into chunks (~500 tokens), generate OpenAI embeddings, store in pgvector
- [ ] **KNOW-04**: Admin can see document processing status (Processing → Ready or Error)
- [ ] **KNOW-05**: Admin can delete documents from the knowledge base
- [ ] **KNOW-06**: Platform serves knowledge base queries during calls via semantic search against tenant-scoped pgvector data (returns top 3-5 most similar chunks)

### Outbound Campaigns

- [ ] **CAMP-01**: Admin can create outbound calling campaigns with name, selected assistant, and schedule (start/end time)
- [ ] **CAMP-02**: Admin can import contact lists via CSV upload (name, phone, custom data)
- [ ] **CAMP-03**: Admin can configure call cadence (calls per minute) per campaign
- [ ] **CAMP-04**: Admin can start, pause, and stop campaigns with real-time control
- [ ] **CAMP-05**: Platform dials contacts via Vapi Outbound API respecting configured cadence
- [ ] **CAMP-06**: Admin can monitor per-contact status (pending, calling, completed, failed, no answer) in real-time
- [ ] **CAMP-07**: Campaign status is tracked and updated via Vapi end-of-call webhook

## v2 Requirements

### Notifications

- **NOTF-01**: Admin receives email alerts when tool executions fail or latency exceeds threshold
- **NOTF-02**: Admin can configure alert rules per organization

### Client Panel

- **CLNT-01**: Client (member role) can log in and see only their organization's data
- **CLNT-02**: Client can view call logs, transcripts, and tool execution history (read-only)
- **CLNT-03**: Client can view dashboard metrics for their organization

### Additional Integrations

- **INTG-01**: Twilio SMS executor for send_sms action type
- **INTG-02**: Cal.com executor for appointment scheduling
- **INTG-03**: Generic custom webhook executor (configurable URL, method, headers, body template)

### Billing

- **BILL-01**: Usage tracking per organization (call minutes, tool executions, API calls)
- **BILL-02**: Stripe integration for automated billing and invoicing

## Out of Scope

| Feature | Reason |
|---------|--------|
| Voice processing (STT/TTS) | Handled by Vapi — not our responsibility |
| Assistant configuration UI | Done in Vapi Dashboard — avoid duplication |
| LLM conversation logic | Vapi manages conversation flow and model selection |
| Phone number provisioning | Vapi + Twilio/Telnyx handles telephony |
| Payment processing (Stripe) in MVP | Monthly invoicing outside platform for now |
| OAuth/social login | Email/password sufficient for MVP |
| Mobile application | Web-first, responsive |
| Multi-language UI | English-only for MVP, PT/EN later |
| Drag-and-drop workflow builder | Sequential card UI sufficient for MVP |
| Real-time call monitoring (live streaming) | High complexity, post-MVP |
| White-label branding | Post-MVP competitive feature |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEN-01 | — | Pending |
| TEN-02 | — | Pending |
| TEN-03 | — | Pending |
| TEN-04 | — | Pending |
| TEN-05 | — | Pending |
| AUTH-01 | — | Pending |
| AUTH-02 | — | Pending |
| AUTH-03 | — | Pending |
| AUTH-04 | — | Pending |
| AUTH-05 | — | Pending |
| ACTN-01 | — | Pending |
| ACTN-02 | — | Pending |
| ACTN-03 | — | Pending |
| ACTN-04 | — | Pending |
| ACTN-05 | — | Pending |
| ACTN-06 | — | Pending |
| ACTN-07 | — | Pending |
| ACTN-08 | — | Pending |
| ACTN-09 | — | Pending |
| ACTN-10 | — | Pending |
| ACTN-11 | — | Pending |
| ACTN-12 | — | Pending |
| OBS-01 | — | Pending |
| OBS-02 | — | Pending |
| OBS-03 | — | Pending |
| OBS-04 | — | Pending |
| OBS-05 | — | Pending |
| OBS-06 | — | Pending |
| OBS-07 | — | Pending |
| KNOW-01 | — | Pending |
| KNOW-02 | — | Pending |
| KNOW-03 | — | Pending |
| KNOW-04 | — | Pending |
| KNOW-05 | — | Pending |
| KNOW-06 | — | Pending |
| CAMP-01 | — | Pending |
| CAMP-02 | — | Pending |
| CAMP-03 | — | Pending |
| CAMP-04 | — | Pending |
| CAMP-05 | — | Pending |
| CAMP-06 | — | Pending |
| CAMP-07 | — | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 0
- Unmapped: 42 ⚠️

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after initial definition*
