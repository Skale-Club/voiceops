# Architecture Research

**Domain:** Multi-tenant SaaS operations platform for Vapi.ai voice AI assistants
**Researched:** 2026-03-30
**Confidence:** HIGH

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL LAYER                               │
│  ┌─────────────┐   ┌─────────────┐   ┌────────────┐                │
│  │   Vapi.ai    │   │   Admin     │   │  Third-    │                │
│  │  (Voice AI)  │   │   Browser   │   │  Party     │                │
│  │  Webhooks    │   │  (Dashboard)│   │  APIs      │                │
│  └──────┬───────┘   └──────┬──────┘   │ (GHL, etc) │                │
│         │                  │          └─────┬──────┘                │
├─────────┴──────────────────┴────────────────┴───────────────────────┤
│                      EDGE FUNCTION LAYER                             │
│         (Next.js Route Handlers — runtime = 'edge')                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ /api/vapi/   │  │ /api/vapi/   │  │ /api/vapi/   │               │
│  │  tools       │  │ end-of-call  │  │  status      │               │
│  │ (Action Router│  │ (Call Logger)│  │ (Status Sync)│               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                  │                  │                       │
├─────────┴──────────────────┴──────────────────┴──────────────────────┤
│                    SERVERLESS FUNCTION LAYER                          │
│         (Next.js Route Handlers — runtime = 'nodejs')                │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │ Org CRUD   │ │ Tool Config│ │ Knowledge  │ │ Campaign   │        │
│  │ & Auth     │ │ & Integ.   │ │ Upload/    │ │ Management │        │
│  │            │ │ Mgmt       │ │ Processing │ │ & Dialing  │        │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘        │
│        │              │              │              │                 │
├────────┴──────────────┴──────────────┴──────────────┴────────────────┤
│                      SERVICE LAYER                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Action     │  │  Knowledge   │  │   Vapi API   │               │
│  │   Executors  │  │  Pipeline    │  │   Client     │               │
│  │ (GHL,Twilio, │  │ (Chunk,Embed │  │ (Outbound,   │               │
│  │  Cal,Webhook)│  │  Search)     │  │  Calls)      │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                  │                  │                       │
├─────────┴──────────────────┴──────────────────┴──────────────────────┤
│                       DATA LAYER (Supabase)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │PostgreSQL│  │   Auth   │  │ Storage  │  │ pgvector │             │
│  │ (RLS)    │  │          │  │          │  │          │             │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Edge: Tool Router** (`/api/vapi/tools`) | Receives Vapi `tool-calls` webhooks, resolves org by `assistantId`, fetches tool config, dispatches to correct executor, returns result to Vapi within 500ms | Next.js Route Handler with `export const runtime = 'edge'` |
| **Edge: End-of-Call** (`/api/vapi/end-of-call`) | Receives `end-of-call-report`, stores transcript + summary + metadata in `call_logs`, links to org via assistant mapping | Next.js Route Handler with `export const runtime = 'edge'` |
| **Edge: Status Update** (`/api/vapi/status`) | Receives `status-update` events, updates call status, triggers campaign contact status updates | Next.js Route Handler with `export const runtime = 'edge'` |
| **Serverless: Org CRUD** | Organization CRUD, user management, assistant mapping CRUD, integration credential CRUD | Next.js Route Handler (Node.js runtime) |
| **Serverless: Tool Config** | Admin UI for configuring trigger → action rules per tool per org | Next.js Route Handler (Node.js runtime) |
| **Serverless: Knowledge Upload** | Document upload → text extraction → chunking → embedding generation → pgvector storage | Next.js Route Handler (Node.js runtime) |
| **Serverless: Campaign Mgmt** | Campaign CRUD, contact import, cadence engine, Vapi outbound API calls | Next.js Route Handler (Node.js runtime) |
| **Action Executors** | Pluggable action handlers: GHL (create contact, check availability, book appointment), Twilio (SMS), Cal.com, custom webhook, knowledge base query | Shared service modules imported by Edge and Serverless routes |
| **Knowledge Pipeline** | Document processing: PDF/URL/text/CSV → extract text → chunk (~500 tokens) → OpenAI embeddings → pgvector with `organization_id` | Serverless function + background processing |
| **Vapi API Client** | Wraps Vapi REST API for outbound calls, campaign management, assistant lookups | Server-side module using `fetch` |
| **Supabase PostgreSQL + RLS** | All persistent storage with `organization_id` on every table enforcing tenant isolation at the database level | Supabase hosted PostgreSQL |
| **Supabase Auth** | User authentication (email/password), session management, JWT issuance | Supabase Auth service |
| **Supabase Storage** | File storage for uploaded knowledge base documents (PDFs, CSVs) before processing | Supabase Storage buckets |
| **pgvector** | Vector similarity search scoped per organization for RAG knowledge base queries | Supabase PostgreSQL extension |

---

## Recommended Project Structure

```
src/
├── app/
│   ├── (auth)/                        # Auth pages (no dashboard layout)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── callback/route.ts          # Supabase auth callback
│   ├── (dashboard)/                   # Dashboard layout group
│   │   ├── layout.tsx                 # Sidebar + header + org context
│   │   ├── page.tsx                   # Main dashboard (metrics)
│   │   ├── assistants/
│   │   │   └── page.tsx               # Assistant → org mapping
│   │   ├── integrations/
│   │   │   └── page.tsx               # Credential management
│   │   ├── tools/
│   │   │   ├── page.tsx               # Tool config list
│   │   │   └── [id]/page.tsx          # Tool detail / action builder
│   │   ├── knowledge/
│   │   │   ├── page.tsx               # Document list + upload
│   │   │   └── [id]/page.tsx          # Document detail + chunks
│   │   ├── outbound/
│   │   │   ├── page.tsx               # Campaign list
│   │   │   └── [id]/page.tsx          # Campaign detail + contacts
│   │   └── calls/
│   │       ├── page.tsx               # Call list with filters
│   │       └── [id]/page.tsx          # Call detail + transcript
│   ├── api/
│   │   ├── vapi/                      # ⚡ Edge Functions (Vapi webhooks)
│   │   │   ├── tools/route.ts         # Action Router
│   │   │   ├── end-of-call/route.ts   # Call Logger
│   │   │   └── status/route.ts        # Status Sync
│   │   ├── organizations/             # Org CRUD (serverless)
│   │   ├── assistants/                # Assistant mapping CRUD
│   │   ├── integrations/              # Integration credential CRUD
│   │   ├── tools/                     # Tool config CRUD
│   │   ├── knowledge/                 # Document upload + status
│   │   ├── outbound/                  # Campaign + contacts CRUD
│   │   ├── calls/                     # Call log queries
│   │   └── analytics/                 # Aggregated metrics
│   ├── layout.tsx                     # Root layout
│   └── middleware.ts                  # Auth middleware (refresh tokens)
├── components/
│   ├── ui/                            # shadcn/ui base components
│   ├── layout/                        # Sidebar, header, org switcher
│   ├── dashboard/                     # Metric cards, charts
│   ├── calls/                         # Transcript viewer, action badges
│   ├── tools/                         # Action builder, action cards
│   ├── knowledge/                     # Document upload, chunk viewer
│   ├── campaigns/                     # Campaign status, contact table
│   └── integrations/                  # Credential forms, test buttons
├── lib/
│   ├── supabase/
│   │   ├── client.ts                  # Browser client (createBrowserClient)
│   │   ├── server.ts                  # Server client (createServerClient)
│   │   └── admin.ts                   # Service role client (webhooks only)
│   ├── vapi/
│   │   ├── types.ts                   # Vapi webhook payload types
│   │   ├── outbound.ts               # Vapi outbound API wrapper
│   │   └── verify.ts                  # Webhook signature validation
│   ├── actions/                       # Action Executors (the "n8n Lite")
│   │   ├── registry.ts                # Action type → executor mapping
│   │   ├── executor.ts                # Base executor interface
│   │   ├── ghl.ts                     # GoHighLevel executor
│   │   ├── twilio.ts                  # Twilio SMS executor
│   │   ├── cal.ts                     # Cal.com executor
│   │   ├── webhook.ts                 # Generic webhook executor
│   │   └── knowledge.ts              # RAG query executor
│   ├── knowledge/
│   │   ├── extract.ts                 # Text extraction (PDF, URL, CSV)
│   │   ├── chunk.ts                   # Text chunking (~500 tokens)
│   │   ├── embed.ts                   # OpenAI embedding generation
│   │   └── search.ts                  # pgvector similarity search
│   ├── encryption.ts                  # AES-256-GCM credential encryption
│   └── utils.ts                       # Shared utilities
├── hooks/                             # Custom React hooks
├── types/                             # Global TypeScript types
│   ├── database.ts                    # Supabase generated types
│   ├── vapi.ts                        # Vapi webhook/event types
│   └── actions.ts                     # Action config types
└── middleware.ts                      # Next.js middleware (auth refresh)
```

### Structure Rationale

- **`app/(auth)/` vs `app/(dashboard)/`**: Auth pages have no sidebar or org context. Dashboard pages share a common layout with sidebar navigation. Next.js route groups (`()`) enable different layouts without affecting URL structure.
- **`app/api/vapi/`**: All Vapi webhook routes isolated in one folder. Every route.ts in here MUST have `export const runtime = 'edge'`. This makes the boundary explicit — if it's in this folder, it's an Edge Function.
- **`lib/actions/`**: The Action Engine is a self-contained module with a registry pattern. Adding a new integration means adding one file and registering it. The Edge Function tool router imports from here.
- **`lib/vapi/types.ts`**: Vapi webhook payloads have a specific shape (verified from docs). Strong typing prevents runtime parsing errors during live calls.
- **`lib/supabase/admin.ts`**: Service role client used ONLY in Edge Functions receiving Vapi webhooks (no user JWT context). Never imported in browser code.

---

## Architectural Patterns

### Pattern 1: Edge/Serverless Split for Latency-Critical Paths

**What:** Vapi webhook routes use Edge Runtime (`runtime = 'edge'`); all other routes use default Node.js runtime. Edge Functions handle the latency-critical path (Vapi expects < 500ms response); Serverless Functions handle everything else.

**When to use:** Any route that Vapi calls during a live call (`tool-calls`, `knowledge-base-request`, `assistant-request`) MUST be Edge. Internal admin routes (CRUD, uploads, analytics) use Node.js runtime for full npm ecosystem access.

**Trade-offs:**
- Edge: Fast cold starts (~5ms), globally distributed, limited API surface (no Node.js built-ins like `fs`, limited `crypto` to Web Crypto only), 2MB bundle limit
- Serverless: Full Node.js access, larger bundles OK, but slower cold starts (~250ms) and not globally distributed

**Example:**
```typescript
// app/api/vapi/tools/route.ts — MUST be Edge
export const runtime = 'edge';

export async function POST(request: Request) {
  const body = await request.json();
  const startTime = Date.now();

  // 1. Validate Vapi webhook (HMAC or secret header)
  const secret = request.headers.get('x-vapi-secret');
  if (secret !== process.env.VAPI_WEBHOOK_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Extract tool call data from Vapi payload
  const { message } = body;
  const toolCall = message.toolCallList[0];
  const assistantId = message.call.assistant.id || message.call.assistantId;

  // 3. Resolve organization (service_role — no user JWT in Vapi webhooks)
  const supabase = createServiceRoleClient();
  const { data: mapping } = await supabase
    .from('assistant_mappings')
    .select('organization_id')
    .eq('vapi_assistant_id', assistantId)
    .single();

  const orgId = mapping.organization_id;

  // 4. Fetch tool config for this org
  const { data: toolConfig } = await supabase
    .from('tools_config')
    .select('*, integrations(*)')
    .eq('organization_id', orgId)
    .eq('tool_name', toolCall.name)
    .eq('is_active', true)
    .single();

  // 5. Execute action via registry
  const executor = getExecutor(toolConfig.action_type);
  const result = await executor.execute(toolConfig, toolCall.arguments);

  // 6. Log action (fire-and-forget via waitUntil if available)
  const executionTime = Date.now() - startTime;
  logAction(orgId, toolCall.name, result, executionTime);

  // 7. Return to Vapi in required format
  return Response.json({
    results: [{
      toolCallId: toolCall.id,
      result: JSON.stringify(result),
    }],
  });
}
```

### Pattern 2: Service Role + Manual Tenant Filtering for Webhooks

**What:** Vapi webhooks arrive without user JWTs. Edge Functions must use the Supabase `service_role` key (bypasses RLS) and manually filter every query by `organization_id` resolved from the assistant mapping.

**When to use:** Every Edge Function that receives Vapi webhooks. This is the ONLY place service_role should be used.

**Trade-offs:**
- Pro: Necessary — no user context in Vapi webhooks, RLS would return empty results
- Con: No database-level safety net — bugs in manual filtering could leak cross-tenant data
- Mitigation: Centralize the org resolution in a shared function; always derive `orgId` from the authenticated assistant mapping, never from the request body

**Example:**
```typescript
// lib/vapi/resolve-org.ts — shared org resolver for all Vapi webhooks
import { createServiceRoleClient } from '@/lib/supabase/admin';

export async function resolveOrganization(assistantId: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('assistant_mappings')
    .select('organization_id')
    .eq('vapi_assistant_id', assistantId)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error(`No organization found for assistant ${assistantId}`);
  }

  return data.organization_id; // Always derived server-side, never from client
}
```

### Pattern 3: Action Registry (Pluggable Executor Pattern)

**What:** A registry maps `action_type` strings to executor classes. Adding a new integration means creating one file and registering it — no changes to the Edge Function tool router.

**When to use:** The Action Engine core. Each integration (GHL, Twilio, Cal.com, custom webhook, knowledge base) is an executor implementing a common interface.

**Trade-offs:**
- Pro: Open/Closed Principle — add integrations without modifying existing code
- Pro: Each executor is independently testable
- Con: Slight indirection — need to look at registry to find which executor handles which action

**Example:**
```typescript
// lib/actions/executor.ts
export interface ActionResult {
  success: boolean;
  data: Record<string, unknown>;
  message?: string;
}

export interface ActionExecutor {
  execute(config: ToolConfig, args: Record<string, unknown>): Promise<ActionResult>;
}

// lib/actions/registry.ts
import { createContact } from './ghl';
import { getAvailability } from './ghl';
import { bookAppointment } from './ghl';
import { sendSMS } from './twilio';
import { queryKnowledge } from './knowledge';
import { callWebhook } from './webhook';

const registry: Record<string, ActionExecutor> = {
  create_contact: createContact,
  get_availability: getAvailability,
  create_appointment: bookAppointment,
  send_sms: sendSMS,
  knowledge_base: queryKnowledge,
  custom_webhook: callWebhook,
};

export function getExecutor(actionType: string): ActionExecutor {
  const executor = registry[actionType];
  if (!executor) throw new Error(`Unknown action type: ${actionType}`);
  return executor;
}
```

### Pattern 4: Multi-Tenant RLS with Helper Function

**What:** Every table has `organization_id`. A single `security definer` helper function resolves the current user's organization, and all RLS policies reference it. This prevents circular policy evaluation and ensures consistent isolation.

**When to use:** Every table in the `public` schema. Non-negotiable for this project.

**Trade-offs:**
- Pro: Database-level isolation — code bugs can't leak data
- Pro: Single point of change for org resolution logic
- Con: Every query has implicit WHERE clause (must index `organization_id`)
- Con: Webhook routes must use service_role (no user JWT), requiring manual filtering

**Example:**
```sql
-- migrations/001_rls_helpers.sql
-- Helper function in private schema (bypasses RLS on lookup)
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.get_current_org_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id FROM users
  WHERE id = (select auth.uid())
  LIMIT 1;
$$;

-- Apply to every multi-tenant table
CREATE POLICY "org_isolation_select" ON call_logs
  FOR SELECT TO authenticated
  USING (organization_id = (select private.get_current_org_id()));

CREATE POLICY "org_isolation_insert" ON call_logs
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (select private.get_current_org_id()));

CREATE POLICY "org_isolation_update" ON call_logs
  FOR UPDATE TO authenticated
  USING (organization_id = (select private.get_current_org_id()))
  WITH CHECK (organization_id = (select private.get_current_org_id()));

CREATE POLICY "org_isolation_delete" ON call_logs
  FOR DELETE TO authenticated
  USING (organization_id = (select private.get_current_org_id()));

-- Index for RLS performance
CREATE INDEX idx_call_logs_org_id ON call_logs (organization_id);
```

### Pattern 5: pgvector Match Function with Tenant Scoping

**What:** PostgREST doesn't support pgvector operators directly. A SQL function wraps the similarity search and filters by `organization_id` before computing distances, ensuring tenant isolation and index usage.

**When to use:** Knowledge base semantic search during calls and in the admin UI.

**Trade-offs:**
- Pro: PostgREST can call via `supabase.rpc()`
- Pro: `organization_id` filter ensures no cross-tenant results and uses index
- Con: Function-based queries are less composable than direct SQL

**Example:**
```sql
-- migrations/002_knowledge_search.sql
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  p_organization_id UUID,
  p_query_embedding VECTOR(1536),
  p_match_threshold FLOAT DEFAULT 0.7,
  p_match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kc.content,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.organization_id = p_organization_id
    AND 1 - (kc.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY kc.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;

-- HNSW index for performance (handles inserts/updates well)
CREATE INDEX idx_knowledge_chunks_embedding
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);
```

### Pattern 6: Fire-and-Forget Logging for Edge Functions

**What:** The Edge Function's primary job is to respond to Vapi within 500ms. Action logging (writing to `action_logs`) happens after the response is sent, using `waitUntil` or fire-and-forget promises.

**When to use:** Every Edge Function that needs to log actions or store data that isn't required in the response.

**Trade-offs:**
- Pro: Keeps response latency minimal
- Con: Logs may be lost if the Edge Function terminates before the write completes (rare but possible)
- Mitigation: Critical actions (like credential creation) log synchronously; observability logs are fire-and-forget

---

## Data Flow

### Flow 1: Tool Call (Live Call) — THE Critical Path

```
Caller speaks → Vapi (STT → LLM decides tool needed)
    │
    ▼ POST /api/vapi/tools
┌──────────────────────────────────────────────────────────────┐
│ Edge Function (Tool Router)                                  │
│                                                              │
│  1. Validate x-vapi-secret header                           │
│  2. Parse message.toolCallList[0] → { id, name, arguments } │
│  3. Extract message.call.assistantId                        │
│  4. service_role: lookup assistant_mappings → org_id        │
│  5. service_role: lookup tools_config → action + integration│
│  6. Decrypt integration credentials (Web Crypto AES-GCM)    │
│  7. Execute action via registry (e.g., GHL create_contact)  │
│  8. Log to action_logs (fire-and-forget)                    │
│  9. Return { results: [{ toolCallId, result }] }            │
│                                                              │
│  ──── MUST complete in < 500ms ────                          │
└──────────────────────────────────────────────────────────────┘
    │
    ▼ JSON response
Vapi receives result → LLM incorporates → TTS speaks to caller
```

**Timing budget (500ms total):**
| Step | Target |
|------|--------|
| Webhook validation + payload parsing | 5ms |
| Supabase: assistant → org lookup | 30-50ms |
| Supabase: tool config + integration fetch | 30-50ms |
| Credential decryption (Web Crypto) | 5ms |
| External API call (e.g., GHL create contact) | 150-300ms |
| Response formatting | 2ms |
| **Buffer for network jitter** | 50-100ms |

### Flow 2: End-of-Call Report (Observability)

```
Call ends → Vapi generates end-of-call-report
    │
    ▼ POST /api/vapi/end-of-call
┌──────────────────────────────────────────────────────────┐
│ Edge Function (Call Logger)                              │
│                                                          │
│  1. Validate x-vapi-secret                              │
│  2. Parse: call.id, artifact.transcript, artifact.messages, │
│     call.type, call.startedAt, call.endedAt, endedReason │
│  3. Resolve org_id from call.assistantId                │
│  4. Upsert into call_logs (by vapi_call_id)             │
│     - transcript (JSONB: messages array)                │
│     - summary, duration, status, phone_number           │
│  5. Return 200 OK                                       │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Dashboard displays: call list → click → transcript with tool badges
```

### Flow 3: Knowledge Base Query (RAG During Call)

```
User asks question → Vapi triggers knowledge_base tool
    │
    ▼ POST /api/vapi/tools (tool_name = "knowledge_base")
┌──────────────────────────────────────────────────────────┐
│ Edge Function (Knowledge Executor)                       │
│                                                          │
│  1. Resolve org_id from assistant mapping               │
│  2. Extract user's question from tool arguments          │
│  3. Call OpenAI API: text-embedding-3-small             │
│     → 1536-dim vector (question embedding)              │
│  4. Supabase RPC: match_knowledge_chunks(org_id, vector)│
│     → pgvector cosine similarity search                 │
│     → top 3-5 chunks, scoped to org                    │
│  5. Return chunks as result text                        │
│  6. Log query to action_logs                            │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Vapi receives chunks → LLM uses as context → speaks answer
```

### Flow 4: Outbound Campaign Execution

```
Admin creates campaign + imports contacts
    │
    ▼ POST /api/outbound/campaigns/:id/start
┌──────────────────────────────────────────────────────────┐
│ Serverless Function (Campaign Engine)                     │
│                                                          │
│  1. Load campaign config (assistant_id, cadence, times)  │
│  2. SELECT contacts WHERE status = 'pending'             │
│     ORDER BY created_at LIMIT batch_size                 │
│     FOR UPDATE SKIP LOCKED                               │
│  3. UPDATE contacts SET status = 'calling'               │
│  4. For each contact: POST api.vapi.ai/call              │
│     { assistantId, phoneNumberId, customer: { number } } │
│  5. Store vapi_call_id on contact                        │
│  6. Wait for cadence interval (calls_per_minute)         │
│  7. Repeat from step 2 until all contacts processed      │
│                                                          │
│  Status updates arrive via /api/vapi/status webhook      │
│  → UPDATE contacts SET status = 'completed'|'failed'     │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Dashboard shows: campaign progress, per-contact status
```

### Flow 5: Knowledge Base Document Processing

```
Admin uploads PDF/URL/text → POST /api/knowledge/upload
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Serverless Function (Document Processor)                  │
│                                                          │
│  1. Store file in Supabase Storage                       │
│  2. Create knowledge_documents row (status: 'processing')│
│  3. Extract text (PDF → parse, URL → scrape, CSV → parse)│
│  4. Chunk text (~500 tokens per chunk, with overlap)     │
│  5. Generate embeddings via OpenAI text-embedding-3-small│
│  6. Insert chunks into knowledge_chunks                  │
│     (organization_id, document_id, content, embedding)   │
│  7. Update document status → 'ready'                     │
│  8. Update document chunk_count                          │
│                                                          │
│  If error at any step → status = 'error', store message  │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Admin UI polls status → shows "Processing..." → "Ready ✅"
```

### State Management

```
Server State (Supabase queries)
    ↓ (React Query pattern — fetch on mount, refetch on mutation)
Server Components (direct Supabase queries in RSC)
    ↓ (streamed to client)
Client Components (interactive parts: forms, filters, tables)
    ↓ (nuqs for URL state — filters, pagination)
URL Search Params (persisted in browser history)
```

No global client state store needed. This is a server-rendered admin panel:
- **Server state**: Direct Supabase queries in Server Components (no React Query needed for initial render)
- **Client state**: `nuqs` for table filters, pagination, date ranges persisted in URL
- **Form state**: React Hook Form for all form inputs
- **UI state**: React `useState` for modals, dropdowns, tabs

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **1-20 orgs, <500 calls/day** | Monolith is perfect. Single Vercel deployment. Supabase free/pro tier. No optimization needed. |
| **20-100 orgs, 500-5K calls/day** | Add HNSW index on pgvector. Pre-aggregate dashboard metrics (daily summary table). Cursor-based pagination on call logs. Consider Supabase Pro for connection pooling. |
| **100-500 orgs, 5K-50K calls/day** | Add time-based partitioning on `action_logs` and `call_logs`. Background worker for log archival. Consider read replica for dashboard queries. Rate limiting per org. |
| **500+ orgs, 50K+ calls/day** | Separate webhook processing from dashboard (different deployments). Dedicated Supabase instance with compute add-on. Consider queue system (Ingestor → Worker) for campaign dialing. |

### Scaling Priorities

1. **First bottleneck: pgvector queries** — Even at small scale, embedding search without HNSW index is slow. Create HNSW from day one. ~1K vectors.
2. **Second bottleneck: Call log table size** — `call_logs` and `action_logs` grow fast. Add `created_at` indexes and cursor pagination from day one. Pre-aggregation needed at ~10K rows.
3. **Third bottleneck: Edge Function → Supabase latency** — Pin Vercel Edge Functions to the same region as Supabase. This saves 50-100ms per webhook call. Do this from day one.
4. **Fourth bottleneck: Concurrent campaign dialing** — Sequential batch approach works for MVP. At scale, need a queue system with `SELECT FOR UPDATE SKIP LOCKED`. ~100 concurrent campaigns.

---

## Anti-Patterns

### Anti-Pattern 1: Using Vapi's Native GHL Tools Instead of Custom Action Engine

**What people do:** Configure Vapi's built-in GoHighLevel integration (Get Contact, Create Contact, Check Availability, Create Event) per assistant.
**Why it's wrong:** These tools are single-action, single-tenant, single-credential. They can't chain actions (create contact → check availability → book in one tool call), can't use different GHL credentials per client, and don't log to your observability layer.
**Do this instead:** Use Vapi Custom Tools with `server.url` pointing to your Edge Function. Your Action Engine handles multi-tenant credential lookup, action sequencing, logging, and fallbacks.

### Anti-Pattern 2: Doing Everything Synchronously in the Tool Webhook

**What people do:** In the tool-call Edge Function, run all actions (create contact, check calendar, send SMS, log result) before returning the response to Vapi.
**Why it's wrong:** Latency compounds. 3 API calls × 200ms each = 600ms. Add DB queries and you're past the 500ms budget. The caller hears dead air.
**Do this instead:** Respond to Vapi with the primary data result. Use `waitUntil()` or fire-and-forget for side effects (logging, SMS, background tasks). Only the action that produces data the LLM needs should be synchronous.

### Anti-Pattern 3: Relying on Application-Level Tenant Filtering Without RLS

**What people do:** Add `organization_id` to tables but only filter in application code (`WHERE organization_id = ?`), without enabling RLS.
**Why it's wrong:** One code path that forgets the filter exposes all data. API route, Server Component, or debug console — any unfiltered query returns everything.
**Do this instead:** RLS on every table. Application-level filtering is a performance optimization (helps Postgres query planner), not a security boundary. RLS is the security boundary.

### Anti-Pattern 4: Using Node.js Runtime for Vapi Webhook Routes

**What people do:** Create `/api/vapi/tools/route.ts` without `export const runtime = 'edge'`, letting it default to Node.js runtime.
**Why it's wrong:** Node.js serverless functions on Vercel have ~250ms cold starts. Vapi expects < 500ms total response time. A cold start alone consumes half the budget. The first call after deployment or scale-to-zero always times out.
**Do this instead:** Every file in `app/api/vapi/` MUST have `export const runtime = 'edge'`. Edge Functions have ~5ms cold starts.

### Anti-Pattern 5: Storing Integration Credentials in Plain Text

**What people do:** Store GoHighLevel API keys, Twilio tokens, etc. as plain text in the `integrations.credentials` JSONB column.
**Why it's wrong:** Database compromise exposes every client's third-party credentials. These grant access to CRMs, phone systems, and calendars — far beyond your platform.
**Do this instead:** Encrypt with AES-256-GCM using Web Crypto API before storage. Decrypt only in Edge Functions (server-side). UI shows masked values only.

### Anti-Pattern 6: Single Shared Vapi Assistant for All Tenants

**What people do:** Use one Vapi assistant with conditional logic based on caller phone number to determine which client's data to use.
**Why it's wrong:** No credential isolation, no true multi-tenancy, brittle routing logic, and Vapi's native tools can't be scoped per caller. Plus the system prompt becomes a mess of conditionals.
**Do this instead:** Each client has their own Vapi assistant(s). `assistant_mappings` table links each `vapi_assistant_id` to an `organization_id`. The Edge Function resolves org from the assistant ID in the webhook payload.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Vapi.ai (Webhooks)** | Vapi POSTs to your Edge Functions | Validate `x-vapi-secret` header on every request. Response format: `{ results: [{ toolCallId, result }] }`. Webhook types: `tool-calls`, `end-of-call-report`, `status-update`. |
| **Vapi.ai (API)** | Your server calls `api.vapi.ai` REST | For outbound calls (`POST /call`), campaign management, assistant lookups. Auth via `Authorization: Bearer <VAPI_API_KEY>`. |
| **GoHighLevel** | REST API from Edge Functions | `POST /contacts/`, `GET /calendars/{id}/slots`, `POST /appointments/`. Auth via API key in `Authorization: Bearer`. Per-org credentials. Rate-limited — implement backoff. |
| **Twilio** | REST API from Edge Functions | `POST /Messages.json` for SMS. Auth via Account SID + Auth Token. Per-org credentials. |
| **Cal.com** | REST API from Edge Functions | Availability checking, booking. Auth via API key. Per-org credentials. |
| **OpenAI** | API from Edge + Serverless Functions | `text-embedding-3-small` for RAG embeddings. Called during document processing (serverless) and during knowledge_base tool execution (edge). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Edge Functions ↔ Supabase | `supabase-js` (service_role) | No user JWT in Vapi webhooks → use service_role + manual org filtering |
| Serverless Routes ↔ Supabase | `supabase-js` (user JWT via cookies) | RLS enforced. `createServerClient` from `@supabase/ssr` |
| Server Components ↔ Supabase | `supabase-js` (user JWT) | Direct queries in RSC for dashboard data. RLS enforced. |
| Edge Functions ↔ External APIs | `fetch()` | Raw REST calls. No SDK — keeps Edge bundle small. |
| Campaign Engine ↔ Vapi API | `fetch()` to `api.vapi.ai` | Sequential batch dialing. Respect cadence limits. |
| Knowledge Pipeline ↔ OpenAI | `openai` npm package | Document processing runs in Node.js runtime (not edge). |

---

## Build Order (Dependency-Based)

Based on component dependencies and the critical path (Action Engine must work first):

```
Phase 1: FOUNDATION (everything depends on this)
├── 1a. Next.js project setup + Supabase connection
├── 1b. Database schema (all tables + RLS policies + indexes)
├── 1c. Auth (Supabase Auth + middleware + login/signup pages)
├── 1d. Dashboard layout (sidebar, header, navigation)
└── 1e. Organization CRUD (admin creates/manages tenants)

Phase 2: ACTION ENGINE (core value proposition)
├── 2a. Assistant mapping CRUD (link Vapi assistant → org)
├── 2b. Integration credential CRUD (encrypted per-org creds)
├── 2c. Tool config CRUD (trigger → action mapping UI)
├── 2d. Edge Function: /api/vapi/tools (action router)
├── 2e. GHL executor (create_contact, get_availability, book)
├── 2f. Action logging (action_logs table writes)
└── 2g. End-to-end test: Vapi → Edge Function → GHL → response

Phase 3: OBSERVABILITY (proves the system works)
├── 3a. Edge Function: /api/vapi/end-of-call (call logger)
├── 3b. Call list page (filterable, paginated)
├── 3c. Call detail page (chat transcript)
├── 3d. Inline tool badges (merge call_logs + action_logs by call_id)
├── 3e. Dashboard metrics (total calls, tool success rate, recent calls)
└── 3f. Edge Function: /api/vapi/status (status sync)

Phase 4: KNOWLEDGE BASE (RAG)
├── 4a. Document upload (Supabase Storage + knowledge_documents)
├── 4b. Processing pipeline (extract → chunk → embed → pgvector)
├── 4c. pgvector match function + HNSW index
├── 4d. Knowledge executor in Action Engine
├── 4e. Document management UI (upload, status, delete)
└── 4f. Admin can test queries against org's knowledge base

Phase 5: OUTBOUND CAMPAIGNS
├── 5a. Campaign CRUD + contact import (CSV)
├── 5b. Vapi outbound API integration (dial contacts)
├── 5c. Campaign engine (batch dialing + cadence)
├── 5d. Real-time status tracking (via status webhook)
└── 5e. Campaign monitoring dashboard

Phase 6: POLISH + EXTENSIONS
├── 6a. Additional executors (Twilio SMS, custom webhook)
├── 6b. Failure alerting (email/webhook on tool failures)
├── 6c. Performance optimization (pre-aggregation, caching)
└── 6d. End-to-end testing + documentation
```

**Build order rationale:**
1. **Foundation first** — RLS, auth, and org CRUD are prerequisites for everything. Without org isolation, no other feature is safe to build.
2. **Action Engine before Observability** — Observability shows the results of tool executions. You need tool executions first. And the Action Engine is the core value proposition per PROJECT.md.
3. **Observability before Knowledge Base** — The call list and transcript UI are the highest perceived value features for proving the system works to clients. Knowledge base adds capability but doesn't prove anything.
4. **Campaigns last** — Campaigns are the most self-contained feature. They don't depend on knowledge base or advanced observability. They can be deferred without affecting the core loop.

---

## Sources

- **Vapi Server Events** (docs.vapi.ai/server-url/events) — Webhook payload formats for `tool-calls`, `end-of-call-report`, `status-update`, `knowledge-base-request`. Tool response format `{ results: [{ toolCallId, result }] }`. Confidence: HIGH
- **Vapi Custom Tools** (docs.vapi.ai/tools/custom-tools) — How to configure custom tools with `server.url`. Confirmed webhook shape and response format. Confidence: HIGH
- **Vapi Outbound Calling** (docs.vapi.ai/calls/outbound-calling) — API for creating outbound calls: `POST /call` with `assistantId`, `phoneNumberId`, `customer`. Batch calling via `customers` array. Scheduling via `schedulePlan`. Confidence: HIGH
- **Vapi Outbound Campaigns** (docs.vapi.ai/outbound-campaigns/overview) — Campaign setup, dynamic variables, concurrency limits. Confidence: HIGH
- **Vapi GoHighLevel Integration** (docs.vapi.ai/tools/go-high-level) — Native GHL tools (Get/Create Contact, Check Availability, Create Event). Confirmed they're single-action and can't replace VoiceOps Action Engine. Confidence: HIGH
- **Supabase RLS** (supabase.com/docs/guides/auth/row-level-security) — Policy patterns, `auth.uid()` wrapping for performance, `security definer` helper functions, index requirements. Confidence: HIGH
- **Supabase pgvector** (supabase.com/docs/guides/ai/vector-columns) — Vector column creation, match function pattern, similarity operators (`<=>` for cosine), RPC usage via `supabase.rpc()`. Confidence: HIGH
- **Supabase Edge Functions** (supabase.com/docs/guides/functions) — Deno runtime, `npm:` imports, `EdgeRuntime.waitUntil()`, connection pooling. Confidence: HIGH
- **Next.js Route Handlers** (nextjs.org/docs/app/building-your-application/routing/route-handlers) — `export const runtime = 'edge'` for Edge Functions, segment config options, Web API Request/Response. Confidence: HIGH
- **Vercel Edge Runtime** (vercel.com/docs/functions/runtimes/edge) — V8-based, ~5ms cold start, 2MB bundle limit, Web Crypto support. Confidence: HIGH
- **PROJECT.md** — Project context, requirements, constraints. Source of truth for tech stack decisions. Confidence: HIGH

---
*Architecture research for: VoiceOps multi-tenant Vapi.ai operations platform*
*Researched: 2026-03-30*
