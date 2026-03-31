# Pitfalls Research

**Domain:** Multi-tenant SaaS operations platform for Vapi.ai voice AI assistants
**Researched:** 2026-03-30
**Confidence:** HIGH

---

## Critical Pitfalls

### Pitfall 1: Vapi Tool-Call Webhook Timeout — Responding Too Slowly

**What goes wrong:**
Vapi expects a tool-call response within its timeout window. If your Edge Function takes too long — because it's doing sequential API calls to GoHighLevel, checking calendar availability, AND sending an SMS before returning — Vapi times out. The assistant on the call either hangs silently, retries (causing duplicate actions), or tells the caller "I'm having trouble." The live caller hears dead air. This is the #1 platform-killer because it directly breaks the core value proposition: "The Action Engine must work."

**Why it happens:**
Developers treat the webhook synchronously — run all actions, then return results. They underestimate cumulative latency: Supabase DB query (~50ms) + GoHighLevel API (~300ms) + Cal.com API (~200ms) + Twilio SMS (~150ms) = ~700ms before the response. Add network jitter and it blows past the 500ms budget. The Vapi `assistant-request` webhook has a hard 7.5-second limit (telephony provider enforces 15s, Vapi reserves ~7.5s for setup), and tool-calls have their own timeout. Edge Function cold starts add 50-200ms on top.

**How to avoid:**
1. **Respond immediately to Vapi** with a placeholder or partial result, then execute actions asynchronously using `EdgeRuntime.waitUntil()` or by returning a quick "processing" result.
2. For tool-calls that MUST return data (like "check availability"): do ONLY the data-fetch action synchronously (one API call), return the result, and defer side-effect actions (create contact, send SMS) to background tasks.
3. Use `EdgeRuntime.waitUntil()` (Supabase Edge Functions) or `waitUntil` (Vercel Edge) to fire-and-forget non-critical side effects.
4. Pin Edge Functions to a region close to your Supabase instance (preferably the same region) to minimize DB round-trips.

**Warning signs:**
- Vapi dashboard shows tool-call timeouts or retries
- Call transcripts show the assistant saying "Let me check..." followed by long pauses
- Action logs show execution times > 400ms end-to-end
- Edge Function cold starts visible in Vercel/Supabase logs

**Phase to address:** Phase 1 (Action Engine core) — this is the first thing that must work

---

### Pitfall 2: Multi-Tenant Data Leakage via Missing or Incorrect RLS Policies

**What goes wrong:**
One organization's data (call logs, contacts, credentials, transcripts) becomes visible to another organization. This is catastrophic for a B2B SaaS — it's an immediate trust violation, potential legal liability, and likely client churn. The most dangerous variant: `organization_id` exists as a column but either (a) RLS isn't enabled on the table, (b) a policy references the wrong column, or (c) the service_role key is used in a context where it shouldn't be, bypassing RLS entirely.

**Why it happens:**
- Developer creates a new table and forgets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Policy uses `auth.uid()` instead of looking up the user's organization via a join, so it checks the wrong thing
- Service role key (`SUPABASE_SERVICE_ROLE_KEY`) is used in client-side code or in an Edge Function that should use the user's JWT context
- A new migration adds a table but doesn't include the RLS policy in the migration file
- Views are created that bypass RLS by default (Postgres views use `security definer` by default)

**How to avoid:**
1. **Create an event trigger** that auto-enables RLS on all new tables in the `public` schema (Supabase docs provide the exact SQL — included in research sources).
2. **Standardize the RLS pattern**: Every table gets `organization_id`. Every policy uses a helper function like `get_current_org_id()` that resolves `auth.uid() → user_organizations.organization_id`.
3. **Write the helper function as `security definer`** in a non-public schema (e.g., `private`) so it bypasses RLS on the lookup table itself, avoiding circular policy evaluation.
4. **Use `(select auth.uid())` wrapping** in all RLS policies — this causes Postgres to cache the result per statement instead of calling the function for every row (99.94% performance improvement per Supabase benchmarks).
5. **Never use the service_role key in browser code.** In Edge Functions receiving Vapi webhooks (which have no user JWT), use the service_role key but manually validate the Vapi secret AND manually filter by `organization_id` in every query.
6. **Add indexes on `organization_id`** for every table — RLS policies effectively add a WHERE clause on every query, and without an index this becomes a sequential scan.
7. **Write integration tests** that create two orgs, insert data as org A, then query as org B and assert zero results.

