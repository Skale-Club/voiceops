# 🚀 VoiceOps — SaaS Add-on Platform for Vapi.ai
## Complete Architecture & Implementation Master Prompt

---

## 1. PROJECT OVERVIEW

### What It Is
A multi-tenant SaaS platform that works as an **operational complement** to Vapi.ai. It is NOT a Vapi competitor — everything Vapi already does (STT, TTS, LLM, assistant configuration, system prompt, voice selection), the platform does NOT replicate.

### What It Solves
Today, to operate a voice assistant via Vapi for each client, it's necessary to maintain multiple workflows in n8n — each with separate webhooks, duplicated credentials, scattered logic, and zero visibility for the end client. Scaling from 1 to 20+ clients in this model is unsustainable.

The platform centralizes the entire **action execution (Tools)**, **knowledge base (RAG)**, **outbound campaigns**, and **call observability** layer into a single multi-tenant panel — completely eliminating the dependency on n8n.

### Business Model
- The agency (us) is the **admin/owner** of the platform
- Each served company is an **organization** (tenant) within the platform
- The admin provisions accounts, configures integrations, and manages everything
- The end client sees only their panel with logs, transcripts, and automation statuses
- Monetization: monthly billing per client (managed outside the platform initially — no Stripe in the MVP)

### Fundamental Principle
> **If Vapi already does it, we DON'T do it. The platform exists to do what Vapi DOESN'T do.**

---

## 2. RESPONSIBILITY SPLIT

### What Vapi Handles:
- Receiving/making phone calls
- Speech-to-Text (listening to the user)
- Processing conversational logic via LLM
- Text-to-Speech (speaking to the user)
- Deciding when a Tool needs to be called
- Assistant configuration (prompt, voice, model)

### What the Platform (VoiceOps) Handles:
- **Mapping**: Linking a `vapi_assistant_id` to a specific client (organization)
- **Tool Execution**: Receiving the Vapi webhook when a Tool is triggered → executing the business logic (create contact in CRM, check calendar, send SMS, fetch data) → returning the result to Vapi
- **Knowledge Base (RAG)**: Providing an endpoint where Vapi queries the client's documents/data in real-time during the call
- **Outbound Campaigns**: Managing contact lists and triggering call loops via Vapi API
- **Observability**: Showing transcript, Tool statuses (✅/❌), detailed logs — all visual and accessible to the end client

---

## 3. TECHNOLOGY STACK

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Framework | **Next.js 14+ (App Router)** | Full-stack, SSR, API Routes, Edge Functions |
| Language | **TypeScript** | Type safety across the entire project |
| Database | **Supabase (PostgreSQL)** | Native RLS for multi-tenant, pgvector for RAG, integrated Auth |
| Vectorization | **pgvector (Supabase)** | Embeddings for knowledge base |
| Embeddings | **OpenAI text-embedding-3-small** | Vector generation for RAG |
| Hosting | **Vercel** | Automatic deploy, Edge Functions for Vapi webhooks |
| CI/CD | **GitHub Actions** | Automated test + deploy pipeline |
| Integrations | **Direct REST APIs** | GoHighLevel, Twilio, Cal.com, and any CRM/calendar via HTTP |
| Authentication | **Supabase Auth** | User login (admin and clients) |

### Important Architectural Decisions

**Edge Functions for Vapi Webhooks (REQUIRED):**
- Vapi is extremely latency-sensitive. If the Tool takes too long to respond, the bot goes silent and the experience breaks.
- All routes that Vapi calls (`/api/vapi/*`) MUST be Edge Functions (no cold start).
- If the action requires heavy processing (generate PDF, process large document), the Edge Function responds immediately to Vapi with a transition phrase and delegates the heavy work to an asynchronous Serverless Function.

**Supabase RLS for Multi-Tenant:**
- Each database query is automatically filtered by the logged-in user's `organization_id`.
- It's impossible for client A to see client B's data, even with a bug in the code.

