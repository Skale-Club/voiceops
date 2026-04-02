# Phase 2: Action Engine — Research

**Researched:** 2026-04-02
**Domain:** Vapi tool-call webhooks, GoHighLevel API v2, credential encryption (Edge Runtime), Next.js Edge Route Handlers, action logging
**Confidence:** HIGH (architecture + patterns) / MEDIUM (GHL exact endpoint schemas)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACTN-01 | Platform receives Vapi tool-call webhooks via Edge Function and identifies the org by assistant ID | Vapi webhook payload structure + `assistant_mappings` table lookup by `vapi_assistant_id` |
| ACTN-02 | Platform routes tool calls to the correct tool configuration for that organization | `tool_configs` table lookup: `(org_id, tool_name)` → action type + integration ref |
| ACTN-03 | Admin can configure integration credentials per organization (GoHighLevel, etc.) | `integrations` table + AES-256-GCM application-level encryption via Web Crypto API |
| ACTN-04 | Integration credentials are encrypted at rest and never exposed in the UI | AES-256-GCM with `ENCRYPTION_SECRET` env var; UI only receives masked display values |
| ACTN-05 | Admin can test integration connections via a "Test Connection" button | Server Action calls GHL GET /contacts/ with org's credentials; returns success/error |
| ACTN-06 | Admin can create tool configurations mapping a Vapi tool name to an action type | `tool_configs` table: tool_name TEXT, action_type ENUM, integration_id FK |
| ACTN-07 | Admin can assign a specific integration to each tool configuration | `tool_configs.integration_id` FK → `integrations.id` |
| ACTN-08 | Admin can set a fallback message per tool that Vapi speaks if execution fails | `tool_configs.fallback_message TEXT NOT NULL` |
| ACTN-09 | Platform executes GHL actions (create contact, check availability, book appointment) | GHL API v2: POST /contacts/, GET /calendars/:id/free-slots, POST /calendars/events/appointments |
| ACTN-10 | Platform logs every tool execution with status, time ms, request + response payloads | `action_logs` table with JSONB columns + `after()` async write after Vapi response |
| ACTN-11 | Platform returns fallback message to Vapi if tool execution fails | Error path returns `{ results: [{ toolCallId, result: fallback_message }] }` with HTTP 200 |
| ACTN-12 | Edge Function responds to Vapi within 500ms — heavy processing delegated async | `after()` from `next/server` (Next.js 15.1+) for async logging; GHL call + DB lookup in hot path |
</phase_requirements>

---

## Summary

Phase 2 is the critical path for VoiceOps. The webhook route `/api/vapi/tools` receives a POST from Vapi during a live call, must resolve which organization owns the calling assistant, look up the configured action, execute a GoHighLevel API call, and return a valid response — all within 500ms. The call cannot go silent on failure; Vapi must always receive a valid `results` array.

The architecture has three zones: (1) the **hot path** — org resolution + tool lookup + GHL execution + immediate Vapi response; (2) the **async tail** — `after()` from `next/server` writes the action log after the response is sent without blocking it; (3) the **admin UI** — credential management and tool configuration forms using established Phase 1 patterns.

The key constraint: **Edge Runtime cannot use Node.js `crypto`**. Credential encryption must use the Web Crypto API (`crypto.subtle` / AES-256-GCM), which IS available in the Edge Runtime. The encryption key is stored in `ENCRYPTION_SECRET` environment variable, never in the database. Supabase Vault was evaluated but is not accessible from Next.js Edge Functions without a DB round-trip — application-level AES-256-GCM is the right choice here.

**Primary recommendation:** Implement the pipeline in order — schema migration → encryption utilities → GHL executor → webhook route → admin UI (integrations → tool configs). Each layer depends on the previous.

---

## Standard Stack

### Core (all carried forward from Phase 1)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.5.14 (project locked) | Edge Route Handlers | `export const runtime = 'edge'` for `/api/vapi/tools`; no cold starts |
| `@supabase/supabase-js` | 2.101.1 (project locked) | DB queries in Edge Route | `createClient()` with service-role key works in Edge Runtime |
| TypeScript | 5.x strict (project locked) | Type safety | Strict mode; Zod schemas for all webhook payloads |
| `zod` | 3.25.76 (project locked) | Payload validation | Validates incoming Vapi webhook shape before processing |

### New in Phase 2
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Web Crypto API (built-in) | N/A (runtime API) | AES-256-GCM encryption | Encrypting GHL credentials before DB write; decrypting before API call |
| `next/server` `after()` | Built into Next.js 15.1+ | Async logging after response | Writing `action_logs` row after Vapi response is sent |
| `react-hook-form` + `zod` | Already installed | Integration + tool config forms | Admin UI for credentials and tool configs |
| `sonner` | Already installed | Toast feedback | Connection test results, save confirmations |