**Warning signs:**
- A table exists in `public` schema without `ENABLE ROW LEVEL SECURITY`
- RLS policies that don't reference `organization_id`
- Service role key appearing in frontend bundle or `.env` files with `NEXT_PUBLIC_` prefix
- Views created without `security_invoker = true`
- No automated tests for cross-org data isolation

**Phase to address:** Phase 1 (foundation) — RLS must be correct from the first table

---

### Pitfall 3: Credential Storage in Plain Text

**What goes wrong:**
GoHighLevel API keys, Twilio credentials, Cal.com tokens, and custom webhook secrets are stored as plain text in the database. If the database is compromised (SQL injection, leaked backup, insider threat), every client's third-party credentials are exposed. This is especially severe because these credentials grant access to client CRMs, phone systems, and calendars — not just your platform.

**Why it happens:**
- Speed: encrypting/decrypting adds complexity, and it "works" without it
- Misunderstanding: developers assume Supabase's TLS-in-transit and RLS are sufficient protection
- The encryption key management problem feels hard ("where do I store the encryption key?")

**How to avoid:**
1. **Encrypt credentials at rest** using AES-256-GCM before writing to the database.
2. **Use Supabase Edge Function secrets** for the encryption key (`ENCRYPTION_KEY` environment variable). This key is never in the database, never in the codebase, and never in the frontend.
3. **Decrypt only in Edge Functions** (server-side), never expose decrypted values to the client. The admin UI shows "••••••••" for credentials; only on "test connection" does the server-side code decrypt and use them.
4. **Use the Web Crypto API** (`crypto.subtle`) available in Edge Runtime for encryption — no external libraries needed.
5. Store IV/nonce alongside the ciphertext (they don't need to be secret, just unique).

**Warning signs:**
- `credentials` table has columns like `api_key TEXT` without any encryption/decryption logic
- Frontend code can read full credential values from API responses
- No `ENCRYPTION_KEY` in Edge Function secrets
- Credentials visible in Supabase dashboard table editor

**Phase to address:** Phase 1 (credential storage) — before any real credentials are saved

---

### Pitfall 4: Edge Function Limitations Breaking at Runtime

**What goes wrong:**
Code that works locally in Node.js fails in Edge Functions at runtime. Common failures: using `fs`, `path`, `crypto.createHash` (Node crypto, not Web Crypto), `Buffer` in unsupported ways, `require()` instead of `import`, or importing an npm package that relies on Node.js native APIs. The error appears only in production because local dev with Supabase CLI may behave slightly differently.

**Why it happens:**
- Edge Runtime is V8-based, not Node.js — it supports a subset of Web APIs + a small set of Node modules (`async_hooks`, `events`, `buffer`, `assert`, `util`)
- Code size limit: 1MB (Hobby) / 2MB (Pro) after gzip — importing heavy libraries (full ORM, large SDK) blows this limit
- Maximum CPU time: 2 seconds per request (wall clock is higher, but actual CPU time is capped)
- No `eval()`, no `new Function()`, no dynamic `WebAssembly.compile()`
- Vercel Edge functions must begin sending a response within 25 seconds

**How to avoid:**
1. **Test Edge Functions in the actual runtime early** — don't develop in Node and "convert later."
2. **Use Web Crypto API** (`crypto.subtle.encrypt`, `crypto.subtle.sign`) instead of Node's `crypto` module.
3. **Use ES module imports only** — no `require()`. Check that npm packages support ESM.
4. **Keep bundle size minimal** — avoid importing full SDKs; use `fetch` directly for REST APIs (GoHighLevel, Cal.com, Twilio all have simple REST APIs).
5. **Pin Edge Function regions** close to Supabase DB for lowest latency.
6. **Use `EdgeRuntime.waitUntil()`** for background tasks (logging, async actions) to stay within CPU time limits.

**Warning signs:**
- `import` statements for packages known to use native Node APIs (e.g., `pg` directly, `knex`, heavy ORM)
- Functions that work locally but return 500 errors when deployed
- Bundle size warnings during `vercel deploy` or `supabase functions deploy`
- Using `crypto` without checking if it's `crypto.subtle` (Web Crypto) vs `crypto.createHash` (Node)

**Phase to address:** Phase 1 (all Vapi webhook routes are Edge Functions)

---

### Pitfall 5: RLS Performance Degradation at Scale

**What goes wrong:**
As tables grow (especially `action_logs` and `call_logs` which accumulate rapidly), queries become slow because RLS policies are evaluated per-row. A policy like `auth.uid() = user_id` without wrapping `auth.uid()` in a subquery causes the function to be called for every row. Without indexes on the RLS filter columns, Postgres does sequential scans. At 100K+ rows, queries that took 10ms now take seconds.

**Why it happens:**
- Supabase's own benchmarks show unwrapped `auth.uid()` can be 179ms vs 9ms when wrapped — a 95% improvement
- Missing indexes on `organization_id` means the implicit WHERE clause from RLS does a full table scan
- Complex RLS policies with joins (e.g., checking team membership via a join table) compound the problem — a single join can go from 9ms to 9,000ms without optimization
- Developers don't notice in dev because they have 100 rows, not 100K

**How to avoid:**
1. **Always use `(select auth.uid())`** wrapping in policies — this is non-negotiable.
2. **Add B-tree indexes on `organization_id`** for every multi-tenant table: `CREATE INDEX idx_tablename_org_id ON table_name USING btree (organization_id);`
3. **Minimize joins in RLS policies** — restructure to use `IN (subquery)` instead of joining source to target tables.
4. **Use `security definer` helper functions** for complex lookups (e.g., "is user admin of org X") — these run as the creator (superuser) and bypass RLS on the lookup tables.
5. **Always add explicit filters in application queries** (e.g., `.eq('organization_id', orgId)`) even though RLS handles it — Postgres uses the explicit filter for better query planning.
6. **Specify `TO authenticated`** in all policies — this prevents policy evaluation for `anon` requests entirely.

**Warning signs:**
- RLS policies using `auth.uid()` without `(select ...)` wrapping
- No indexes on `organization_id` columns
- Query performance degrading as data grows
- Dashboard load times increasing over time

**Phase to address:** Phase 1 (schema design) — indexes and policy patterns set from day one

---

### Pitfall 6: Vapi Webhook Without User Context — RLS Bypass Pattern

**What goes wrong:**
Vapi webhooks arrive at your Edge Function without a user JWT — they come from Vapi's servers, not from a logged-in user. If the Edge Function uses the Supabase client with `SUPABASE_ANON_KEY` and tries to rely on RLS, all queries return nothing (because `auth.uid()` is null). If it uses `SUPABASE_SERVICE_ROLE_KEY`, it bypasses all RLS — meaning any bug in the query logic could return or modify the wrong organization's data.

**Why it happens:**
This is a fundamental architectural tension: Vapi doesn't know about Supabase Auth. The webhook payload contains assistant/call metadata but no Supabase user context. The only way to identify the organization is by mapping the `assistantId` (from Vapi payload) to an organization (via database lookup). This lookup itself must use the service_role key.

**How to avoid:**
1. **Accept that Vapi webhook Edge Functions MUST use the service_role key** — this is correct and necessary.
2. **Validate the Vapi webhook authenticity first** — check the `X-Vapi-Secret` header (or HMAC signature) to confirm the request actually came from Vapi.
3. **Always explicitly filter by `organization_id`** in every query — never do `SELECT * FROM action_logs` even with service_role; always `WHERE organization_id = $1`.
4. **Look up organization_id once** (from `assistantId` → `assistants` table → `organization_id`), then pass it explicitly to all subsequent queries.
5. **Never trust client-supplied `organization_id`** from the webhook payload — always derive it from the authenticated assistant mapping.
6. **Log the resolved organization_id** in every action for audit trail.

**Warning signs:**
- Edge Function code using `SUPABASE_ANON_KEY` for Vapi webhooks (queries return empty)
- Edge Function code using `SUPABASE_SERVICE_ROLE_KEY` without explicit `organization_id` filters
- No Vapi webhook signature validation
- `organization_id` read from request body instead of derived from assistant mapping

**Phase to address:** Phase 1 (webhook handler architecture)

---

### Pitfall 7: pgvector Performance Collapse Without Proper Indexing

**What goes wrong:**
Knowledge base semantic search works fine during development with 100 chunks. At production scale (10K+ chunks across multiple organizations), queries take 5-30 seconds because pgvector performs a sequential scan through every vector. The query is even slower if RLS is evaluating per-row against the vector table. During a live call, a 10-second knowledge base lookup means the caller sits in silence.

**Why it happens:**
- No HNSW index created on the embedding column
- Using IVFFlat index instead of HNSW (IVFFlat requires rebuilding when data changes significantly; HNSW handles changing data well)
- RLS policy on the vector table causing additional per-row overhead
- Using too many dimensions (e.g., 1536 from OpenAI `text-embedding-3-small`) when fewer dimensions would suffice
- Not filtering by `organization_id` before the vector search, forcing pgvector to scan all tenants' data

**How to avoid:**
1. **Create HNSW indexes from day one** — unlike IVFFlat, HNSW is safe to create immediately and handles changing data:
   ```sql
   CREATE INDEX idx_documents_embedding ON documents
     USING hnsw (embedding vector_cosine_ops);
   ```
2. **Always include `organization_id` filter** in the match function — filter tenants first, then do semantic search within the org's data.
3. **Consider fewer dimensions** — Supabase's own analysis shows fewer dimensions perform better. Test if 384 or 512 dimensions suffice for your use case (OpenAI's `text-embedding-3-small` supports reducing dimensions).
4. **Use the match function pattern** (RPC via `supabase.rpc()`) — PostgREST doesn't support pgvector operators directly.
5. **Order by the distance operator directly** (not by a computed similarity column) to ensure the index is used:
   ```sql
   ORDER BY (embedding <=> query_embedding) ASC  -- uses index
   -- NOT: ORDER BY similarity DESC               -- ignores index
   ```
