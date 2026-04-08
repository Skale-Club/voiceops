# Operator — Architecture & Structure

**Last updated:** 2026-04-03

## Directory Map

```
operator/
├── src/
│   ├── app/
│   │   ├── (auth)/login/          # Login page
│   │   ├── (dashboard)/           # Protected route group
│   │   │   ├── layout.tsx         # Dashboard shell (sidebar, auth check)
│   │   │   ├── calls/             # Call history + detail pages
│   │   │   ├── assistants/        # Vapi assistant mappings
│   │   │   ├── integrations/      # API credential management
│   │   │   ├── knowledge/         # Document upload & management
│   │   │   ├── outbound/          # Campaign CRUD & detail
│   │   │   ├── tools/             # Vapi tool configuration
│   │   │   └── organizations/     # Org settings
│   │   └── api/
│   │       ├── auth/callback/     # OAuth callback
│   │       ├── vapi/
│   │       │   ├── tools/         # Live tool-call webhook (Edge)
│   │       │   ├── calls/         # End-of-call webhook (Edge)
│   │       │   ├── campaigns/     # Campaign call webhook (Edge)
│   │       │   └── phone-numbers/ # Phone number webhook
│   │       ├── campaigns/[id]/
│   │       │   ├── start/         # Start campaign
│   │       │   ├── pause/         # Pause campaign
│   │       │   └── stop/          # Stop campaign
│   │       └── knowledge/upload/  # Document upload handler
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives
│   │   ├── layout/                # Sidebar, header
│   │   ├── assistants/            # AssistantMappingForm, list
│   │   ├── calls/                 # CallsTable, CallDetail, filters
│   │   ├── campaigns/             # CampaignForm, CampaignList, ContactsTable
│   │   ├── integrations/          # IntegrationForm, list
│   │   ├── knowledge/             # DocumentUpload, DocumentList
│   │   ├── tools/                 # ToolConfigForm, list
│   │   └── organizations/         # OrgSettingsForm
│   ├── lib/
│   │   ├── action-engine/         # Tool dispatch (execute-action, resolve-org, resolve-tool, log-action)
│   │   ├── campaigns/             # engine.ts, outbound.ts, csv-parser.ts
│   │   ├── calls/                 # Call timeline utilities
│   │   ├── ghl/                   # GoHighLevel API wrapper
│   │   ├── knowledge/             # embed, chunk-text, extract-text, query-knowledge
│   │   ├── integrations/          # get-provider-key.ts
│   │   ├── supabase/              # server.ts, admin.ts, client.ts
│   │   ├── crypto.ts              # AES-256-GCM encrypt/decrypt
│   │   └── utils.ts               # classname helpers
│   ├── actions/
│   │   └── knowledge.ts           # Server actions for knowledge base
│   ├── types/
│   │   ├── database.ts            # Generated Supabase types
│   │   └── vapi.ts                # Vapi payload schemas (Zod)
│   ├── hooks/
│   │   └── use-mobile.tsx         # Responsive breakpoint hook
│   └── middleware.ts              # Auth guard for all dashboard routes
├── supabase/
│   ├── migrations/                # 6 SQL migrations
│   ├── functions/process-embeddings/  # Deno edge function
│   └── seed.sql
└── tests/                         # 17 Vitest test files
```

---

## Key Flows

### 1. Vapi Tool Call (Hot Path — 500ms budget)

```
Vapi live call → POST /api/vapi/tools (Edge Runtime)
  1. Parse VapiToolCallMessageSchema (Zod)
  2. createAdminClient() → service-role Supabase (bypasses RLS)
  3. resolveOrg(assistantId) → organization_id via assistant_mappings
  4. resolveTool(orgId, toolName) → tool_config + integration JOIN
  5. decrypt(encryptedApiKey) → plaintext key
  6. executeAction(actionType, payload, config) →
     ├ 'create_contact'    → src/lib/ghl/create-contact.ts
     ├ 'get_availability'  → src/lib/ghl/get-availability.ts
     ├ 'create_appointment'→ src/lib/ghl/create-appointment.ts
     ├ 'knowledge_base'    → src/lib/knowledge/query-knowledge.ts
     ├ 'send_sms'          → ⚠️ STUB — throws error
     └ 'custom_webhook'    → ⚠️ STUB — throws error
  7. after() → log-action.ts (async, post-response)
  ← { results: [{ toolCallId, result }] }
```