**No new npm packages are required for Phase 2.** All dependencies are already in `package.json`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Application-level AES-256-GCM | Supabase Vault | Vault requires a DB round-trip to `vault.decrypted_secrets` view — adds ~50-100ms to the hot path; not viable. AES-256-GCM with env var key is simpler and faster |
| `after()` from next/server | `EdgeRuntime.waitUntil()` | `after()` is the Next.js 15.1+ canonical API; `waitUntil` requires `@vercel/functions` import. Use `after()` |
| `after()` from next/server | Synchronous DB write before response | Adds 20-50ms to the hot path; do not block Vapi response on logging |
| GHL Private Integration Token | GHL OAuth flow | OAuth requires user authorization redirect flow — not applicable for server-to-server integration. Private Integration Token is static Bearer token, correct for this use case |

---

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)

```
src/
├── app/
│   ├── api/
│   │   └── vapi/
│   │       └── tools/
│   │           └── route.ts        # Edge Function: POST /api/vapi/tools
│   └── (dashboard)/
│       └── integrations/
│           ├── page.tsx            # Integration list (shadcn/ui Table)
│           ├── new/
│           │   └── page.tsx        # New integration form
│           └── [id]/
│               ├── page.tsx        # Integration detail + tool configs
│               └── tools/
│                   └── new/
│                       └── page.tsx # New tool config form
├── lib/
│   ├── crypto.ts                   # AES-256-GCM encrypt/decrypt (Web Crypto API)
│   ├── ghl/
│   │   ├── client.ts               # GHL fetch wrapper (base URL, auth headers, timeout)
│   │   ├── create-contact.ts       # GHL createContact() executor
│   │   ├── get-availability.ts     # GHL getAvailability() executor
│   │   └── create-appointment.ts   # GHL createAppointment() executor
│   └── action-engine/
│       ├── resolve-org.ts          # assistant_id → org_id lookup
│       ├── resolve-tool.ts         # (org_id, tool_name) → tool_config lookup
│       ├── execute-action.ts       # dispatcher: routes to correct GHL executor
│       └── log-action.ts           # writes action_logs row (called via after())
└── types/
    └── vapi.ts                     # Zod schemas + TS types for Vapi webhook payloads
supabase/
└── migrations/
    └── 002_action_engine.sql       # integrations, tool_configs, action_logs tables + RLS
tests/
    ├── action-engine.test.ts       # ACTN-01, ACTN-02, ACTN-11, ACTN-12 unit tests
    ├── ghl-executor.test.ts        # ACTN-09 GHL executor unit tests (fetch mocked)
    ├── crypto.test.ts              # ACTN-04 encryption round-trip tests
    └── integrations.test.ts        # ACTN-03, ACTN-05, ACTN-06, ACTN-07, ACTN-08 tests
```

### Pattern 1: Vapi Tool-Call Webhook — Exact Payload Shape

**Incoming POST body (verified from Vapi docs):**

```typescript
// src/types/vapi.ts
import { z } from 'zod'

export const VapiToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Note: Vapi docs show "arguments" in newer examples, "parameters" in older ones.
  // Accept both defensively:
  arguments: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
})

export const VapiToolCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('tool-calls'),
    // call object contains assistantId (camelCase) — confirmed by Vapi API reference
    call: z.object({
      id: z.string(),
      assistantId: z.string(),   // <-- use this for org resolution
      orgId: z.string().optional(),
    }).passthrough(),
    toolCallList: z.array(VapiToolCallSchema),
  })
})

export type VapiToolCallMessage = z.infer<typeof VapiToolCallMessageSchema>
```

**Required response format (HTTP 200 always, even on error):**

```typescript
// Success
return Response.json({
  results: [{
    toolCallId: toolCall.id,
    result: "Contact created successfully. ID: abc123"  // single-line string
  }]
}, { status: 200 })

// Failure (use configured fallback message)
return Response.json({
  results: [{
    toolCallId: toolCall.id,
    result: fallbackMessage  // never return HTTP non-200; Vapi ignores it
  }]
}, { status: 200 })
```

**Critical Vapi webhook rules (verified):**
1. Always return HTTP 200 — any other status code is silently ignored by Vapi
2. `result` and `error` fields MUST be strings, not objects
3. No newlines in result strings — Vapi parsing breaks
4. `toolCallId` in response must exactly match `id` from `toolCallList[n]`
5. Tool call timeout: configurable via `timeoutSeconds` on the tool definition (default ~20s); 500ms budget is a project requirement, not Vapi's hard limit