6. **Partition or separate vector tables** if one tenant has massively more documents than others (prevents their data from dominating index structure).

**Warning signs:**
- No HNSW index on vector columns
- Knowledge base queries taking > 1 second
- Using IVFFlat instead of HNSW
- Match function scanning all organizations' vectors
- Knowledge base responses timing out during live calls

**Phase to address:** Phase 2 (Knowledge Base / RAG feature)

---

### Pitfall 8: Call Observability Data Volume Explosion

**What goes wrong:**
Every call generates: a transcript, multiple status updates, conversation updates (per message), speech updates, tool-call payloads, and the end-of-call report. For 100 calls/day at 20 clients, that's 2,000 calls/day generating potentially 20-50 database rows each (messages, tool logs, status events). Within months, the `call_logs` and `action_logs` tables have millions of rows. Queries slow down, storage costs increase, and the dashboard becomes sluggish.

**Why it happens:**
- Vapi sends many event types per call (status-update, transcript, speech-update, conversation-update, model-output, tool-calls, end-of-call-report) — storing all of them naively creates enormous tables
- Full request/response payloads for every tool call are stored verbatim
- No data retention policy or archiving strategy
- Dashboard queries do `SELECT * FROM call_logs ORDER BY created_at DESC LIMIT 50` without time-bounded filters, forcing Postgres to scan recent data inefficiently

