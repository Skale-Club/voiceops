# Operator — External Integrations

**Last updated:** 2026-04-03

## Integration Architecture

API keys are stored **per organization** in the `integrations` table, encrypted with AES-256-GCM. This means:
- Different orgs can have different API keys for the same provider
- Keys are never logged or exposed in plaintext
- `src/lib/crypto.ts` handles encrypt/decrypt
- `src/lib/integrations/get-provider-key.ts` handles retrieval + decryption

```
integrations table
  └── provider: 'openai' | 'anthropic' | 'openrouter' | 'gohighlevel' | 'vapi' | 'twilio' | 'calcom' | 'custom_webhook'
      encrypted_api_key: "iv:ciphertext"
```

---

## Vapi (Voice Platform)

**What it does**: AI phone calls — manages assistants, phone numbers, outbound campaigns, webhooks

**Auth**: `VAPI_API_KEY` env var (server-side)

**Inbound webhooks** (Operator receives):

| Endpoint | Event | Runtime |
|----------|-------|---------|
| `POST /api/vapi/tools` | Live tool call during call | Edge |
| `POST /api/vapi/calls` | End-of-call report | Edge |
| `POST /api/vapi/campaigns` | Campaign call completion | Edge |
| `POST /api/vapi/phone-numbers` | Phone number events | Edge |

**Outbound calls** (Operator sends):
```
POST https://api.vapi.ai/call
  { assistantId, phoneNumberId, customer: { number, name } }
```

**Key constraint**: Tool call webhooks have a **500ms total budget** — Operator must respond within this window including DB lookups, decryption, external API calls, and response formation.

**Key files**: `src/app/api/vapi/`, `src/lib/campaigns/outbound.ts`, `src/types/vapi.ts`

---

## Supabase

**What it does**: PostgreSQL database, JWT auth, file storage, real-time subscriptions, edge functions

**Client split**:

| Client | Key Used | Bypasses RLS | Usage |
|--------|---------|--------------|-------|
| `createServerClient()` | Publishable (anon) key | No | Dashboard server actions |
| `createAdminClient()` | Service role key | Yes | `/api/vapi/*` webhooks |

**Auth vars**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Storage**: Bucket `knowledge-docs` — PDF, TXT, CSV uploads

**Edge function**: `supabase/functions/process-embeddings/` (Deno) — triggered async after document upload

**Key RPC**: `match_document_chunks(org_id, embedding, match_count, threshold)` — HNSW cosine similarity search

---

## GoHighLevel / LeadConnector (CRM)

**What it does**: Contact creation, appointment booking, availability checking

**Auth**: Private Integration Token + Location ID — stored encrypted per org in `integrations` table

**API base**: `https://services.leadconnectorhq.com` (version header: `2021-07-28`)

**Hard timeout**: **400ms** (leaves 100ms margin within 500ms Vapi budget)

**Actions supported**:

| action_type | GHL Operation |
|-------------|---------------|
| `create_contact` | `POST /contacts/` |
| `get_availability` | `GET /calendars/{calendarId}/free-slots` |
| `create_appointment` | `POST /calendars/events/appointments` |

**Key files**: `src/lib/ghl/`

---

## OpenAI

**What it does**: Text embeddings for knowledge base

**Model**: `text-embedding-3-small` (1536 dimensions)

**Auth**: Stored encrypted per org in `integrations` table (provider: `'openai'`)

**Usage pattern**:
1. Document upload → chunk text → batch embed → store in `document_chunks`
2. Knowledge query → embed query → cosine similarity search

**Key files**: `src/lib/knowledge/embed.ts`, `supabase/functions/process-embeddings/`

---

## Anthropic (Claude)

**What it does**: Synthesizes knowledge base answers from retrieved chunks

**Model**: `claude-3-5-haiku-20241022`

**Auth**: Stored encrypted per org in `integrations` table (provider: `'anthropic'`)

**Role**: Fallback synthesizer — used only if OpenRouter key is not configured

**Key file**: `src/lib/knowledge/query-knowledge.ts`

---

## OpenRouter

**What it does**: LLM routing — cost-optimized proxy to multiple LLMs

**Model**: `anthropic/claude-haiku-4-5`

**Auth**: Stored encrypted per org in `integrations` table (provider: `'openrouter'`)

**Role**: Preferred synthesizer over direct Anthropic (checked first)

**Key file**: `src/lib/knowledge/query-knowledge.ts`

---

## Twilio (Partial — Not Yet Functional)

**Status**: UI allows setup, but no test endpoint or action handler implemented

**Auth**: Stored encrypted per org (provider: `'twilio'`)

**Planned use**: SMS sending (when `send_sms` action type is implemented)

---

## Cal.com (Partial — Not Yet Functional)

**Status**: UI allows setup, but no test endpoint implemented

**Auth**: Stored encrypted per org (provider: `'calcom'`)

**Planned use**: Alternative appointment booking

---

## Integration Test Flow

When a user clicks "Test Connection" in the UI:

```
src/app/(dashboard)/integrations/actions.ts → testIntegration(integrationId)
  → Fetch + decrypt key
  → Provider-specific ping:
      GoHighLevel → GET /locations/{locationId}
      OpenAI      → GET /models (list)
      Anthropic   → GET /models
      OpenRouter  → GET /models
      Vapi        → GET /assistants
      Twilio/Cal.com → no test endpoint yet
```

---

## Credential Flow Summary

```
User enters API key in UI
  → encrypt(key) → store in integrations.encrypted_api_key

Vapi tool call arrives
  → resolveTool(orgId, toolName) → JOIN integrations
  → decrypt(encrypted_api_key) → plaintext key
  → call external API with plaintext key

Display in UI
  → maskApiKey(key) → "••••••••key4"
```