### Pattern 2: Edge Route Handler

```typescript
// src/app/api/vapi/tools/route.ts
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function POST(request: Request) {
  const startTime = Date.now()
  
  // 1. Parse + validate payload
  const body = await request.json()
  const parsed = VapiToolCallMessageSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ results: [] }, { status: 200 })
  }

  const { call, toolCallList } = parsed.data.message
  const toolCall = toolCallList[0]  // handle first call (most webhooks have one)
  
  // 2. Resolve org from assistant ID
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  
  const { data: mapping } = await supabase
    .from('assistant_mappings')
    .select('organization_id')
    .eq('vapi_assistant_id', call.assistantId)
    .eq('is_active', true)
    .single()
  
  if (!mapping) {
    // Unknown assistant — return empty result (do not expose internal state)
    return Response.json({ results: [{ toolCallId: toolCall.id, result: 'Service unavailable.' }] }, { status: 200 })
  }

  // 3. Resolve tool config
  const { data: toolConfig } = await supabase
    .from('tool_configs')
    .select('*, integrations(*)')
    .eq('organization_id', mapping.organization_id)
    .eq('tool_name', toolCall.name)
    .eq('is_active', true)
    .single()
  
  if (!toolConfig) {
    return Response.json({ results: [{ toolCallId: toolCall.id, result: 'Tool not configured.' }] }, { status: 200 })
  }

  // 4. Execute GHL action (with timeout guard)
  let result: string
  let status: 'success' | 'error' | 'timeout' = 'success'
  let errorDetail: string | null = null

  try {
    const apiKey = await decrypt(toolConfig.integrations.encrypted_api_key)
    result = await executeAction(toolConfig.action_type, toolCall.arguments ?? toolCall.parameters ?? {}, {
      apiKey,
      locationId: toolConfig.integrations.location_id,
      calendarId: toolConfig.config?.calendarId,
    })
  } catch (err) {
    status = err instanceof TimeoutError ? 'timeout' : 'error'
    errorDetail = err instanceof Error ? err.message : String(err)
    result = toolConfig.fallback_message
  }

  const executionMs = Date.now() - startTime

  // 5. Log async — does NOT block Vapi response
  after(async () => {
    await supabase.from('action_logs').insert({
      organization_id: mapping.organization_id,
      tool_config_id: toolConfig.id,
      vapi_call_id: call.id,
      tool_name: toolCall.name,
      status,
      execution_ms: executionMs,
      request_payload: toolCall.arguments ?? toolCall.parameters ?? {},
      response_payload: { result },
      error_detail: errorDetail,
    })
  })

  // 6. Return to Vapi immediately
  return Response.json({
    results: [{ toolCallId: toolCall.id, result }]
  }, { status: 200 })
}
```

### Pattern 3: AES-256-GCM Encryption (Web Crypto API — Edge safe)

```typescript
// src/lib/crypto.ts
// Web Crypto API — works in Edge Runtime (no Node.js crypto required)

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256

async function getKey(): Promise<CryptoKey> {
  // ENCRYPTION_SECRET must be a 32-byte hex string (64 hex chars) in env
  const secret = process.env.ENCRYPTION_SECRET!
  const keyBytes = Buffer.from(secret, 'hex')
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))  // 96-bit IV per AES-GCM spec
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded)
  // Store as: base64(iv):base64(ciphertext)
  const ivB64 = btoa(String.fromCharCode(...iv))
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
  return `${ivB64}:${ctB64}`
}

export async function decrypt(stored: string): Promise<string> {
  const key = await getKey()
  const [ivB64, ctB64] = stored.split(':')
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
```

**Key rule:** Never reuse an IV. `crypto.getRandomValues` generates a fresh 12-byte IV per encryption call. The IV is stored alongside the ciphertext (not secret — it just must be unique per key/plaintext pair).

### Pattern 4: GoHighLevel API v2 Executor Pattern

**Auth:** Private Integration Token (Bearer token). Created per sub-account (location) in GHL Settings > Integrations. No OAuth redirect flow needed for server-to-server.

**Base URL:** `https://services.leadconnectorhq.com`

**Required headers:**
```
Authorization: Bearer <private_integration_token>
Version: 2021-07-28
Content-Type: application/json
```

**Create Contact:**
```typescript
// POST https://services.leadconnectorhq.com/contacts/
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+14155551234",
  "email": "john@example.com",
  "locationId": "<ghl_location_id>"  // required — scopes contact to sub-account
}
// Response 201: { contact: { id: "...", ... } }
```