**How to avoid:**
1. **Be selective about what you store** — you don't need every `speech-update` or `transcript` (partial). Store: `end-of-call-report` (transcript + summary), `tool-calls` (action logs), and `status-update` (ended). Discard intermediate events or store them in a separate cold-storage table.
2. **Separate hot and cold data** — recent calls (last 30 days) in the main query table, older calls in an archive table or Parquet files in Supabase Storage.
3. **Add time-based indexes** on `created_at` for all log tables.
4. **Compress payloads** — store full request/response JSON in a `jsonb` column but consider truncating large payloads or storing only the essential fields.
5. **Paginate dashboard queries** with cursor-based pagination (not offset-based) for consistent performance.
6. **Pre-aggregate metrics** — don't calculate "total calls this month" by counting rows; maintain a daily summary table updated via a cron job or trigger.

**Warning signs:**
- Dashboard "recent calls" query taking > 500ms
- `call_logs` table growing by > 10K rows/day
- Storing every Vapi event type without filtering
- No `created_at` index or time-bounded queries
- Calculating aggregates on-the-fly from raw log tables

**Phase to address:** Phase 2 (Observability feature) — design schema with growth in mind

---

### Pitfall 9: Race Conditions in Campaign Contact Dialing

**What goes wrong:**
Outbound campaigns dial contacts via Vapi Outbound API. If multiple campaign workers or retries fire simultaneously, the same contact gets called twice. Or a contact who already answered gets queued again because the status update hasn't propagated yet. This results in angry recipients (called twice in 5 minutes) and wasted Vapi credits.