---

## 4. DATABASE STRUCTURE (Supabase)

### Main Tables

```sql
-- ============================================
-- MULTI-TENANT CORE
-- ============================================

-- Companies/clients of the agency
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                        -- "Alpha Home Improvements", "FastClean Pro", etc.
  slug TEXT UNIQUE NOT NULL,                 -- URL-friendly identifier
  status TEXT DEFAULT 'active',              -- active | paused | canceled
  settings JSONB DEFAULT '{}',               -- general tenant settings
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Users linked to organizations
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  role TEXT DEFAULT 'member',                -- admin | owner | member
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- VAPI MAPPING (bridge between Vapi and the platform)
-- ============================================

-- Links Vapi assistants to organizations
CREATE TABLE assistant_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  vapi_assistant_id TEXT NOT NULL,           -- Assistant ID in Vapi
  label TEXT,                                -- friendly name: "Scheduling Bot", "Outbound SDR"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- CREDENTIALS AND INTEGRATIONS
-- ============================================

-- External service credentials per organization (encrypted)
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  provider TEXT NOT NULL,                    -- 'ghl' | 'twilio' | 'cal_com' | 'google_calendar' | 'custom'
  label TEXT,                                -- "Main GoHighLevel", "Twilio SMS"
  credentials JSONB NOT NULL,                -- { api_key, location_id, calendar_id, etc. } (ENCRYPT in production)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ACTION ENGINE (the "n8n Lite")
-- ============================================

-- Configuration of Tools that Vapi will call
CREATE TABLE tools_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  tool_name TEXT NOT NULL,                   -- Tool name in Vapi: "add_to_crm", "get_dates", "book_appt", "get_estimates"
  provider TEXT NOT NULL,                    -- which integration to use: 'ghl', 'cal_com', 'custom_webhook'
  integration_id UUID REFERENCES integrations(id), -- link to credentials
  action_type TEXT NOT NULL,                 -- 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'webhook' | 'knowledge_base'
  config JSONB DEFAULT '{}',                 -- action-specific parameters (calendar_id, pipeline_id, field_mappings, etc.)
  fallback_message TEXT,                     -- message Vapi speaks if the Tool fails
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- KNOWLEDGE BASE (RAG)
-- ============================================

-- Knowledge base documents
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  title TEXT NOT NULL,                       -- "2025 Pricing Table", "Services FAQ"
  source_type TEXT NOT NULL,                 -- 'pdf' | 'url' | 'text' | 'csv'
  source_url TEXT,                           -- Original URL if applicable
  raw_content TEXT,                          -- Extracted text
  status TEXT DEFAULT 'processing',          -- processing | ready | error
  chunk_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Vectorized chunks for semantic search
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  content TEXT NOT NULL,                     -- chunk text
  embedding VECTOR(1536),                    -- OpenAI text-embedding-3-small vector
  metadata JSONB DEFAULT '{}',               -- { page, section, source }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for vector search
CREATE INDEX ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- OUTBOUND CAMPAIGNS
-- ============================================

-- Mass calling campaigns
CREATE TABLE outbound_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  assistant_mapping_id UUID REFERENCES assistant_mappings(id) NOT NULL,
  name TEXT NOT NULL,                        -- "January Quote Follow-ups"
  status TEXT DEFAULT 'draft',               -- draft | scheduled | running | paused | completed
  schedule_start TIMESTAMPTZ,                -- when to start calls
  schedule_end TIMESTAMPTZ,                  -- end time window
  calls_per_minute INTEGER DEFAULT 1,        -- cadence to avoid overload
  total_contacts INTEGER DEFAULT 0,
  completed_contacts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign contacts
CREATE TABLE outbound_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES outbound_campaigns(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  phone_number TEXT NOT NULL,
  name TEXT,
  custom_data JSONB DEFAULT '{}',            -- extra data that can be injected into the conversation
  status TEXT DEFAULT 'pending',             -- pending | calling | completed | failed | no_answer
  vapi_call_id TEXT,                         -- Call ID in Vapi after dialing
  called_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- OBSERVABILITY AND LOGS
-- ============================================

-- Call logs (synced via Vapi webhook)
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  assistant_mapping_id UUID REFERENCES assistant_mappings(id),
  vapi_call_id TEXT UNIQUE NOT NULL,         -- Call ID in Vapi
  call_type TEXT,                            -- 'inbound' | 'outbound'
  phone_number TEXT,                         -- client number
  contact_name TEXT,                         -- name if available
  duration_seconds INTEGER,
  cost DECIMAL(10,4),                        -- call cost in Vapi
  status TEXT,                               -- 'completed' | 'failed' | 'no-answer' | 'busy'
  transcript JSONB,                          -- full transcript [{role, content, timestamp}]
  summary TEXT,                              -- AI-generated summary
  ended_reason TEXT,                         -- reason the call ended
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Execution log for each Tool during a call
CREATE TABLE action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_log_id UUID REFERENCES call_logs(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) NOT NULL,
  tool_name TEXT NOT NULL,                   -- "add_to_crm", "get_dates", "book_appt"
  tool_config_id UUID REFERENCES tools_config(id),
  status TEXT NOT NULL,                      -- 'success' | 'error' | 'timeout'
  request_payload JSONB,                     -- what Vapi sent
  response_payload JSONB,                    -- what was returned to Vapi
  error_message TEXT,                        -- error message if failed
  execution_time_ms INTEGER,                 -- execution time in ms
  executed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tools_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_logs ENABLE ROW LEVEL SECURITY;

-- Default policy: user only sees data from their organization
-- (Apply to ALL tables above)
-- Example for call_logs:
CREATE POLICY "Users see own org data" ON call_logs
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Repeat pattern for all tables with organization_id
```