**Check Availability:**
```typescript
// GET https://services.leadconnectorhq.com/calendars/:calendarId/free-slots
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), timezone (optional)
// Response 200: { [date: string]: { slots: string[] } }  // date-keyed availability map
```

**Create Appointment:**
```typescript
// POST https://services.leadconnectorhq.com/calendars/events/appointments
{
  "calendarId": "<ghl_calendar_id>",
  "contactId": "<ghl_contact_id>",
  "startTime": "2025-01-15T14:00:00+00:00",  // ISO 8601
  "endTime": "2025-01-15T14:30:00+00:00",
  "title": "Appointment with John",
  "appointmentStatus": "confirmed"
}
// Response 200: { id: "...", ... }
```

**Rate limits:** 100 requests / 10 seconds burst, 200,000 / day per app.

### Pattern 5: Database Schema for Phase 2

```sql
-- 002_action_engine.sql

-- Action types supported in Phase 2
CREATE TYPE public.action_type AS ENUM (
  'create_contact',
  'get_availability',
  'create_appointment',
  'send_sms',           -- Phase 2: stub only (v2 requirement)
  'knowledge_base',     -- Phase 4 will implement this
  'custom_webhook'      -- Phase 2: stub only (v2 requirement)
);

CREATE TYPE public.integration_provider AS ENUM (
  'gohighlevel',
  'twilio',
  'calcom',
  'custom_webhook'
);

-- Integration credentials (one per org per provider)
CREATE TABLE public.integrations (
  id               UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID                        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider         public.integration_provider NOT NULL,
  name             TEXT                        NOT NULL,          -- display name
  encrypted_api_key TEXT                       NOT NULL,          -- AES-256-GCM encrypted
  location_id      TEXT,                                          -- GHL location/sub-account ID
  config           JSONB                       NOT NULL DEFAULT '{}', -- provider-specific config
  is_active        BOOLEAN                     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_integrations_org_id ON public.integrations(organization_id);

-- Tool configurations: maps Vapi tool name → action
CREATE TABLE public.tool_configs (
  id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id   UUID              NOT NULL REFERENCES public.integrations(id) ON DELETE RESTRICT,
  tool_name        TEXT              NOT NULL,           -- must match Vapi tool name exactly
  action_type      public.action_type NOT NULL,
  config           JSONB             NOT NULL DEFAULT '{}', -- e.g. { "calendarId": "..." }
  fallback_message TEXT              NOT NULL,
  is_active        BOOLEAN           NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE(organization_id, tool_name)
);

ALTER TABLE public.tool_configs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tool_configs_org_id ON public.tool_configs(organization_id);
-- Load-bearing: webhook hot path hits this index on every tool call
CREATE INDEX idx_tool_configs_org_tool ON public.tool_configs(organization_id, tool_name);

-- Action execution log
CREATE TABLE public.action_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool_config_id   UUID        REFERENCES public.tool_configs(id) ON DELETE SET NULL,
  vapi_call_id     TEXT        NOT NULL,
  tool_name        TEXT        NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  execution_ms     INTEGER     NOT NULL,
  request_payload  JSONB       NOT NULL DEFAULT '{}',
  response_payload JSONB       NOT NULL DEFAULT '{}',
  error_detail     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.action_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_action_logs_org_id    ON public.action_logs(organization_id);
CREATE INDEX idx_action_logs_created   ON public.action_logs(created_at DESC);
CREATE INDEX idx_action_logs_tool_config ON public.action_logs(tool_config_id);
```

**RLS policies** follow the same `get_current_org_id()` pattern established in migration 001. The webhook route uses the service-role client (bypasses RLS by design — no user JWT available in Vapi webhooks).

### Anti-Patterns to Avoid

