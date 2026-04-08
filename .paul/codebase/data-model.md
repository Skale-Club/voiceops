# Operator — Database Schema

**Last updated:** 2026-04-03  
**Database**: Supabase (PostgreSQL 15 + pgvector)  
**Migrations**: `supabase/migrations/`

---

## Core Tables

### `organizations`
Primary tenant boundary. Every row in every other table is scoped to an org.

```sql
id          UUID PRIMARY KEY
name        TEXT
slug        TEXT UNIQUE
is_active   BOOLEAN DEFAULT true
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

Migration: `001_foundation.sql`

---

### `org_members`
Many-to-many: users ↔ organizations (currently 1 org per user in practice).

```sql
id              UUID PRIMARY KEY
user_id         UUID  -- references auth.users
organization_id UUID  -- references organizations
role            TEXT  -- 'admin' | 'member'
created_at      TIMESTAMPTZ
```

Migration: `001_foundation.sql`

---

### `assistant_mappings`
Links Vapi assistants to organizations. Every incoming webhook resolves org via this table.

```sql
id                  UUID PRIMARY KEY
organization_id     UUID
vapi_assistant_id   TEXT UNIQUE   -- Vapi's assistant ID
name                TEXT
is_active           BOOLEAN DEFAULT true
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ

INDEX: idx_assistant_mappings_vapi_id (vapi_assistant_id)  -- load-bearing
```

Migration: `001_foundation.sql`

---

### `integrations`
Encrypted API credentials per org per provider.

```sql
id                UUID PRIMARY KEY
organization_id   UUID
provider          TEXT  -- 'gohighlevel'|'twilio'|'calcom'|'custom_webhook'|'openai'|'anthropic'|'openrouter'|'vapi'
name              TEXT
encrypted_api_key TEXT  -- AES-256-GCM format: "ivBase64:ciphertextBase64"
location_id       TEXT  -- GHL Location ID
config            JSONB -- provider-specific extra config
is_active         BOOLEAN DEFAULT true
```

Migration: `002_action_engine.sql`

---

### `tool_configs`
Maps Vapi tool names to action executors + integrations. Resolved on every tool call.

```sql
id               UUID PRIMARY KEY
organization_id  UUID
integration_id   UUID  -- references integrations (nullable for knowledge_base)
tool_name        TEXT
action_type      TEXT  -- 'create_contact'|'get_availability'|'create_appointment'|'send_sms'|'knowledge_base'|'custom_webhook'
config           JSONB -- action-specific config (field mappings, etc.)
fallback_message TEXT  -- returned if action fails
is_active        BOOLEAN DEFAULT true

UNIQUE(organization_id, tool_name)
INDEX: idx_tool_configs_org_tool (organization_id, tool_name)  -- load-bearing
```

Migration: `002_action_engine.sql`

---

### `action_logs`
Append-only audit trail of every tool execution during a call.

```sql
id               UUID PRIMARY KEY
organization_id  UUID
tool_config_id   UUID
vapi_call_id     TEXT
tool_name        TEXT
status           TEXT  -- 'success'|'error'|'timeout'
execution_ms     INT
request_payload  JSONB
response_payload JSONB
error_detail     TEXT
created_at       TIMESTAMPTZ
```

Migration: `002_action_engine.sql`

---

### `calls`
One row per completed Vapi call. Populated by the end-of-call webhook.

```sql
id                UUID PRIMARY KEY
organization_id   UUID
vapi_call_id      TEXT UNIQUE         -- idempotency key
assistant_id      TEXT
call_type         TEXT                -- 'inboundPhoneCall'|'outboundPhoneCall'|...
status            TEXT
ended_reason      TEXT
started_at        TIMESTAMPTZ
ended_at          TIMESTAMPTZ
duration_seconds  INT GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (ended_at - started_at)))
cost              NUMERIC(10,6)
customer_number   TEXT
customer_name     TEXT
summary           TEXT
transcript        TEXT
transcript_turns  JSONB
created_at        TIMESTAMPTZ
```

Migration: `003_observability.sql`

---

### `documents`
Knowledge base document metadata. Actual content in `document_chunks`.

```sql
id              UUID PRIMARY KEY
organization_id UUID
name            TEXT
source_type     TEXT  -- 'pdf'|'text'|'csv'|'url'
source_url      TEXT
status          TEXT  -- 'processing'|'ready'|'error'
error_detail    TEXT
chunk_count     INT
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

Migration: `004_knowledge_base.sql`

---

### `document_chunks`
Vectorized text chunks. The semantic search target.

```sql
id              UUID PRIMARY KEY
organization_id UUID
document_id     UUID  -- references documents
content         TEXT
chunk_index     INT
embedding       extensions.halfvec(1536)  -- pgvector; OpenAI text-embedding-3-small
created_at      TIMESTAMPTZ

INDEX: HNSW (embedding halfvec_cosine_ops)  -- fast cosine similarity
```

**RPC function**: `match_document_chunks(org_id, query_embedding, match_count=5, threshold=0.7)`
- `SECURITY DEFINER` (bypasses RLS, org scoped via parameter)
- Returns top-N chunks with cosine similarity above threshold

Migration: `004_knowledge_base.sql`

---

### `campaigns`
Outbound call campaign definitions.

```sql
id                    UUID PRIMARY KEY
organization_id       UUID
name                  TEXT
vapi_assistant_id     TEXT
vapi_phone_number_id  TEXT
vapi_campaign_id      TEXT  -- nullable; set by Vapi when campaign created
status                TEXT  -- 'draft'|'scheduled'|'in_progress'|'paused'|'completed'|'stopped'
scheduled_start_at    TIMESTAMPTZ
calls_per_minute      INT   -- 1–20; hard-capped at 10 in engine
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
```

Migration: `005_campaigns.sql`

---

### `campaign_contacts`
One row per contact per campaign. Tracks call attempt lifecycle.

```sql
id              UUID PRIMARY KEY
campaign_id     UUID
organization_id UUID
name            TEXT
phone           TEXT          -- E.164 format (+1XXXXXXXXXX)
custom_data     JSONB         -- extra CSV columns passed to Vapi
status          TEXT          -- 'pending'|'calling'|'completed'|'failed'|'no_answer'
vapi_call_id    TEXT          -- set when call fires
error_detail    TEXT
called_at       TIMESTAMPTZ
completed_at    TIMESTAMPTZ
retry_count     INT DEFAULT 0  -- max 2

UNIQUE(campaign_id, phone)
REPLICA IDENTITY FULL  -- required for Supabase Realtime
```

Migration: `005_campaigns.sql`

---

## Helper Functions

### `get_current_org_id()`
```sql
RETURNS UUID
SECURITY DEFINER
STABLE  -- result cached within transaction
-- Joins auth.uid() → org_members → organization_id
-- Used in all RLS policies to avoid repeated subqueries
```

---

## Row-Level Security

All tables have `ENABLE ROW LEVEL SECURITY`. Standard policy pattern:

```sql
CREATE POLICY "org_isolation" ON table_name
  FOR ALL USING (organization_id = get_current_org_id());
```

Webhook API routes use `createAdminClient()` (service role key) to bypass RLS, with explicit org resolution via `resolveOrg()`.

---

## Key Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_assistant_mappings_vapi_id` | `assistant_mappings` | `vapi_assistant_id` | Webhook org resolution |
| `idx_tool_configs_org_tool` | `tool_configs` | `(org_id, tool_name)` | Tool resolution per call |
| HNSW embedding index | `document_chunks` | `embedding` | Vector similarity search |
| Composite status index | `campaign_contacts` | `(org_id, status)` | Pending contact queries |