---

## 5. PLATFORM MODULES

### Module 1: Main Dashboard
**Route:** `/dashboard`

Quick overview of the tenant:
- Total calls (today, week, month)
- Tool success rate (% of executions without errors)
- Recent calls (last 10) with visual status
- Recent failure alerts

### Module 2: Assistants (Mapping)
**Route:** `/dashboard/assistants`

Simple interface to link Vapi assistants to the organization:
- Field: `Vapi Assistant ID`
- Field: `Label` (friendly name)
- Toggle: Active/Inactive
- List of linked assistants

**Does NOT manage assistant configuration** — that is done in the Vapi dashboard.

### Module 3: Integrations (Credentials)
**Route:** `/dashboard/integrations`

Tab where the client connects their external services:
- **GoHighLevel**: API Key + Location ID + Calendar ID
- **Twilio**: Account SID + Auth Token + Phone Number
- **Cal.com**: API Key + Event Type ID
- **Custom Webhook**: URL + Headers + Method
- Interface: cards per provider, form to fill in credentials
- Connection status (testable via "Test Connection" button)

### Module 4: Action Engine ("n8n Lite")
**Route:** `/dashboard/tools`

The heart of the platform. Simplified visual **Trigger → Action** interface:

```
┌─────────────────────────────────────────────────────┐
│  TOOL: "schedule_visit"                             │
│                                                     │
│  When Vapi calls this Tool:                         │
│                                                     │
│  1. Create contact in GoHighLevel ✅                │
│     ├─ Integration: [Main GoHighLevel ▼]            │
│     ├─ Name Field: {{first_name}}                   │
│     └─ Phone Field: {{phone}}                       │
│                                                     │
│  2. Search available time slots ✅                  │
│     ├─ Integration: [Main GoHighLevel ▼]            │
│     └─ Calendar: [Visit Schedule ▼]                 │
│                                                     │
│  3. Send confirmation SMS                           │
│     ├─ Integration: [Twilio ▼]                      │
│     └─ Message: "Hello {{name}}, your visit..."     │
│                                                     │
│  If failed: "Sorry, I had a technical issue..."     │
└─────────────────────────────────────────────────────┘
```