- **Blocking on DB log write:** Never write `action_logs` synchronously before returning to Vapi. Use `after()` — the log is not needed for the response.
- **Returning HTTP non-200 for errors:** Vapi silently ignores non-200 responses. The assistant goes silent. Always return 200 with fallback message.
- **Newlines in result strings:** Vapi's response parser breaks on `\n`. Flatten multi-line content to a single line before returning.
- **Storing plaintext API keys in DB:** `encrypted_api_key` column must always contain the `iv:ciphertext` format. Never store plaintext.
- **Exposing `encrypted_api_key` in UI responses:** Server Actions that return integration data must omit or mask the `encrypted_api_key` column.
- **Reusing IV across encryptions:** `crypto.getRandomValues` ensures fresh IV per call. Never pre-generate and reuse.
- **Using Node.js `crypto` module in Edge route:** Will throw at runtime. Use `crypto.subtle` (Web Crypto API) exclusively.
- **`@supabase/ssr` in the Edge webhook route:** Not needed for the webhook — it's not a user-facing route. Use `createClient` from `@supabase/supabase-js` directly with service-role key.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES encryption in Edge | Custom XOR/ROT cipher, base64 "security" | Web Crypto API `crypto.subtle` | Built into Edge Runtime; handles IV, authentication tag, key derivation correctly |
| HTTP timeouts for GHL calls | Manual `setTimeout` + Promise.race | `AbortController` + `signal` on `fetch()` | Native fetch timeout signal; cancel the request cleanly |
| JSON schema validation | Manual type checks | Zod `.safeParse()` | Already in project; handles nested schemas; returns typed errors |
| GHL API client | Full SDK | Direct `fetch()` wrapper with typed functions | GHL's npm package adds overhead; direct fetch with typed wrappers is simpler in Edge |
| Async logging | Background worker, queue | `after()` from `next/server` | Built into Next.js 15.1+; no additional infrastructure |

**Key insight:** The 500ms budget leaves no room for unnecessary abstraction layers. Every function in the hot path must be lean: one DB lookup for org, one DB lookup for tool config, one GHL API call, one response.

---

## 500ms Budget Analysis

| Step | Estimated Time | Notes |
|------|---------------|-------|
| Parse + Zod validate | ~1ms | Synchronous |
| DB: org lookup by assistant_id | ~10-25ms | Indexed on `vapi_assistant_id`; service-role client no auth overhead |
| DB: tool config lookup | ~10-25ms | Indexed on `(organization_id, tool_name)` |
| DB: decrypt credential (Web Crypto) | ~1-2ms | In-process, no network |
| GHL API call | ~80-200ms | Most variable; network to GHL servers |
| Serialize + return Response | ~1ms | |
| **Total hot path** | **~103-254ms** | **Headroom to spare** |
| `after()`: action_logs insert | ~20-50ms | Async — does not count against budget |

**Conclusion:** Even with a slow GHL response (~200ms) the hot path fits comfortably in 500ms. Add a 400ms `AbortController` timeout on the GHL fetch call to guarantee the budget is never exceeded.

---

## Common Pitfalls

### Pitfall 1: Vapi Silently Drops Non-200 Responses
**What goes wrong:** Route returns HTTP 422 or 500 on validation error. Vapi ignores the response entirely. The AI assistant receives no tool result and either hallucinates an answer or goes silent.
**Why it happens:** Developers apply standard REST conventions to a webhook that has unconventional requirements.
**How to avoid:** All code paths in the route handler return `Response.json(..., { status: 200 })`. Wrap the entire handler body in a try/catch; the catch block returns the fallback message.
**Warning signs:** Assistant speaks nothing after tool call; Vapi logs show "no response" for the tool.

### Pitfall 2: `arguments` vs `parameters` Field Name in toolCallList
**What goes wrong:** Code reads `toolCall.parameters` but Vapi sends `toolCall.arguments` (or vice versa depending on LLM and Vapi version).
**Why it happens:** Vapi documentation shows both field names in different examples; the actual field name depends on the LLM provider and Vapi version.
**How to avoid:** Accept both: `const args = toolCall.arguments ?? toolCall.parameters ?? {}`. The Zod schema should mark both optional.
**Warning signs:** `args` is always `{}` even when parameters were passed; GHL contacts created with empty fields.

### Pitfall 3: Edge Runtime crypto.subtle Key Import Failure
**What goes wrong:** `ENCRYPTION_SECRET` is set to a random string rather than a 32-byte hex value. `crypto.subtle.importKey` silently fails or throws a DOMException.
**Why it happens:** Developers set `ENCRYPTION_SECRET=mysecret` in `.env.local` instead of a proper 32-byte hex key.
**How to avoid:** Document that `ENCRYPTION_SECRET` must be exactly 64 hex characters. Validate length at app startup (in route handler, throw early if wrong length).
**Warning signs:** `DOMException: The provided value is not of the correct type.` at encryption time.

### Pitfall 4: RLS Blocks Service-Role Client (It Doesn't, But Common Confusion)
**What goes wrong:** Developer wraps the webhook's Supabase queries in `get_current_org_id()` style RLS — but there is no user JWT in an incoming Vapi webhook. Queries return nothing.
**Why it happens:** Copy-pasting patterns from dashboard server actions into the webhook route.
**How to avoid:** The webhook route MUST use the service-role client (`SUPABASE_SERVICE_ROLE_KEY`). Service-role bypasses RLS. The route is responsible for scoping queries by `vapi_assistant_id` → `organization_id` chain.
**Warning signs:** Lookups always return null even when data exists.