**Key files**: `src/app/api/vapi/tools/route.ts`, `src/lib/action-engine/`

### 2. End-of-Call Webhook (Fire & Forget)

```
Vapi → POST /api/vapi/calls (Edge Runtime)
  1. Parse VapiEndOfCallMessageSchema
  2. Resolve org via assistant_mappings (service role)
  3. INSERT into calls (transcript, cost, summary, duration)
  4. Handle duplicate vapi_call_id gracefully (idempotent)
  ← 200 always (even on error)
```

**Key file**: `src/app/api/vapi/calls/route.ts`

### 3. Campaign Execution

```
Admin → POST /api/campaigns/[id]/start
  → startCampaignBatch(campaignId, supabase)
      ├ Fetch campaign + pending contacts (up to calls_per_minute, max 10)
      ├ FOR EACH contact: fireContactCall(vapi_assistant_id, phone, customData)
      │   → POST https://api.vapi.ai/call
      │   → UPDATE campaign_contact SET status='calling', vapi_call_id=...
      └ checkAndCompleteCampaign() if no pending left

Vapi → POST /api/vapi/campaigns (end-of-call for campaign calls)
  → UPDATE campaign_contact SET status=mapEndedReasonToStatus(reason)
  → checkAndCompleteCampaign() again
```

**Key files**: `src/lib/campaigns/engine.ts`, `src/lib/campaigns/outbound.ts`

### 4. Knowledge Base Query

```
Tool call with action_type='knowledge_base'
  → queryKnowledge(query, orgId, supabase)
      1. Fetch OpenAI key from integrations (decrypt)
      2. embed(query) → 1536D vector via OpenAI
      3. supabase.rpc('match_document_chunks', { orgId, embedding, matchCount:5 })
         → HNSW cosine similarity > 0.7
      4. Synthesize: OpenRouter first, Anthropic fallback
      ← 2–3 sentence answer string
```

**Key file**: `src/lib/knowledge/query-knowledge.ts`

### 5. Document Upload & Embedding

```
User uploads file → POST /api/knowledge/upload
  → Extract text (unpdf / cheerio)
  → chunk-text.ts → semantic chunks (gpt-tokenizer)
  → INSERT documents + document_chunks (no embeddings yet)
  → triggerEmbeddingJob() → POST to Supabase Edge Function URL
     [fire and forget — no retry]

supabase/functions/process-embeddings/ (Deno)
  → Fetch pending chunks
  → OpenAI embedding API
  → UPDATE document_chunks SET embedding = ...
```

**Key files**: `src/actions/knowledge.ts`, `supabase/functions/process-embeddings/`

---

## Authentication & Security Model

### Auth Flow
```
User → Supabase OAuth → cookies (JWT)
  → Next.js middleware (src/middleware.ts)
      - Validates JWT on every request
      - Redirects unauthenticated to /login
      - Bypasses: /api/vapi/*, /api/auth/*, static assets
  → Dashboard: supabase.auth.getUser() in server actions
```

### Organization Scoping
- **RLS on all tables**: `get_current_org_id()` STABLE SECURITY DEFINER function
- **Webhook routes**: Use service-role key + explicit `resolveOrg()` check
- **Server actions**: Derive org via `org_members` join on `user.id`

### Credential Security
- All API keys stored as `iv:ciphertext` (AES-256-GCM) in `integrations.encrypted_api_key`
- Decrypted on-demand using `ENCRYPTION_SECRET` env var
- Display: `maskApiKey()` shows only last 4 chars
- Implementation: `src/lib/crypto.ts`

---

## Supabase Client Usage

| Client | File | Used By | Bypasses RLS |
|--------|------|---------|--------------|
| `createServerClient()` | `src/lib/supabase/server.ts` | Dashboard server actions | No |
| `createAdminClient()` | `src/lib/supabase/admin.ts` | `/api/vapi/*` webhooks | Yes (service role) |
| Browser client | `src/lib/supabase/client.ts` | (minimal use) | No |

---

## State Management

- **Server state**: Supabase (fetched in server actions, passed to client components)
- **Form state**: `react-hook-form` with Zod validation
- **UI state**: Local `useState` in client components
- **No global client state**: No Redux, Zustand, or React Context for data
- **Cache invalidation**: `revalidatePath()` after mutations in server actions