**How it works technically:**
1. The admin configures in Vapi that the Tool `schedule_visit` points to `https://voiceops.vercel.app/api/vapi/tools`
2. When Vapi calls the Tool, the webhook receives `tool_name` + `assistant_id`
3. The Edge Function identifies the `organization` by `assistant_id`
4. Fetches the `tools_config` corresponding to the `tool_name` for that tenant
5. Executes the action (HTTP call to GHL, Twilio, etc.) using the `integrations` credentials
6. Logs everything in `action_logs`
7. Returns the result to Vapi (which reads it to the user on the call)

**Available pre-configured actions:**
- `create_contact` — Create/update contact in CRM
- `get_availability` — Check available time slots in calendar
- `create_appointment` — Schedule appointment
- `send_sms` — Send SMS via Twilio
- `send_email` — Send email (via integration)
- `knowledge_base` — Query RAG knowledge base
- `custom_webhook` — Call any external URL with customizable payload
- `get_estimate` — Check pricing table / generate quote

### Module 5: Knowledge Base (RAG)
**Route:** `/dashboard/knowledge`

Interface for the client to upload data that the bot can query during the call:

- **PDF Upload**: Extract text → chunk → vectorize → save to pgvector
- **Website URL**: Scrape → extract text → chunk → vectorize
- **Free Text**: Paste directly → chunk → vectorize
- **CSV/Spreadsheet**: Import structured data (pricing table, catalog)

**Processing flow (asynchronous):**
1. Upload via interface → save file to Supabase Storage
2. Serverless Function processes: extract text → split into chunks (~500 tokens) → generate embeddings via OpenAI → save to `knowledge_chunks`
3. Visual status: "Processing..." → "Ready ✅" or "Error ❌"

**During the call:**
1. Vapi calls `knowledge_base` Tool with the user's question
2. Edge Function generates embedding for the question
3. Searches for the 3-5 most similar chunks in pgvector (filtered by `organization_id`)
4. Returns chunks as context for Vapi to read on the call

### Module 6: Outbound Campaigns
**Route:** `/dashboard/outbound`

Panel for active prospecting and follow-up:

1. **Create Campaign**: Name + select assistant (from mapped ones)
2. **Import Contacts**: Upload CSV (name, phone, extra data)
3. **Configure Cadence**: Start/end time, calls per minute
4. **Start/Pause/Stop**: Real-time control
5. **Monitor**: Status of each contact (pending, calling, completed, failed, no answer)

**Back-end:**
- Queues calls and dials via Vapi Outbound API
- Respects configured cadence
- Updates status in real-time via Vapi end-of-call webhook

### Module 7: Observability (Logs and Transcripts)
**Route:** `/dashboard/calls`

The feature with the highest perceived value. Proves the system is working.

**Call List:**
- Date/time, duration, type (inbound/outbound), number, status
- Filters: by date, assistant, status, type
- Search by number or name

**Call Detail (on click):**
```
┌───────────────────────────────────────────────────┐
│  📞 Call #abc123                                  │
│  03/15/2026 • 14:32 • 3min 45s • Inbound         │
│  +1 (508) 555-1234 • John Smith                   │
├───────────────────────────────────────────────────┤
│                                                   │
│  🤖 Sky: Hi! I'm Sky from [Company]. May I       │
│     have your name, please?                       │
│                                                   │
│  👤 John: Yeah, my name is John Smith             │
│                                                   │
│  🤖 Sky: Great to meet you, John! Could you      │
│     share your ZIP code?                          │
│                                                   │
│  👤 John: 02101                                   │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 🟢 add_to_crm — Contact created in GHL     │  │
│  │    128ms • Success                          │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  🤖 Sky: What service are you looking for today?  │
│                                                   │
│  👤 John: I need a quote for bathroom remodeling  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 🟢 knowledge_base — Queried pricing table  │  │
│  │    89ms • 3 chunks returned                │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  🤖 Sky: Based on our pricing, a standard         │
│     bathroom remodel starts at...                 │
│                                                   │
│  ...                                              │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 🔴 book_appt — Failed to schedule          │  │
│  │    2340ms • Error: Calendar unavailable     │  │
│  │    [View full payload]                      │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  🤖 Sky: I'm having a small issue with our        │
│     booking system. Our team will confirm...      │
│                                                   │
└───────────────────────────────────────────────────┘
```