**Why it happens:**
- No database-level locking on contact status
- Status updates from Vapi webhooks (`status-update: ringing`, `status-update: ended`) arrive asynchronously — the "dial next batch" logic may execute before the previous batch's statuses are recorded
- Optimistic UI shows "dialing" but the actual dial hasn't completed yet, and the user clicks "dial" again
- Using `SELECT ... WHERE status = 'pending'` without `FOR UPDATE SKIP LOCKED` in concurrent execution

**How to avoid:**
1. **Use `SELECT ... FOR UPDATE SKIP LOCKED`** when picking the next batch of contacts to dial — this prevents two workers from grabbing the same contacts.
2. **Implement idempotency keys** for each dial attempt — Vapi call ID + contact ID as a unique constraint.
3. **Set contact status to 'dialing' atomically** when picked from the queue, before making the Vapi API call.
4. **Use a simple sequential batch approach** for MVP — don't try parallel dialing until the sequential version works perfectly.
5. **Add a cooldown period** per contact — don't retry a number within N minutes of any call attempt.
6. **Process Vapi status webhooks with `UPDATE ... WHERE call_id = $1`** — idempotent by design since Vapi may send duplicate webhooks.

**Warning signs:**
- Same contact appearing in call logs multiple times within minutes
- Campaign showing "50 contacts called" but only 40 unique phone numbers
- No `FOR UPDATE` or `SKIP LOCKED` in contact selection queries
- Concurrent function invocations selecting from the same pending queue
- No unique constraint on (campaign_id, contact_id, attempt_number)

**Phase to address:** Phase 3 (Campaigns feature)

---

### Pitfall 10: Vapi `assistant-request` Hard 7.5-Second Timeout

**What goes wrong:**
For inbound calls where the assistant must be dynamically resolved, the `assistant-request` webhook has a **hard 7.5-second end-to-end limit** (telephony provider enforces 15s, Vapi reserves ~7.5s for call setup). If your Edge Function takes too long to look up the assistant configuration (complex DB queries, slow external API calls), the call fails and the caller hears nothing or gets an error. This timeout is fixed and NOT configurable — the dashboard timeout setting does not apply to this webhook type.