### Pitfall 5: `after()` Not Awaited Properly Causes Lost Logs
**What goes wrong:** The `action_logs` insert inside `after()` throws an unhandled error (e.g., schema mismatch). The log is silently dropped.
**Why it happens:** `after()` callbacks run outside the request lifecycle — unhandled rejections don't propagate to the caller.
**How to avoid:** Wrap the `after()` callback body in a try/catch that logs to console (Vercel function logs). Do not let the logging path throw silently.
**Warning signs:** Missing rows in `action_logs` for calls that are known to have executed.

### Pitfall 6: IV Reuse in Encryption
**What goes wrong:** A fixed IV is used (e.g., hardcoded in code or derived from a non-random source). AES-GCM with a reused IV for the same key is cryptographically broken — an attacker can recover the key.
**Why it happens:** Misunderstanding IV requirements; wanting deterministic encryption for de-duplication.
**How to avoid:** Always call `crypto.getRandomValues(new Uint8Array(12))` per encryption call. Store the IV with the ciphertext in the `iv:ciphertext` format.

### Pitfall 7: GHL `locationId` Missing from Create Contact
**What goes wrong:** POST to `/contacts/` without `locationId` returns 422. Contact not created.
**Why it happens:** GHL v2 requires location-scoping on all contact write operations; locationId ties the contact to the sub-account.
**How to avoid:** `location_id` is stored in the `integrations` table (admin configures it). The executor must always include it.
**Warning signs:** GHL API returns 422 with a message about missing location.

---

## Code Examples

### GHL Fetch Wrapper with AbortController Timeout

```typescript
// src/lib/ghl/client.ts
const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'
const GHL_TIMEOUT_MS = 400  // leaves 100ms of safety margin within 500ms budget

export async function ghlFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GHL_TIMEOUT_MS)
  
  try {
    const response = await fetch(`${GHL_BASE}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': GHL_VERSION,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}