---

## 6. API ROUTES (Next.js)

### Vapi Webhook Routes (Edge Functions — REQUIRED)

```
POST /api/vapi/tools          → Main Tool router
POST /api/vapi/end-of-call    → Receives data at call end (transcript, summary, etc.)
POST /api/vapi/status         → Receives call status updates
```

**Tool Router Flow (`/api/vapi/tools`):**

```typescript
// Main router pseudocode
export const runtime = 'edge'; // REQUIRED

async function POST(request: Request) {
  const body = await request.json();
  
  // 1. Extract data from Vapi payload
  const { message } = body;
  const toolName = message.toolCalls[0].function.name;
  const toolArgs = message.toolCalls[0].function.arguments;
  const assistantId = message.call.assistantId;
  
  // 2. Identify organization by assistant_id
  const mapping = await supabase
    .from('assistant_mappings')
    .select('organization_id')
    .eq('vapi_assistant_id', assistantId)
    .single();
  
  const orgId = mapping.organization_id;
  
  // 3. Fetch Tool configuration for that organization
  const toolConfig = await supabase
    .from('tools_config')
    .select('*, integrations(*)')
    .eq('organization_id', orgId)
    .eq('tool_name', toolName)
    .single();
  
  // 4. Execute action based on action_type
  let result;
  const startTime = Date.now();
  
  try {
    switch (toolConfig.action_type) {
      case 'create_contact':
        result = await executeCreateContact(toolConfig, toolArgs);
        break;
      case 'get_availability':
        result = await executeGetAvailability(toolConfig, toolArgs);
        break;
      case 'create_appointment':
        result = await executeCreateAppointment(toolConfig, toolArgs);
        break;
      case 'knowledge_base':
        result = await executeKnowledgeBase(orgId, toolArgs);
        break;
      case 'send_sms':
        result = await executeSendSMS(toolConfig, toolArgs);
        break;
      case 'custom_webhook':
        result = await executeCustomWebhook(toolConfig, toolArgs);
        break;
    }
    
    // 5. Log success
    await logAction(callId, orgId, toolName, 'success', toolArgs, result, Date.now() - startTime);
    
  } catch (error) {
    // 6. Log error and return fallback
    await logAction(callId, orgId, toolName, 'error', toolArgs, null, Date.now() - startTime, error.message);
    
    result = { 
      message: toolConfig.fallback_message || "Sorry, I had a technical issue. Our team will reach out." 
    };
  }
  
  // 7. Return result to Vapi in expected format
  return Response.json({
    results: [{
      toolCallId: message.toolCalls[0].id,
      result: JSON.stringify(result)
    }]
  });
}
```

### Internal API Routes (Serverless Functions)