**Why it happens:**
- Developers don't distinguish between `tool-calls` (configurable timeout) and `assistant-request` (7.5s hard limit)
- The assistant lookup involves multiple DB queries or an external API call
- Edge Function is deployed in a region far from the Supabase database
- Over-engineering the response: building a full transient assistant config with dynamic prompts fetched from external sources

**How to avoid:**
1. **Return an existing `assistantId` quickly** — do a simple lookup by phone number → assistant mapping. This should be a single indexed DB query.
2. **If you need dynamic context** (customer name, account info), return a minimal assistant immediately and enrich the context asynchronously using Vapi's Live Call Control API after the call starts.
3. **Pin the webhook Edge Function to a region close to both Vapi (us-west-2) and your Supabase instance.** If they're in different regions, you're spending 100-200ms on network latency alone.
4. **Pre-compute assistant configurations** — don't assemble them on-the-fly from multiple sources.
5. **Cache the phone number → assistant mapping** if possible (Edge Config, or a warm Edge Function instance variable).

**Warning signs:**
- Inbound calls failing silently or with errors
- `assistant-request` response time > 5 seconds
- Complex DB queries in the assistant-request handler
- Edge Function deployed in a region distant from both Vapi and Supabase
- Attempting to fetch external data (CRM, knowledge base) during assistant-request