```

### Org Resolution (Hot Path)

```typescript
// src/lib/action-engine/resolve-org.ts
// Source: migration 001 assistant_mappings table + idx_assistant_mappings_vapi_id index
export async function resolveOrg(
  supabase: SupabaseClient,
  assistantId: string
): Promise<{ organization_id: string } | null> {
  const { data } = await supabase
    .from('assistant_mappings')
    .select('organization_id')
    .eq('vapi_assistant_id', assistantId)
    .eq('is_active', true)
    .single()
  return data
}
```

### Credential Display Masking in Server Actions

```typescript
// When returning integrations to the UI, never expose encrypted_api_key
// Return a masked display value instead
const { encrypted_api_key: _, ...safeIntegration } = integration
return {
  ...safeIntegration,
  api_key_hint: '••••••••'  // display only
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `waitUntil()` from `@vercel/functions` | `after()` from `next/server` | Next.js 15.1 (Dec 2024) | Use built-in; no extra import needed |
| `getSession()` in middleware | `getClaims()` in middleware | Supabase SSR late 2025 | Already implemented in Phase 1 |
| GHL API v1 | GHL API v2 (services.leadconnectorhq.com) | GHL v1 EOL announced 2024 | Use v2 only; v1 unsupported |
| Node.js `crypto` for encryption | Web Crypto API (`crypto.subtle`) | Always true for Edge Runtime | Edge Runtime constraint; use `crypto.subtle` |

**Deprecated/outdated:**
- `EdgeRuntime.waitUntil()`: Works but is the older pattern. Next.js 15.1+ `after()` is canonical.
- GHL `Authorization` header `Token <key>`: Older docs show this format. Current v2 uses `Bearer <token>`.
- GHL API v1 base URL `https://rest.gohighlevel.com`: EOL. Use `https://services.leadconnectorhq.com`.

---

## Open Questions

1. **Exact `arguments` vs `parameters` field in Vapi tool call payload**
   - What we know: Vapi docs show both field names in different examples; the troubleshooting guide mentions `arguments`; the older server events doc shows `parameters`
   - What's unclear: Which field name the current production Vapi platform sends for tool calls via the server URL
   - Recommendation: Accept both in Zod schema (`arguments` OR `parameters`) to be defensive; log the raw payload in development to confirm

2. **`call.assistantId` exact casing in webhook payload**
   - What we know: Vapi uses camelCase throughout its API (TypeScript-first); `assistantId` is the field name in the REST API
   - What's unclear: Whether the webhook payload uses `assistantId` (camelCase) or `assistant_id` (snake_case)
   - Recommendation: Accept both in Zod schema; add a startup log of raw payload to confirm casing in first real test

3. **`action_logs` write via `after()` in Edge Runtime**
   - What we know: `after()` is documented for Next.js 15.1+ in App Router; project uses Next.js 15.5.14
   - What's unclear: Whether `after()` works correctly in `export const runtime = 'edge'` route handlers specifically (docs confirm Node.js runtime, Edge less explicit)
   - Recommendation: Implement with `after()` first; if it fails in Edge, fall back to `@vercel/functions` `waitUntil()` as alternative

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / Next.js dev server | All development | ✓ | 15.5.14 | — |
| Supabase (remote project) | All DB operations | ✓ | — | — |
| `ENCRYPTION_SECRET` env var | ACTN-04 credential encryption | Must be added | — | No fallback — blocks Phase 2 |
| GHL Private Integration Token | ACTN-09 GHL execution, ACTN-05 test connection | Must be provisioned | — | Cannot test without real GHL account |
| Vitest | Test suite | ✓ | 4.1.2 | — |
| Web Crypto API | ACTN-04 encryption | ✓ (Edge Runtime built-in) | — | — |

**Missing dependencies with no fallback:**
- `ENCRYPTION_SECRET`: A 64-hex-char (32-byte) random string must be generated and added to `.env.local` and Vercel environment variables before Phase 2 can run. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- GHL Private Integration Token: Required for real end-to-end test of ACTN-09. Unit tests can mock it; the final success criterion (#3) requires a real Vapi webhook.

**Missing dependencies with fallback:**
- Real Vapi webhook for integration test: The webhook handler can be tested with `fetch()` POST to localhost during dev using the Vapi CLI (`vapi listen`) or a manually crafted payload.

---

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (project root) — `environment: 'node'`, `include: ['tests/**/*.test.ts']` |
| Quick run command | `npx vitest run tests/action-engine.test.ts tests/crypto.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACTN-01 | Org resolved from assistantId via DB lookup | unit | `npx vitest run tests/action-engine.test.ts -t "ACTN-01"` | ❌ Wave 0 |
| ACTN-02 | Tool config resolved by (org_id, tool_name) | unit | `npx vitest run tests/action-engine.test.ts -t "ACTN-02"` | ❌ Wave 0 |
| ACTN-03 | Integration credentials saved (encrypted) to DB | unit | `npx vitest run tests/integrations.test.ts -t "ACTN-03"` | ❌ Wave 0 |
| ACTN-04 | encrypt() → DB store → decrypt() round trip | unit | `npx vitest run tests/crypto.test.ts` | ❌ Wave 0 |
| ACTN-05 | Test Connection: valid GHL key returns success | unit (mocked fetch) | `npx vitest run tests/integrations.test.ts -t "ACTN-05"` | ❌ Wave 0 |
| ACTN-06 | Tool config created with tool_name + action_type | unit | `npx vitest run tests/integrations.test.ts -t "ACTN-06"` | ❌ Wave 0 |
| ACTN-07 | Tool config integration_id FK is honored | unit | `npx vitest run tests/integrations.test.ts -t "ACTN-07"` | ❌ Wave 0 |
| ACTN-08 | fallback_message stored per tool config | unit | `npx vitest run tests/integrations.test.ts -t "ACTN-08"` | ❌ Wave 0 |
| ACTN-09 | createContact / getAvailability / createAppointment execute with mocked GHL | unit (fetch mocked) | `npx vitest run tests/ghl-executor.test.ts` | ❌ Wave 0 |
| ACTN-10 | action_logs row inserted with correct fields after execution | unit | `npx vitest run tests/action-engine.test.ts -t "ACTN-10"` | ❌ Wave 0 |
| ACTN-11 | Fallback message returned when GHL call throws | unit | `npx vitest run tests/action-engine.test.ts -t "ACTN-11"` | ❌ Wave 0 |
| ACTN-12 | Entire hot path completes in <500ms (mocked GHL 200ms delay) | unit (timing) | `npx vitest run tests/action-engine.test.ts -t "ACTN-12"` | ❌ Wave 0 |

### 5 Critical Integration Scenarios (Phase Gate)

These 5 scenarios MUST pass before the phase is considered complete:

1. **Happy path — create contact:** POST a valid Vapi tool-call payload with `tool_name: "create_contact"` to the route handler. GHL returns 201. Verify: response HTTP 200, `results[0].result` contains contact confirmation, `action_logs` row has `status: 'success'` and `execution_ms < 500`.

2. **Unknown assistant ID:** POST a Vapi payload with an `assistantId` not in `assistant_mappings`. Verify: response HTTP 200 with a generic fallback, no `action_logs` row created, no GHL API call made.

3. **GHL API failure (timeout):** POST a valid payload but mock GHL to delay > 400ms (AbortController fires). Verify: response HTTP 200 with `fallback_message` from tool config, `action_logs` row has `status: 'timeout'`, response returned before 500ms.

4. **Credentials encrypted at rest:** Insert an integration via Server Action. Query the `integrations` table directly (service-role). Verify: `encrypted_api_key` column is NOT the plaintext API key; it contains the `iv:ciphertext` format. Decrypt and verify it matches the original.

5. **Tenant isolation:** Organization A has a tool config for `create_contact`. POST a Vapi webhook for Organization B's assistant. Verify: Organization B's tool config (different `tool_name` / unconfigured) is used, NOT Organization A's. Organization A's `action_logs` shows no entries for this call.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/action-engine.test.ts tests/crypto.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + 5 integration scenarios pass before `/gsd:verify-work`

### Wave 0 Gaps (all files must be created before implementation begins)
- [ ] `tests/action-engine.test.ts` — covers ACTN-01, ACTN-02, ACTN-10, ACTN-11, ACTN-12
- [ ] `tests/ghl-executor.test.ts` — covers ACTN-09 with mocked `fetch`
- [ ] `tests/crypto.test.ts` — covers ACTN-04 round-trip
- [ ] `tests/integrations.test.ts` — covers ACTN-03, ACTN-05, ACTN-06, ACTN-07, ACTN-08

---

## Sources

### Primary (HIGH confidence)
- Vapi docs (https://docs.vapi.ai/tools/custom-tools) — tool-call webhook payload format, response requirements, HTTP 200 rule, `error` field format
- Vapi docs (https://docs.vapi.ai/server-url/events) — server event types and message structure
- Vapi docs (https://docs.vapi.ai/tools/custom-tools-troubleshooting) — common failure modes, `arguments` vs `parameters`, newline restrictions
- GHL API docs (https://marketplace.gohighlevel.com/docs/ghl/calendars/get-slots/index.html) — `/calendars/:calendarId/free-slots` endpoint structure
- GHL API docs (https://marketplace.gohighlevel.com/docs/ghl/calendars/create-appointment/index.html) — `/calendars/events/appointments` endpoint
- GHL API docs (https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/) — Private Integration Token format (`Bearer` + `Version` header)
- MDN Web Crypto API — AES-GCM, `crypto.subtle.importKey`, `crypto.subtle.encrypt`/`decrypt`, IV requirements
- Next.js changelog (https://vercel.com/changelog/waituntil-is-now-available-for-vercel-functions) — `after()` vs `waitUntil()` guidance
- Supabase Vault docs (https://supabase.com/docs/guides/database/vault) — evaluated and rejected for hot path; application-level AES chosen instead
- Phase 1 research + migration 001 — `assistant_mappings` table schema, RLS patterns, service-role client pattern

### Secondary (MEDIUM confidence)
- Vapi community (https://vapi.ai/community/m/1389736225799143434) — tool timeout is configurable; 500ms is a project requirement not Vapi's hard limit
- GHL support docs (https://help.gohighlevel.com/support/solutions/articles/48001060529) — v2 API migration guidance
- WebSearch cross-reference — GHL contact fields (`locationId` required, `firstName`, `phone`)

### Tertiary (LOW confidence — needs validation in first real test)
- `call.assistantId` field name (camelCase): Based on Vapi's consistent camelCase API style; unconfirmed by explicit webhook payload example. Defensive Zod schema accepts both casings.
- `toolCall.arguments` vs `toolCall.parameters`: Evidence points to `arguments` being current but `parameters` used in older payloads. Defensive schema accepts both.
- `after()` in Edge Runtime specifically: Documented for App Router broadly; Edge Runtime behavior confirmed by community reports but not explicit in official docs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all dependencies already installed
- Architecture: HIGH — Vapi webhook format verified, GHL auth pattern verified, Web Crypto API confirmed Edge-compatible
- GHL endpoint exact schemas: MEDIUM — endpoint URLs and key fields confirmed; exact required/optional field lists need validation against first real GHL call
- Pitfalls: HIGH — verified from official docs and community reports
- 500ms budget math: HIGH — based on measured Supabase/GHL typical latency; AbortController at 400ms provides hard guarantee

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable APIs; GHL v2 auth model unlikely to change)
