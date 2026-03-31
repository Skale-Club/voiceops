# Feature Landscape

**Domain:** Multi-tenant Voice AI Operations Platform (Vapi.ai agency layer)
**Researched:** 2026-03-30
**Confidence:** HIGH (based on Vapi official docs, direct competitor analysis, and adjacent platform research)

## Research Sources

| Source | Type | Confidence |
|--------|------|------------|
| [Vapi Docs](https://docs.vapi.ai) | Official documentation | HIGH |
| [Vapi Server Events](https://docs.vapi.ai/server-url/events.mdx) | Official documentation | HIGH |
| [Vapi Outbound Campaigns](https://docs.vapi.ai/outbound-campaigns/overview.mdx) | Official documentation | HIGH |
| [ChatDash](https://docs.vapi.ai/providers/chat-dash.mdx) | Direct competitor (Vapi ecosystem) | HIGH |
| [Vapify](https://docs.vapi.ai/providers/vapify.mdx) | Direct competitor (Vapi ecosystem) | HIGH |
| [Voicerr AI](https://docs.vapi.ai/providers/voicerr-ai.mdx) | Direct competitor (Vapi ecosystem) | HIGH |
| [VoiceAIWrapper](https://docs.vapi.ai/providers/voiceaiwrapper.mdx) | Direct competitor (Vapi ecosystem) | HIGH |
| [Sympana](https://docs.vapi.ai/providers/sympana-connector.mdx) | Adjacent (GHL-specific connector) | HIGH |
| [Retell AI](https://retellai.com) | Adjacent voice AI platform | MEDIUM |
| [Bland AI](https://bland.ai) | Adjacent voice AI platform | MEDIUM |

## What Vapi Already Provides (Do NOT Build)

VoiceOps sits ON TOP of Vapi, not next to it. These features exist natively in Vapi and must not be reimplemented:

| Feature | Where It Lives | VoiceOps Role |
|---------|---------------|---------------|
| STT/TTS/LLM pipeline | Vapi | None |
| Assistant config (prompts, voice, model) | Vapi Dashboard + API | Link assistant IDs to tenants |
| Tool calling mechanism | Vapi → webhook to your server | **Receive and execute** tool-calls |
| Native Knowledge Base | Vapi (file upload + query tool) | VoiceOps builds its own pgvector KB for tenant-scoped RAG |
| Outbound campaigns (basic) | Vapi Dashboard + API | VoiceOps may wrap these for multi-tenant campaign management |
| Call recording & transcription | Vapi artifact plan | Ingest via `end-of-call-report` webhook |
| Phone number management | Vapi Dashboard + API | None (admin uses Vapi dashboard) |
| Evals & testing | Vapi Dashboard | None |
| Analytics boards | Vapi Dashboard (single-org) | VoiceOps builds per-tenant dashboards |
| SIP trunking | Vapi | None |

---

## Table Stakes

Features users expect. Missing = platform feels incomplete or unusable for agencies managing multiple clients.

### Core Platform

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Multi-tenant org management** (CRUD) | Every competitor assumes single-tenant. Agencies managing 5+ clients can't operate without org scoping. This is VoiceOps's primary reason to exist. | Medium | Supabase RLS on all tables with `organization_id` |
| **User authentication** (email/password) | Basic SaaS requirement. All competitors have it. | Low | Supabase Auth. Admin + client roles. |
| **Role-based access control** | Admin (agency) sees all tenants. Client sees only their data. All competitors differentiate admin/client views. | Medium | Two roles for MVP: `admin`, `client_member`. Supabase RLS policies. |
| **Assistant-to-org mapping** | Without linking Vapi assistant IDs to tenants, you can't route tool-calls to the right org. This is the multi-tenancy foundation. | Low | Simple lookup table: `assistant_id → organization_id` |

### Action Engine (The Heart)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Tool-call webhook receiver** | Vapi sends `tool-calls` events to your server URL. If you don't receive and respond, tools fail during live calls. This IS the product. | High | MUST be Edge Function. Sub-500ms response required. Acknowledge immediately, execute async if heavy. |
| **Tool execution with status logging** | Every tool execution must be logged (status, timing, request/response). Without logs, you can't debug failed calls. All competitors show execution details. | Medium | `action_logs` table with `organization_id`, tool name, status, duration, payloads. |
| **Integration credential management** | Per-org encrypted credentials for GHL, Twilio, Cal.com, custom webhooks. Without this, you can't execute actions on behalf of each client. | Medium | Encrypt at rest. Never expose in UI. Per-organization scoping. |
| **GoHighLevel integration** | First client uses GHL. This is the highest-priority integration. Vapi has native GHL tools but they're single-action. VoiceOps needs multi-step workflow support. | High | Create contact, check availability, book appointment, send SMS. Sympana proves this is a viable market. |
| **Configurable trigger-action rules** | The "n8n Lite" — admin maps a Vapi tool name to a sequence of actions (create contact → check availability → book). This replaces scattered n8n workflows. | High | Visual config UI. Tool name → ordered list of actions against integrations. |

### Observability

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **End-of-call webhook ingestion** | Vapi sends `end-of-call-report` with transcript, recording, messages, metadata. All competitors ingest and display this. | Medium | Store `call_logs` with `organization_id`, transcript, summary, duration, status, timestamps. |
| **Call list with filters** | Every competitor shows a call log. Users need to search by date, assistant, status, type, phone number. This is how agencies prove value to clients. | Medium | Filterable, paginated table. Scoped to organization via RLS. |
| **Call detail with chat-format transcript** | All competitors show transcripts. VoiceOps differentiates by showing inline tool execution badges (success/fail with timing) interleaved in the conversation. | Medium | Chat bubble UI. Tool badges between messages showing what happened during the call. |
| **Dashboard with aggregated metrics** | Total calls, tool success rate, recent calls, failure alerts. All competitors have a dashboard. This is the landing page. | Medium | Per-organization aggregation. KPI cards + recent calls table + failure alerts. |

### Data Isolation

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Supabase RLS on all tables** | Data isolation is non-negotiable for multi-tenant. Even with code bugs, client A must never see client B's data. | Medium | Every table has `organization_id`. RLS policies enforce `auth.uid() → org membership → org_id match`. |

---

## Differentiators

Features that set VoiceOps apart from ChatDash, Vapify, Voicerr, VoiceAIWrapper. These platforms are all single-tenant white-label dashboards. VoiceOps is a multi-tenant operations engine.

### High-Value Differentiators (Build in MVP or Phase 2)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Multi-tenant Action Engine** | No competitor offers per-tenant tool execution with credential isolation. They either show data (ChatDash) or are single-tenant (Voicerr). VoiceOps owns the execution layer. | High | This is the core moat. Tool-call → org lookup → credential fetch → action execution → response. |
| **Inline tool badges in transcripts** | Showing exactly when tools fired during a call (with timing and success/fail) interleaved in the chat transcript. No competitor does this. It proves the system works. | Medium | Merge `call_logs.messages` with `action_logs` by timestamp/call_id. Show as badges in chat UI. |
| **Tenant-scoped RAG (pgvector)** | Own knowledge base per org with pgvector + OpenAI embeddings. Vapi's native KB is per-assistant, not per-tenant. VoiceOps lets each client have private knowledge bases that the Action Engine can query during calls. | High | Upload docs → chunk → embed → store in pgvector with `organization_id`. Query during tool execution or via `knowledge-base-request` webhook. |
| **Visual trigger-action workflow builder** | Simplified "n8n Lite" UI where admin configures tool → action sequences without code. Sympana charges for this. Vapi's native tools are single-action. Multi-step is VoiceOps's differentiator. | High | Drag-and-drop or sequential card UI. "When tool X fires → do A, then B, then C" against integrations. |

### Medium-Value Differentiators (Build in Phase 2-3)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Real-time call monitoring** | Live view of in-progress calls with streaming transcript. Voicerr and VoiceAIWrapper mention real-time metrics. VoiceOps could show live calls with tool execution status updating in real-time. | High | Uses Vapi `transcript`, `speech-update`, `status-update` webhooks. WebSocket or SSE for live UI updates. |
| **Campaign management with cadence** | Vapi has basic outbound campaigns. VoiceOps adds multi-tenant campaign management with configurable cadence, retry logic, and real-time status tracking per contact. | High | Campaign → contacts list → cadence rules → Vapi outbound API. Track per-contact status. |
| **Post-call analysis & scoring** | Vapi has evals and scorecards. VoiceOps can auto-analyze calls for quality, extract structured data (sentiment, outcome, topics) and display per-tenant insights. | Medium | Use Vapi's `call-analysis` or run custom LLM analysis on stored transcripts. Display as call scores. |
| **Client-facing read-only panel** | Eventually, clients get their own view showing their call logs, transcripts, and tool execution history. ChatDash, Vapify, Voicerr all offer this. VoiceOps should too, but later. | Medium | `client_member` role with RLS. Same UI components, filtered to their org. No config/edit access. |
| **Failure alerting** | Proactive notification when tool executions fail or latency exceeds thresholds. No competitor does this well. Agencies need to know before their clients do. | Medium | Alert rules → email/webhook/slack notification when `action_logs.status = 'failed'` or latency > threshold. |

### Future Differentiators (Post-MVP)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Stripe billing/rebilling** | All white-label competitors (ChatDash, Vapify, Voicerr) offer usage-based billing via Stripe. VoiceOps can track per-org usage and enable markup. | High | Track call minutes, tool executions, API calls per org. Stripe integration for invoicing. |
| **Custom webhooks for actions** | Generic webhook action type that lets admin configure any HTTP request as an action (method, URL, headers, body template, auth). Sympana does this for GHL specifically; VoiceOps makes it generic. | Medium | Action type: `custom_webhook`. Configurable URL, method, headers, body template with variable interpolation from tool-call params. |
| **Multi-integration support** | Beyond GHL: Cal.com (appointments), Twilio (SMS), HubSpot, Salesforce, custom APIs. VoiceAIWrapper lists many integrations. | Medium-High | Each integration = adapter with auth + actions. Start with GHL, add Cal.com and custom webhook. |
| **A/B testing for actions** | Test different action configurations (e.g., different GHL pipelines, different SMS templates) and compare outcomes. Vapi has A/B for assistants. VoiceOps extends to actions. | High | Route tool-calls to different action configs based on rules. Track and compare outcomes. |
| **White-label branding** | ChatDash, Vapify, Voicerr all offer custom branding (logo, domain, colors). VoiceOps should eventually support this for client-facing panels. | Medium | Custom domain, logo upload, color scheme per organization. |

---

## Anti-Features

Features to explicitly NOT build. These exist in Vapi or other tools and building them wastes time or creates confusion.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Voice processing (STT/TTS)** | Vapi handles the entire voice pipeline. Rebuilding is months of work and can't compete with Vapi's latency. | Use Vapi. VoiceOps is the operations layer, not the voice layer. |
| **Assistant configuration UI** | Vapi Dashboard already has full assistant config (prompts, voice, model, temperature). Duplicating creates confusion about where to configure. | Admin configures assistants in Vapi Dashboard. VoiceOps only stores the `assistant_id` mapping. |
| **LLM conversation logic** | Vapi manages the entire conversation flow, including model selection, system prompts, and conversation state. This is Vapi's core competency. | Use Vapi's assistant and squad configs. VoiceOps executes tools, not conversations. |
| **Phone number provisioning** | Vapi + Twilio/Telnyx handles phone numbers, SIP trunking, and telephony. Building this is a separate product. | Admin provisions numbers in Vapi Dashboard. VoiceOps references them in call logs. |
| **Payment processing (Stripe) in MVP** | All competitors offer billing, but billing is a distraction before the Action Engine works. Monthly invoicing outside the platform is fine for 20 clients. | Defer to post-MVP. Track usage metrics internally so billing data is ready when Stripe is integrated. |
| **Visual workflow/drag-and-drop builder in MVP** | Full drag-and-drop builders (like n8n) are extremely complex to build well. MVP should use a simpler sequential card UI. | Start with ordered list of actions per tool. Add visual builder post-MVP if needed. |
| **OAuth/social login** | Email/password is sufficient. Adding Google/GitHub login is nice-to-have but doesn't solve any agency problem. | Supabase Auth email/password. Add OAuth providers later when client-facing panel launches. |
| **In-app real-time notifications** | WebSocket-based notifications are engineering-heavy. Agencies will check the dashboard. Email alerts for failures are more practical. | Email alerts for failures. Dashboard shows recent activity. Add real-time notifications post-MVP. |
| **Mobile app** | All competitors are web-first. Agencies manage from desktop. Mobile is a future nice-to-have. | Responsive web UI. Mobile-optimized views post-MVP. |
| **Multi-language UI (PT/EN) in MVP** | Bilingual support is planned but adds translation overhead. English-only for MVP, bilingual later. | English-only UI. i18n-ready architecture (use translation keys), implement PT later. |
| **Native Vapi KB replacement** | Vapi has a built-in knowledge base. VoiceOps shouldn't try to replace it for basic use cases. Only build pgvector KB for tenant-scoped data that Vapi's KB can't handle. | Use Vapi's native KB for per-assistant knowledge. VoiceOps pgvector KB for tenant-scoped data queried during tool execution. |
| **Campaign creation UI in MVP** | Vapi has campaign creation in its dashboard. VoiceOps should track and display campaign results, not recreate campaign creation. MVP focuses on Action Engine + Observability. | Admin creates campaigns in Vapi Dashboard. VoiceOps ingests campaign call results and shows per-tenant analytics. Add campaign creation UI post-MVP. |

---

## Feature Dependencies

```
Multi-tenant org management (foundation)
├── User authentication (needs org membership)
├── Role-based access control (needs roles + org)
├── Assistant-to-org mapping (needs org)
├── Supabase RLS on all tables (needs org_id on every table)
│
├── Action Engine (needs org mapping + RLS)
│   ├── Tool-call webhook receiver (needs assistant-to-org mapping)
│   ├── Integration credential management (needs org scoping)
│   ├── GoHighLevel integration (needs credential management)
│   ├── Configurable trigger-action rules (needs credential management)
│   └── Tool execution with status logging (needs all above)
│
├── Observability (needs org mapping + RLS)
│   ├── End-of-call webhook ingestion (needs org mapping)
│   ├── Call list with filters (needs call logs stored)
│   ├── Call detail with transcript (needs call logs + transcripts)
│   ├── Inline tool badges (needs both call_logs AND action_logs)
│   └── Dashboard with aggregated metrics (needs all above)
│
├── Knowledge Base / RAG (needs org mapping + RLS)
│   ├── Document upload + processing (needs org scoping)
│   ├── Vector chunking + embedding (needs document storage)
│   └── Semantic search during tool execution (needs pgvector + Action Engine)
│
├── Outbound Campaigns (needs org mapping + RLS)
│   ├── Campaign creation with contact import (needs org scoping)
│   ├── Campaign execution via Vapi API (needs Vapi integration)
│   └── Campaign status tracking (needs call logs from Vapi webhooks)
│
└── Client-facing panel (needs ALL above working)
    ├── Client auth with limited role (needs RBAC)
    └── Read-only views of org-scoped data (needs RLS + all data models)
```

### Critical Dependency Chain (What Must Be Built First)

```
1. Org management + Auth + RLS          (everything depends on this)
2. Assistant-to-org mapping             (tool routing depends on this)
3. Tool-call webhook receiver (Edge Fn) (Action Engine depends on this)
4. Credential management + GHL integ.   (tool execution depends on this)
5. Tool execution + logging             (observability depends on this)
6. End-of-call webhook ingestion        (call logs depend on this)
7. Call list + detail views             (dashboard depends on this)
8. Dashboard with metrics               (landing page needs this)
```

---

## MVP Recommendation

### Must Have (Ship First)
These form the minimum viable product. Without any of these, the platform doesn't solve the core problem (replacing n8n for multi-client management).

1. **Multi-tenant org management** — CRUD organizations, RLS on all tables
2. **User authentication** — Admin login, org membership
3. **Assistant-to-org mapping** — Link Vapi assistant IDs to organizations
4. **Tool-call webhook receiver** — Edge Function receiving Vapi tool-calls, routing to org
5. **Integration credential management** — Encrypted per-org GHL credentials
6. **GoHighLevel integration** — Create contact, check availability, book appointment, send SMS
7. **Configurable trigger-action rules** — "n8n Lite" sequential action config per tool
8. **Tool execution with logging** — Execute actions, log status/timing/payloads
9. **End-of-call webhook ingestion** — Store call_logs with transcripts and metadata
10. **Call list with filters** — Searchable, filterable call history per org
11. **Call detail with inline tool badges** — Chat transcript with tool execution markers
12. **Dashboard with aggregated metrics** — Total calls, tool success rate, recent calls, alerts

### Should Have (Ship in Phase 2)
These complete the platform and add the features agencies will start asking for.

1. **Knowledge Base / RAG** — pgvector document storage with tenant scoping
2. **Campaign management** — Contact import, cadence config, Vapi outbound API integration
3. **Post-call analysis** — Auto-scoring, sentiment, outcome extraction
4. **Failure alerting** — Email/webhook notifications on tool failures
5. **Custom webhook action type** — Generic HTTP request action beyond GHL

### Could Have (Ship Post-MVP)
These are competitive features seen in ChatDash/Vapify/Voicerr but not required for initial value delivery.

1. **Client-facing read-only panel** — Client role with scoped views
2. **Stripe billing/rebilling** — Usage tracking and invoicing
3. **Real-time call monitoring** — Live transcript and tool execution view
4. **White-label branding** — Custom logo, domain, colors per org
5. **Multi-integration support** — Cal.com, Twilio SMS, HubSpot, Salesforce
6. **A/B testing for actions** — Compare action config outcomes
7. **Multi-language UI (PT/EN)** — Bilingual support

### Defer Indefinitely
These are explicitly out of scope per PROJECT.md or are better handled by Vapi natively.

1. Voice processing / STT / TTS
2. Assistant configuration UI
3. LLM conversation logic
4. Phone number provisioning
5. Mobile application

---

## Competitive Feature Matrix

What VoiceOps competitors offer vs what VoiceOps plans:

| Feature | ChatDash | Vapify | Voicerr | VoiceAIWrapper | Sympana | **VoiceOps** |
|---------|----------|--------|---------|----------------|---------|-------------|
| Multi-tenant isolation | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **(unique)** |
| Custom tool execution | ❌ | ❌ | ❌ | ❌ | ✅ (GHL only) | ✅ **(any integration)** |
| Per-org credentials | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **(unique)** |
| Inline tool badges | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **(unique)** |
| Tenant-scoped RAG | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **(unique)** |
| Call logs + transcripts | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Analytics dashboard | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| White-label branding | ✅ | ✅ | ✅ | ✅ | ❌ | Planned |
| Stripe billing | ✅ | ✅ | ✅ | ✅ | ❌ | Planned |
| Campaign management | ❌ | ✅ (batch) | ✅ | ✅ | ✅ (GHL) | Phase 2 |
| GHL integration | ❌ | ❌ | ❌ | ❌ | ✅ (deep) | ✅ |
| Client portal | ✅ | ✅ | ✅ | ✅ | ❌ | Planned |
| Lead finder / automation | ❌ | ❌ | ✅ | ❌ | ❌ | Not planned |

**Key Insight:** VoiceOps's competitive moat is NOT white-label dashboards or billing (every competitor has those). The moat is **multi-tenant tool execution with per-org credential isolation**. No competitor does this. They all assume single-tenant Vapi usage with display-only dashboards.

---

## Sources

- Vapi Official Docs: https://docs.vapi.ai (server events, tools, campaigns, knowledge base, observability)
- Vapi Ecosystem Partners: ChatDash, Vapify, Voicerr AI, VoiceAIWrapper, Sympana Connector — all documented at docs.vapi.ai/providers/
- Retell AI: https://retellai.com — adjacent voice AI platform for feature comparison
- Bland AI: https://bland.ai — adjacent voice AI platform for feature comparison
- Project context: `.planning/PROJECT.md`