**Phase to address:** Phase 1 (webhook handler) — but primarily affects inbound calls which may be Phase 2+

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip credential encryption | Ship credential storage faster | Every credential exposed on DB breach; client trust destroyed | Never |
| Use Node.js runtime for webhook routes | Access to full npm ecosystem | Cold starts > 500ms, Vapi timeouts | Never for Vapi routes |
| Store all Vapi events | Complete audit trail | Table bloat, slow queries, high storage costs | MVP only — filter to essential events before real traffic |
| Skip RLS on internal-only tables | Faster schema setup | One code path exposes the table publicly → data leak | Never on any table in `public` schema |
| Use plain `auth.uid()` in policies | Simpler SQL | 20x slower queries at scale; table scans | Never — always wrap in `(select ...)` |
| No automated RLS tests | Ship features faster | Silent data leakage between organizations | Never — add test harness in Phase 1 |
| Single-table action_logs without partitioning | Simpler queries | Slow dashboard at 1M+ rows | MVP acceptable — add time-based partitioning by Phase 3 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Vapi Webhooks** | Using `anon` key in Edge Function for webhook → empty query results | Use `service_role` key + manual `organization_id` filtering + Vapi secret validation |
| **Vapi Tool-Calls** | Running all actions synchronously before responding | Respond immediately, use `EdgeRuntime.waitUntil()` for side effects |
| **Vapi `assistant-request`** | Assuming configurable timeout | Hard 7.5s limit — return `assistantId` via simple indexed lookup |
| **Vapi Events** | Trusting all event types are reliable/deduplicated | Handle duplicate webhooks idempotently (upsert by `call_id`) |
| **Supabase RLS** | Creating views without `security_invoker = true` | Views bypass RLS by default — always set `security_invoker = true` on Postgres 15+ |
| **Supabase RLS** | Not adding indexes on `organization_id` | RLS is an implicit WHERE clause — index every filtered column |
| **Supabase Edge Functions** | Using Node.js `crypto` module | Use Web Crypto API (`crypto.subtle`) — Node crypto not available in Edge Runtime |
| **Supabase Connections** | Using direct connection string from Edge Functions | Use transaction-mode pooler (port 6543) for serverless/edge — disable prepared statements |
| **GoHighLevel API** | No retry logic for rate limits | Implement exponential backoff — GHL has aggressive rate limits on some endpoints |
| **pgvector** | Creating IVFFlat index on changing data | Use HNSW — it handles inserts/updates without rebuild |
| **pgvector** | Ordering by computed similarity instead of distance operator | Order by `(embedding <=> query_embedding) ASC` to use the index |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential scan on RLS tables | Dashboard queries slow down over weeks | Index `organization_id` on every table; wrap `auth.uid()` in `(select ...)` | ~10K rows per org |
| pgvector without HNSW index | Knowledge base queries > 2 seconds | Create HNSW index immediately; filter by `organization_id` first | ~1K vectors |
| Edge Function cold start + far DB region | P95 latency spikes > 500ms | Pin Edge Functions to same region as Supabase | Immediately on deployment |
| Storing all Vapi events without filtering | `call_logs` table grows 50x expected | Store only end-of-call + tool-call events | ~1K calls total |
| Offset-based pagination on call logs | Page 10 loads in 5 seconds; page 1 in 50ms | Cursor-based pagination (`WHERE created_at < last_seen`) | ~100K rows |
| No connection pooling from Edge Functions | Connection limit exhausted; 503 errors | Use Supavisor transaction mode (port 6543) with `prepare: false` | ~20 concurrent requests |
| Calculating dashboard metrics from raw logs | Dashboard takes 3+ seconds to load | Pre-aggregate daily/weekly metrics in summary tables | ~10K rows in log tables |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Service role key in frontend code | Complete RLS bypass; full database access to anyone | Never use `SUPABASE_SERVICE_ROLE_KEY` in browser; only in Edge Functions/server routes |
| Storing credentials in plain text | All client CRM/phone/calendar credentials exposed on DB breach | AES-256-GCM encryption at rest; decrypt only server-side; use Web Crypto API |
| No Vapi webhook signature validation | Anyone can POST fake tool-calls to your endpoint | Validate `X-Vapi-Secret` header or HMAC signature on every webhook |
| `organization_id` from client request body | Attacker modifies payload to access other org's data | Always derive `organization_id` from authenticated context (JWT → user → org) or assistant mapping |
| No rate limiting on webhook endpoints | DDoS or repeated webhook replay attacks | Add rate limiting per IP / per assistant ID in Edge Function or via Vercel firewall |
| JWT secret leaked via `NEXT_PUBLIC_` env var | Anyone can forge valid JWTs and impersonate any user | Never prefix secrets with `NEXT_PUBLIC_`; audit env var names |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing raw JSON in tool execution logs | Admin (non-developer) can't understand what happened | Parse and display human-readable action summaries: "Created contact John Doe in GoHighLevel" |
| No real-time feedback during campaign execution | Admin doesn't know if campaign is working | Show live status badges (Queued → Dialing → In Progress → Completed/Failed) per contact |
| Credential form shows full API key after save | If screen is shared, credentials are exposed | Show "••••••last4" pattern; only reveal on explicit "show" click |
| No error context when tool execution fails | Admin sees "Failed" with no explanation | Show error category (timeout, auth, validation) and actionable suggestion |
| Infinite loading states | User thinks app is broken | Show skeleton loaders with progress indication; set expectations ("Processing document...") |

## "Looks Done But Isn't" Checklist

