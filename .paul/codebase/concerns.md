# Operator — Concerns & Technical Debt

**Last updated:** 2026-04-03

## Incomplete / Stubbed Features

These can be configured in the UI but will fail at runtime:

| Feature | Status | Risk | Location |
|---------|--------|------|----------|
| `send_sms` action | Throws "Unsupported" | User can create tool that silently fails | `src/lib/action-engine/execute-action.ts:40` |
| `custom_webhook` action | Throws "Unsupported" | Same | `src/lib/action-engine/execute-action.ts:41` |
| Twilio integration | No test endpoint | False sense of working setup | `src/app/(dashboard)/integrations/actions.ts:203` |
| Cal.com integration | No test endpoint | Same | Same file |

---

## Technical Debt

### Code Duplication

**Service-role Supabase client instantiated inline in 8+ files** (no factory function):
- `src/app/api/campaigns/[id]/start/route.ts:31-35`
- `src/app/api/campaigns/[id]/pause/route.ts:26-30`
- `src/app/api/campaigns/[id]/stop/route.ts:26-30`
- `src/app/api/vapi/calls/route.ts:33-37`
- `src/app/api/vapi/campaigns/route.ts:17-21`
- `src/app/api/vapi/tools/route.ts:43-47`
- `src/app/(dashboard)/outbound/actions.ts:153-157`
- `src/actions/knowledge.ts:118-122`

**Fix**: `src/lib/supabase/admin.ts` already exists — ensure all sites import from it consistently.

**Auth + org-id check duplicated in 3 campaign API routes**:
- `src/app/api/campaigns/[id]/start/route.ts:16-27`
- `src/app/api/campaigns/[id]/pause/route.ts:13-22`
- `src/app/api/campaigns/[id]/stop/route.ts:13-22`

**Fix**: Extract to a shared `requireCampaignAccess(request, campaignId)` helper.

### Unsafe Type Casting

```ts
// src/lib/action-engine/resolve-tool.ts:42
return data as unknown as ToolConfigWithIntegration  // bypasses type safety

// src/app/api/vapi/campaigns/route.ts:66, 73, 78
as Record<string, unknown>  // manual cast instead of Zod parse
```

### Error Suppression

```ts
// src/lib/supabase/server.ts:20-22 — empty catch block
// src/app/(dashboard)/integrations/actions.ts:97-102 — silent decrypt failure
// src/lib/integrations/get-provider-key.ts:26-30 — returns null on ANY error (can't distinguish missing vs corrupt)
```

### `@ts-ignore`
```ts
// src/app/api/vapi/campaigns/route.ts:84
// @ts-ignore — EdgeRuntime available in Edge Function context
```

Missing proper type definitions for Edge Runtime API.

---

## Performance Issues

### N+1 in Campaign List
- **File**: `src/app/(dashboard)/outbound/actions.ts:60-88`
- Fetches ALL campaigns then ALL contacts, filters in JS with `.filter(cc => cc.campaign_id === c.id)`
- O(n×m) — scales poorly
- **Fix**: Use Postgres aggregate or separate count query per campaign

### Dashboard Metrics (6 Sequential Queries)
- **File**: `src/app/(dashboard)/calls/actions.ts:77-91`
- Multiple range queries on `calls` table in `Promise.all()` without aggregation
- **Fix**: Single SQL query with conditional counting

### Decryption on Every Integration List Fetch
- **File**: `src/app/(dashboard)/integrations/actions.ts:95-114`
- Decrypts ALL integration keys to display the list, even though only masked values are shown
- **Fix**: Don't decrypt for display; mask directly from ciphertext or store separately

### No Caching of Decrypted Keys
- Each knowledge base query decrypts the OpenAI key fresh (~50ms)
- Already tight 300ms synthesis budget
- **Files**: `src/lib/integrations/get-provider-key.ts`, `src/lib/knowledge/query-knowledge.ts`

---

## Security Concerns

### Missing Org Validation in Dashboard Layout
- `src/app/(dashboard)/layout.tsx` checks user is authenticated but does NOT validate `org_members` membership
- Partially mitigated by per-action checks, but layout itself doesn't enforce
- **Risk**: Low (RLS handles data isolation), but defense-in-depth is lacking

### No Rate Limiting on Webhook Endpoints
- `src/app/api/vapi/*` — no rate limit checks
- **Risk**: Malicious webhook floods

### Weak Phone Validation
- `src/lib/campaigns/csv-parser.ts:28` — regex `^\+[1-9]\d{7,14}$` accepts invalid country codes like `+999999999999`

### Encryption Secret Validation Gap
- `src/lib/crypto.ts:8-12` — validates length (64 chars) but not valid hex format
- Invalid hex crashes on `parseInt()` at startup

### Vapi Error Response May Leak Details
- `src/lib/campaigns/outbound.ts:50` — error message includes raw Vapi response text
- Low risk but worth noting

---

## Missing Infrastructure

| Missing | Impact |
|---------|--------|
| Error tracking (Sentry/Datadog) | Production errors invisible; no alerting |
| Structured logging | `console.error` lost in production; can't debug |
| Health check endpoint | No `/health` route for load balancers |
| Metrics/observability | No call success rates, API latency, queue depth |
| Request correlation IDs | Can't trace request flow for debugging |
| Background job system | Embedding jobs are fire-and-forget with no retry/DLQ |

---

## Concurrency / Race Conditions

### Campaign Completion Race
- **Files**: `src/lib/campaigns/engine.ts:122-140` and `src/app/api/vapi/campaigns/route.ts:42-54`
- Two places check and update campaign completion; no atomic operation
- **Risk**: Usually idempotent due to unique constraints, but completion logic could be missed if both queries race

### Campaign Batch Trigger
- No scheduler — campaign batch only processes when `/start` is hit externally
- If caller doesn't retry, pending contacts never get called
- **Risk**: Stalled campaigns with no visibility

---

## Hardcoded Limits (Need Config)

| Limit | Value | File |
|-------|-------|------|
| Campaign batch hard cap | 10 calls | `src/lib/campaigns/engine.ts:45` |
| Max upload file size | 10 MB | `src/app/api/knowledge/upload/route.ts:12` |
| Knowledge match count | 5 chunks | `src/lib/knowledge/query-knowledge.ts:34` |
| Synthesis max tokens | 256 | `src/lib/knowledge/query-knowledge.ts:63` |
| GHL timeout | 400ms | `src/lib/ghl/client.ts` |

---

## Priority Summary

| Priority | Issue |
|----------|-------|
| 🔴 High | Stubbed `send_sms` / `custom_webhook` — users can configure but tools silently fail |
| 🔴 High | No error tracking — production failures invisible |
| 🟡 Medium | N+1 in campaign list — will degrade at scale |
| 🟡 Medium | Code duplication (service client, auth checks) — maintenance risk |
| 🟡 Medium | No retry for embedding jobs — data loss on transient failure |
| 🟢 Low | Type casting / `@ts-ignore` cleanup |
| 🟢 Low | Rate limiting on webhooks |
| 🟢 Low | Health check endpoint |