```
# Authentication
POST /api/auth/signup
POST /api/auth/login

# Organizations (admin only)
GET    /api/organizations
POST   /api/organizations
PATCH  /api/organizations/:id

# Assistants (mapping)
GET    /api/assistants
POST   /api/assistants
DELETE /api/assistants/:id

# Integrations
GET    /api/integrations
POST   /api/integrations
PATCH  /api/integrations/:id
POST   /api/integrations/:id/test    → test connection

# Tools Config
GET    /api/tools
POST   /api/tools
PATCH  /api/tools/:id
DELETE /api/tools/:id

# Knowledge Base
GET    /api/knowledge
POST   /api/knowledge/upload         → document upload
DELETE /api/knowledge/:id
GET    /api/knowledge/:id/status     → processing status

# Outbound
GET    /api/outbound/campaigns
POST   /api/outbound/campaigns
PATCH  /api/outbound/campaigns/:id
POST   /api/outbound/campaigns/:id/start
POST   /api/outbound/campaigns/:id/pause
POST   /api/outbound/campaigns/:id/stop
POST   /api/outbound/contacts/import → CSV upload

# Logs
GET    /api/calls                    → call list
GET    /api/calls/:id                → detail + transcript
GET    /api/calls/:id/actions        → call Tool logs
GET    /api/analytics                → aggregated metrics
```

---

## 7. CI/CD — GITHUB ACTIONS

### File: `.github/workflows/deploy.yml`

```yaml
name: Deploy to Vercel (Production)

env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  lint-and-build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

  deploy:
    needs: lint-and-build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Vercel CLI
        run: npm install --global vercel@latest

      - name: Pull Vercel environment
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}

      - name: Build for Vercel
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}

      - name: Deploy to Vercel
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

### File: `.github/workflows/preview.yml`

```yaml
name: Deploy Preview (PR)

env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

on:
  pull_request:
    branches:
      - main

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint & Type check
        run: |
          npm run lint
          npx tsc --noEmit

      - name: Install Vercel CLI
        run: npm install --global vercel@latest

      - name: Pull Vercel environment
        run: vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}

      - name: Build
        run: vercel build --token=${{ secrets.VERCEL_TOKEN }}

      - name: Deploy Preview
        run: vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }}
```

### Required Secrets in GitHub (Settings > Secrets > Actions):
- `VERCEL_TOKEN` — Personal token generated at vercel.com/account/tokens
- `VERCEL_ORG_ID` — Found in `.vercel/project.json` after `vercel link`
- `VERCEL_PROJECT_ID` — Same location as above

---

## 8. ENVIRONMENT VARIABLES

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# OpenAI (for RAG embeddings)
OPENAI_API_KEY=sk-...

# Vapi (for outbound campaigns)
VAPI_API_KEY=...
VAPI_PHONE_NUMBER_ID=...

# Credential encryption
ENCRYPTION_KEY=...
```

---

## 9. PROJECT FOLDER STRUCTURE

```
voiceops/
├── .github/
│   └── workflows/
│       ├── deploy.yml
│       └── preview.yml
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── dashboard/
│   │   │   ├── page.tsx                    # Main dashboard
│   │   │   ├── assistants/page.tsx         # Assistant mapping
│   │   │   ├── integrations/page.tsx       # Credentials
│   │   │   ├── tools/page.tsx              # Action engine
│   │   │   ├── tools/[id]/page.tsx         # Tool configuration
│   │   │   ├── knowledge/page.tsx          # Knowledge base
│   │   │   ├── outbound/page.tsx           # Campaigns
│   │   │   ├── outbound/[id]/page.tsx      # Campaign detail
│   │   │   ├── calls/page.tsx              # Call list
│   │   │   └── calls/[id]/page.tsx         # Call detail + transcript
│   │   ├── api/
│   │   │   ├── vapi/
│   │   │   │   ├── tools/route.ts          # Edge Function — Tool router
│   │   │   │   ├── end-of-call/route.ts    # Edge Function — post-call data
│   │   │   │   └── status/route.ts         # Edge Function — status updates
│   │   │   ├── auth/
│   │   │   ├── organizations/
│   │   │   ├── assistants/
│   │   │   ├── integrations/
│   │   │   ├── tools/
│   │   │   ├── knowledge/
│   │   │   ├── outbound/
│   │   │   ├── calls/
│   │   │   └── analytics/
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                             # Base components (shadcn/ui)
│   │   ├── dashboard/                      # Dashboard components
│   │   ├── calls/                          # Transcript, timeline, action badges
│   │   └── tools/                          # Visual Tool builder
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts                   # Supabase browser client
│   │   │   ├── server.ts                   # Supabase server client
│   │   │   └── admin.ts                    # Supabase service role client
│   │   ├── vapi/
│   │   │   ├── types.ts                    # Vapi payload types
│   │   │   └── outbound.ts                 # Outbound API functions
│   │   ├── actions/
│   │   │   ├── ghl.ts                      # GoHighLevel executor
│   │   │   ├── twilio.ts                   # Twilio executor
│   │   │   ├── cal.ts                      # Cal.com executor
│   │   │   ├── webhook.ts                  # Generic webhook executor
│   │   │   └── knowledge.ts                # RAG executor
│   │   ├── embeddings.ts                   # OpenAI embedding generation
│   │   └── encryption.ts                   # Credential encryption
│   ├── hooks/                              # Custom React hooks
│   └── types/                              # Global TypeScript types
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql          # Complete table SQL
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── README.md
```