- [ ] **RLS:** Table has RLS enabled AND has policies for all CRUD operations (SELECT, INSERT, UPDATE, DELETE) — not just SELECT
- [ ] **RLS:** UPDATE policies have both `USING` and `WITH CHECK` clauses — missing `WITH CHECK` allows changing `organization_id` to another org
- [ ] **Edge Functions:** Deployed and tested in production runtime, not just local dev — Node.js vs Edge Runtime differences surface in prod
- [ ] **Webhook Authentication:** Vapi secret validation works on the deployed Edge Function URL, not just localhost with ngrok
- [ ] **Multi-tenant Isolation:** Automated test exists that verifies org A cannot read org B's data for every table
- [ ] **Encryption:** Credential save → DB → decrypt cycle works end-to-end; encrypted blob is unreadable in DB
- [ ] **Campaign Dialing:** Contact called exactly once per attempt — verify with unique constraint and logs
- [ ] **Knowledge Base:** Semantic search filtered by organization — query org A's KB, confirm zero results from org B
- [ ] **Dashboard Metrics:** Pre-aggregated or properly indexed — loads in < 500ms with 10K+ calls
- [ ] **Tool Execution:** Full round-trip tested: Vapi triggers tool → Edge Function executes → result returns to Vapi within 500ms

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Missing RLS on table | LOW | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + add policies — but audit for any data accessed during unprotected window |
| Plain text credentials | HIGH | Encrypt all existing credentials, rotate every client's API keys (clients must update their third-party credentials) |
| Slow pgvector queries | MEDIUM | Add HNSW index (builds online, table remains accessible), add `organization_id` filter to match function |
| Duplicate campaign calls | MEDIUM | Add `FOR UPDATE SKIP LOCKED`, add unique constraint, deduplicate existing data |
| Edge Function using Node APIs | MEDIUM | Rewrite to use Web Crypto API / fetch; test thoroughly in Edge Runtime |
| Call logs table too large | MEDIUM | Add time-based partitioning, create archive table, migrate old data |
| Wrong region for Edge Functions | LOW | Add `preferredRegion` config and redeploy |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Vapi tool-call timeout (P1) | Phase 1: Action Engine | Tool execution P95 < 400ms in load test |
| RLS data leakage (P2) | Phase 1: Foundation | Automated test: org A queries return zero org B data |
| Credential encryption (P3) | Phase 1: Credential storage | DB inspection shows only ciphertext; decrypt cycle works |
| Edge Function limitations (P4) | Phase 1: All webhook routes | All routes deployed and responding in Edge Runtime |
| RLS performance (P5) | Phase 1: Schema design | Query plan shows index scan, not sequential scan |
| Vapi webhook RLS pattern (P6) | Phase 1: Webhook handler | Every service_role query has explicit `organization_id` filter |
| pgvector performance (P7) | Phase 2: Knowledge Base | Semantic search < 200ms with 10K vectors |
| Observability data volume (P8) | Phase 2: Call logs | Dashboard loads < 500ms with 10K+ calls |
| Campaign race conditions (P9) | Phase 3: Campaigns | No duplicate calls in load test with concurrent batches |
| assistant-request timeout (P10) | Phase 1 (inbound) / Phase 2 | Response time < 5s for assistant lookup |

## Sources

- Supabase RLS official docs: https://supabase.com/docs/guides/database/postgres/row-level-security — HIGH confidence
- Supabase RLS performance benchmarks (GaryAustin1): referenced from Supabase docs — HIGH confidence
- Supabase Edge Functions docs: https://supabase.com/docs/guides/functions — HIGH confidence
- Supabase Edge Functions limits: https://supabase.com/docs/guides/functions/limits — HIGH confidence
- Supabase Edge Functions background tasks: https://supabase.com/docs/guides/functions/background-tasks — HIGH confidence
- Supabase pgvector docs: https://supabase.com/docs/guides/ai/vector-columns — HIGH confidence
- Supabase HNSW indexes: https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes — HIGH confidence
- Supabase connection pooling: https://supabase.com/docs/guides/database/connecting-to-postgres — HIGH confidence
- Vapi Server URL docs: https://docs.vapi.ai/server-url — HIGH confidence
- Vapi Server Events docs: https://docs.vapi.ai/server-url/events — HIGH confidence (7.5s assistant-request timeout)
- Vapi Server Authentication: https://docs.vapi.ai/server-url/server-authentication — HIGH confidence
- Vercel Edge Runtime limits: https://vercel.com/docs/functions/runtimes/edge — HIGH confidence (2MB bundle, 25s response, V8 engine)
- Supabase JWT docs: https://supabase.com/docs/guides/auth/jwts — HIGH confidence

---
*Pitfalls research for: VoiceOps multi-tenant Vapi.ai operations platform*
*Researched: 2026-03-30*