---

## 10. IMPLEMENTATION PHASES (MVP)

### Phase 1 — Foundation (Week 1-2)
- [ ] Setup Next.js + TypeScript + Tailwind + shadcn/ui project
- [ ] Configure Supabase: create tables, enable RLS, configure Auth
- [ ] Configure GitHub Actions (deploy.yml + preview.yml)
- [ ] Create base dashboard layout (sidebar, header, navigation)
- [ ] Implement authentication (login/signup) via Supabase Auth
- [ ] Create organizations CRUD (admin)

### Phase 2 — Router Core (Week 3-4)
- [ ] Implement Edge Function `/api/vapi/tools` (main router)
- [ ] CRUD for assistant_mappings (link Vapi assistant → organization)
- [ ] CRUD for integrations (credentials per provider)
- [ ] CRUD for tools_config (configure actions per Tool)
- [ ] Implement executors: GHL (create_contact, get_availability, create_appointment)
- [ ] Logging system (action_logs)

### Phase 3 — Observability (Week 5-6)
- [ ] Implement webhook `/api/vapi/end-of-call` (capture transcript and data)
- [ ] Create call_logs table and populate via webhook
- [ ] Call list screen with filters
- [ ] Detail screen: chat-format transcript + inline action badges (✅/❌)
- [ ] Main dashboard with metrics

### Phase 4 — RAG (Week 7-8)
- [ ] Document upload (PDF, URL, text)
- [ ] Processing pipeline: extraction → chunking → embedding → pgvector
- [ ] `knowledge_base` executor in Edge Function
- [ ] Document management interface

### Phase 5 — Outbound (Week 9-10)
- [ ] Campaign CRUD
- [ ] Contact import via CSV
- [ ] Call dialing engine (queuing + cadence)
- [ ] Real-time campaign monitoring dashboard

### Phase 6 — Polish (Week 11-12)
- [ ] custom_webhook executor (generic action)
- [ ] send_sms executor (Twilio)
- [ ] End-to-end tests
- [ ] Performance optimization
- [ ] Internal documentation

---

## 11. DEVELOPMENT RULES

1. **TypeScript strict mode** — no `any`, no `@ts-ignore`
2. **Edge Functions** for ALL `/api/vapi/*` routes — no exceptions
3. **Supabase RLS** enabled on ALL tables with `organization_id`
4. **Encrypted credentials** in the database — never plain text in production
5. **Error handling** on EVERY external call — always log, always have a fallback
6. **Latency** — the Vapi webhook must respond in < 500ms. If the action is slow, respond to Vapi immediately and process in the background
7. **No n8n dependency** — the platform completely replaces n8n for this use case
8. **Clean and simple UI** — the end client is a business owner, not a developer. No JSON, no code. Everything visual and intuitive
9. **Commits in English**, code in English, UI can be bilingual (PT/EN) in the future
