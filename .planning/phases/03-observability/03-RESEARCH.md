# Phase 3: Observability - Research

**Researched:** 2026-04-02
**Domain:** Vapi end-of-call webhooks, call log UI, chat transcript rendering, dashboard metrics
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | Platform receives end-of-call webhooks from Vapi and stores call logs with transcript, summary, duration, status, cost, and timestamps | Vapi ServerMessageEndOfCallReport schema documented; calls table schema designed; Edge Function pattern matches existing /api/vapi/tools |
| OBS-02 | Admin can view a paginated call list with columns: date/time, duration, type (inbound/outbound), phone number, contact name, status | Server component + searchParams pagination pattern; TanStack Table already in use |
| OBS-03 | Admin can filter calls by date range, assistant, status, and call type | URL searchParams filter pattern; shadcn Popover + Select components; react-day-picker 9.x (already installed via shadcn Calendar) |
| OBS-04 | Admin can search calls by phone number or contact name | URL searchParams + ILIKE query; debounced input client component |
| OBS-05 | Admin can view call detail with chat-format transcript showing conversation turns | Normalized transcript_turns JSONB or separate table; artifact.messages array has role/message/secondsFromStart |
| OBS-06 | Call detail displays inline tool execution badges between transcript turns showing tool name, success/fail, execution time, and error | action_logs joined by vapi_call_id; interleave by secondsFromStart/created_at alignment |
| OBS-07 | Main dashboard displays total calls (today, week, month), tool success rate %, 10 most recent calls, and recent failure alerts | PostgreSQL date-range COUNT queries; server actions; no charting library needed for text metrics |
</phase_requirements>

---

## Summary

Phase 3 adds the observability layer on top of the already-built Action Engine. The two main deliverables are (1) a new Edge Function at `/api/vapi/calls` that ingests Vapi's `end-of-call-report` webhook and writes a `calls` table row, and (2) three admin UI pages: a paginated/filterable call list, a call detail page with chat-format transcript and inline tool badges, and a reworked dashboard home page with metrics.

The Vapi `end-of-call-report` payload is well-understood: it contains a `call` object (id, status, type, startedAt, endedAt, cost, assistantId, customer), an `artifact` object (transcript string, messages array with per-turn role/message/time/secondsFromStart), and an `analysis` object (summary, structuredData, successEvaluation). The `artifact.messages` array — a union of `UserMessage`, `BotMessage`, `ToolCallMessage`, and `ToolCallResultMessage` — is the ground truth for transcript storage. It should be stored as a normalized JSONB array in the `calls` table under a `transcript_turns` column rather than a raw string, enabling efficient rendering on the call detail page without post-processing.

The UI follows the existing project patterns exactly: server components read URL searchParams for filters, client components manage input state and push URL updates, TanStack Table renders the paginated list, shadcn Badge renders status and tool badges. No charting library is needed — the dashboard metrics are text cards with counts and percentages computed by PostgreSQL aggregate queries. Inline tool badge interleaving is a pure client-side rendering problem: sort artifact messages plus action_logs entries together by timestamp offset and render each appropriately typed item.

**Primary recommendation:** Store `transcript_turns` as JSONB (the raw `artifact.messages` array) — it is already structured, contains all timing data needed for interleaving, and avoids a separate join table.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js (App Router) | 15.5.14 (installed) | Pages, server components, route handlers | Already in use |
| Supabase JS | 2.101.1 (installed) | DB reads in server actions and service-role writes in webhook | Already in use |
| TanStack Table | 8.21.3 (installed) | Call list table (sorting, pagination columns) | Already in use — organizations-table.tsx is the pattern |
| shadcn/ui | (installed) | Badge, Table, Card, Skeleton, Sheet, Select, Popover, Input, Calendar | Already in use |
| date-fns | 4.1.0 (installed) | Date formatting, date math for "today/week/month" filter windows | Already in use |
| react-day-picker | 9.14.0 (installed as shadcn Calendar dep) | Calendar UI for date range filter popover | Already installed, just needs Calendar shadcn component added if absent |
| Zod | 3.25.76 (installed) | Validate Vapi end-of-call webhook schema | Already in use for tool-call schema |
| lucide-react | 1.7.0 (installed) | Icons (CheckCircle, XCircle, Clock, Phone, etc.) | Already in use |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-hook-form | 7.72.0 (installed) | Filter form state if needed | Only if filters become complex; URL searchParams may be sufficient without a form library |
| sonner | 2.0.7 (installed) | Toast notifications on actions | Already used; keep consistent |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONB transcript_turns column | Separate transcript_turns table | JSONB is simpler for a read-only transcript; separate table only worth it if you need to query individual turns with SQL indexes |
| URL searchParams for filter state | nuqs library | nuqs (2.8.9 available) adds type-safe URL state; worth it IF filter state grows complex; for 4 filter fields URL searchParams with manual parsing is sufficient |
| Text metric cards on dashboard | Recharts / Chart.js | No time-series data required in OBS-07; plain stat cards are simpler and load faster |

**Installation:** No new packages required. All dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── page.tsx                     # Dashboard — redirect to /dashboard/calls or show metrics
│   │   └── calls/
│   │       ├── page.tsx                 # Server component — reads searchParams, fetches calls
│   │       ├── [callId]/
│   │       │   └── page.tsx             # Server component — fetches call + action_logs
│   │       └── actions.ts               # Server actions — getCalls, getCall, getDashboardMetrics
│   └── api/
│       └── vapi/
│           └── calls/
│               └── route.ts             # Edge Function — receives end-of-call webhook
├── components/
│   └── calls/
│       ├── calls-table.tsx              # Client component — TanStack Table, same pattern as organizations-table.tsx
│       ├── calls-filters.tsx            # Client component — date range, assistant, status, type pickers + search
│       ├── call-transcript.tsx          # Client component — renders transcript turns + inline badges
│       ├── call-detail-header.tsx       # Server or client — metadata card (duration, cost, status)
│       └── dashboard-metrics.tsx        # Server component — stat cards for OBS-07
├── types/
│   └── vapi.ts                          # Extend with VapiEndOfCallMessageSchema
└── supabase/
    └── migrations/
        └── 003_observability.sql        # calls table + RLS
```

### Pattern 1: End-of-Call Webhook Edge Function

**What:** Edge Function at `POST /api/vapi/calls` mirrors the existing `/api/vapi/tools` pattern. Validates the payload with Zod, writes the `calls` row using service-role client. Uses `after()` for non-blocking DB write only if write latency is a concern — but unlike tool-call route, there is no <500ms constraint here; Vapi does not wait for a response from end-of-call webhooks.

**When to use:** Always — this is the only ingest path for call data.

**Important difference from /api/vapi/tools:** The end-of-call webhook does NOT require a response body within 500ms. Vapi fires it and does not wait. However, keep the route `export const runtime = 'edge'` for consistency and to avoid cold starts.

```typescript
// Source: https://docs.vapi.ai/server-url/events + existing /api/vapi/tools/route.ts pattern
export const runtime = 'edge'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    if (!body) return new Response(null, { status: 200 })

    const parsed = VapiEndOfCallMessageSchema.safeParse(body)
    if (!parsed.success || parsed.data.message.type !== 'end-of-call-report') {
      return new Response(null, { status: 200 })
    }

    const { call, artifact, analysis, startedAt, endedAt, cost } = parsed.data.message
    // Insert into calls table via service-role client
    // ...
    return new Response(null, { status: 200 })
  } catch {
    return new Response(null, { status: 200 })
  }
}
```

### Pattern 2: Vapi End-of-Call Zod Schema

**What:** Extend `src/types/vapi.ts` with a `VapiEndOfCallMessageSchema`. The Vapi SDK confirms these fields.

```typescript
// Source: https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/
// ServerMessageEndOfCallReport.ts, Artifact.ts, Call.ts, BotMessage.ts, UserMessage.ts

const ArtifactMessageSchema = z.object({
  role: z.string(),                    // 'user' | 'assistant' | 'tool' | 'tool_result' | 'system'
  message: z.string().optional(),      // text content for user/bot turns
  time: z.number().optional(),         // absolute timestamp ms
  endTime: z.number().optional(),
  secondsFromStart: z.number().optional(), // offset from call start — KEY for interleaving
  toolCalls: z.array(z.record(z.unknown())).optional(), // present on role='tool'
  result: z.string().optional(),       // present on role='tool_result'
}).passthrough()

export const VapiEndOfCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('end-of-call-report'),
    endedReason: z.string(),
    startedAt: z.string().optional(),   // ISO 8601 — on message root, not call object
    endedAt: z.string().optional(),
    cost: z.number().optional(),
    call: z.object({
      id: z.string(),
      assistantId: z.string().optional(),
      status: z.string().optional(),    // 'ended' typically
      type: z.string().optional(),      // 'inboundPhoneCall' | 'outboundPhoneCall' | 'webCall'
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      cost: z.number().optional(),
      customer: z.object({
        number: z.string().optional(),
        name: z.string().optional(),
      }).optional(),
    }).passthrough().optional(),
    artifact: z.object({
      transcript: z.string().optional(),         // flat text — store but don't rely on
      messages: z.array(ArtifactMessageSchema).optional(), // structured turns — primary
    }).passthrough().optional(),
    analysis: z.object({
      summary: z.string().optional(),
      successEvaluation: z.string().optional(),
      structuredData: z.record(z.unknown()).optional(),
    }).optional(),
  }),
})
```

**Note on field locations:** `startedAt`, `endedAt`, and `cost` appear BOTH at `message.call.*` AND directly at `message.*` (top-level). The TypeScript SDK confirms both locations. The `call.id` is the canonical `vapi_call_id` to join against `action_logs`. Use defensive access (`call?.id ?? call?.orgId`) and fall back gracefully.

### Pattern 3: Server Component Pagination with URL searchParams (Next.js 15)

**What:** In Next.js 15, `searchParams` is a Promise and must be awaited. Pass it from page to server-rendered table. Client Search/Filter components push URL updates with `useRouter` and `useSearchParams`.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/page
// calls/page.tsx — Server Component
export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page ?? '1')
  const from = params.from as string | undefined   // ISO date string
  const to = params.to as string | undefined
  const status = params.status as string | undefined
  const q = params.q as string | undefined         // phone or name search

  const { calls, total } = await getCalls({ page, from, to, status, q })
  return <CallsTable calls={calls} total={total} page={page} />
}
```

**Client filter component:** A `'use client'` component that reads `useSearchParams()`, builds a new URLSearchParams object on each filter change, and calls `router.replace('/dashboard/calls?' + params.toString())`. The table server component re-renders on navigation.

### Pattern 4: Inline Tool Badge Interleaving

**What:** Merge transcript turns (from `calls.transcript_turns` JSONB) with action_logs entries (fetched by `vapi_call_id`) into a single chronological array on the call detail page.

**Key insight:** `artifact.messages[n].secondsFromStart` is a number (seconds offset from call start). `action_logs.created_at` is an absolute timestamp. Both can be normalized to a seconds-from-start offset using `calls.started_at`:

```typescript
// Source: Vapi SDK types + action_logs schema (002_action_engine.sql)
type TranscriptItem =
  | { kind: 'turn'; role: string; message: string; offset: number }
  | { kind: 'tool'; toolName: string; status: 'success' | 'error' | 'timeout';
      executionMs: number; errorDetail: string | null; offset: number }

function buildTimeline(
  turns: ArtifactMessage[],
  actionLogs: ActionLog[],
  callStartedAt: string
): TranscriptItem[] {
  const startMs = new Date(callStartedAt).getTime()
  const turnItems = turns
    .filter(t => t.role === 'user' || t.role === 'assistant')
    .map(t => ({ kind: 'turn', role: t.role, message: t.message ?? '', offset: t.secondsFromStart ?? 0 }))
  const toolItems = actionLogs.map(log => ({
    kind: 'tool',
    toolName: log.tool_name,
    status: log.status,
    executionMs: log.execution_ms,
    errorDetail: log.error_detail,
    offset: (new Date(log.created_at).getTime() - startMs) / 1000,
  }))
  return [...turnItems, ...toolItems].sort((a, b) => a.offset - b.offset)
}
```

### Pattern 5: Dashboard Metrics SQL Queries

**What:** Pure SQL aggregate queries run in a server action, returning counts for OBS-07. No ORM needed beyond Supabase's `.rpc()` or raw `.from().select()`.

```sql
-- Calls today (Supabase JS: .gte('created_at', startOfDay).lte('created_at', now))
SELECT COUNT(*) FROM calls WHERE organization_id = $1
  AND created_at >= date_trunc('day', now())

-- Calls this week
SELECT COUNT(*) FROM calls WHERE organization_id = $1
  AND created_at >= date_trunc('week', now())

-- Calls this month
SELECT COUNT(*) FROM calls WHERE organization_id = $1
  AND created_at >= date_trunc('month', now())

-- Tool success rate (last 30 days)
SELECT
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0) AS success_rate
FROM action_logs WHERE organization_id = $1
  AND created_at >= now() - interval '30 days'

-- Recent 10 calls
SELECT * FROM calls WHERE organization_id = $1
  ORDER BY created_at DESC LIMIT 10

-- Recent failure alerts (last 24h errors)
SELECT * FROM action_logs WHERE organization_id = $1
  AND status IN ('error', 'timeout')
  AND created_at >= now() - interval '24 hours'
  ORDER BY created_at DESC LIMIT 20
```

These queries run from a server action using the authenticated Supabase server client (RLS scoped to org automatically).

### Anti-Patterns to Avoid

- **Storing transcript as flat string only:** `artifact.transcript` is a plain text string. It is NOT parseable back into turns with speaker labels. Always store `artifact.messages` as JSONB.
- **Using client-side state for filter persistence:** Filters must live in the URL so they survive navigation, are shareable, and work with server components.
- **Fetching all calls and paginating client-side:** The table must be server-paginated (LIMIT/OFFSET or cursor) — action_logs can be large.
- **Assuming action_logs.vapi_call_id is a UUID:** It is defined as `TEXT NOT NULL` — it holds Vapi's string call ID (e.g., `"call_abc123"`). Join on equality, not a UUID cast.
- **Using after() for end-of-call webhook:** Unlike the tool-call route, Vapi does not wait for a response on end-of-call webhooks. No need for after() — write synchronously and return 200.

---

## Database Schema (Migration 003)

The `calls` table is the central addition:

```sql
CREATE TABLE public.calls (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vapi_call_id      TEXT        NOT NULL UNIQUE,           -- Vapi's call ID — foreign key for action_logs
  assistant_id      TEXT,                                   -- Vapi assistant ID (for filtering by assistant)
  call_type         TEXT,                                   -- 'inboundPhoneCall' | 'outboundPhoneCall' | 'webCall'
  status            TEXT,                                   -- 'ended' | Vapi endedReason
  ended_reason      TEXT,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
  ) STORED,
  cost              NUMERIC(10,4),
  customer_number   TEXT,
  customer_name     TEXT,
  summary           TEXT,                                   -- analysis.summary
  transcript        TEXT,                                   -- artifact.transcript flat string (for search)
  transcript_turns  JSONB NOT NULL DEFAULT '[]',            -- artifact.messages structured array
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calls_org_id        ON public.calls(organization_id);
CREATE INDEX idx_calls_created       ON public.calls(created_at DESC);
CREATE INDEX idx_calls_vapi_call_id  ON public.calls(vapi_call_id);          -- join with action_logs
CREATE INDEX idx_calls_org_created   ON public.calls(organization_id, created_at DESC);
-- For phone/name search (ILIKE queries):
CREATE INDEX idx_calls_customer_number ON public.calls(customer_number);
CREATE INDEX idx_calls_customer_name   ON public.calls(lower(customer_name));
```

**RLS:** Same pattern as action_logs — SELECT for authenticated users via `get_current_org_id()`. INSERT only for service-role (webhook writes). No UPDATE or DELETE (append-only).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date range picker UI | Custom date inputs | shadcn Calendar + Popover (react-day-picker 9.x) | Already installed; handles locale, keyboard nav, ARIA |
| Table pagination | Custom prev/next component | TanStack Table pagination state + shadcn Button | Already used in organizations-table.tsx |
| Timestamp formatting | Custom format functions | date-fns `format`, `formatDistanceToNow`, `differenceInSeconds` | Already installed; handles edge cases |
| Duration seconds → "m:ss" | Custom formatter | `Math.floor(s/60) + ':' + String(s%60).padStart(2,'0')` — this one IS hand-roll, it's trivial | Too simple for a library |
| Transcript flat text search | pg_tsvector full-text search | PostgreSQL ILIKE on `customer_number` + `customer_name` columns | OBS-04 only requires phone/name search, not full transcript search; ILIKE is sufficient |

**Key insight:** No new dependencies are needed. All libraries are installed. The only new code is application logic.

---

## Common Pitfalls

### Pitfall 1: vapi_call_id field name collision
**What goes wrong:** `action_logs.vapi_call_id` is TEXT. The new `calls.vapi_call_id` must also be TEXT and UNIQUE. The join is `calls.vapi_call_id = action_logs.vapi_call_id`. If you name the column differently in `calls` (e.g., `id` or `call_id`), the join becomes confusing.
**Why it happens:** The existing schema uses `vapi_call_id` in action_logs — the new table must match.
**How to avoid:** Use `vapi_call_id TEXT UNIQUE NOT NULL` in the calls table, matching the action_logs column name exactly.
**Warning signs:** TypeScript errors joining the two tables, or null results when fetching action logs for a call.

### Pitfall 2: Transcript turns missing secondsFromStart
**What goes wrong:** Some Vapi message types (SystemMessage, ToolCallResultMessage) may not have `secondsFromStart`. The sort by offset breaks if undefined is treated as 0.
**Why it happens:** The Vapi SDK marks `secondsFromStart` as required on BotMessage and UserMessage but not all message types.
**How to avoid:** Filter to only `role === 'user' || role === 'assistant'` turns for display. Use `?? 0` fallback when sorting.
**Warning signs:** Tool badges appearing at the start of the transcript regardless of when they fired.

### Pitfall 3: end-of-call webhook fires before action_logs are written
**What goes wrong:** The call ends and the end-of-call webhook arrives at `/api/vapi/calls` before all `action_logs` rows for that call are committed (action logs are written via `after()` in the tool-call route).
**Why it happens:** The `after()` callback in `/api/vapi/tools/route.ts` runs asynchronously after the response. Vapi may fire end-of-call immediately after the last tool result. There can be a race condition.
**How to avoid:** The call detail page fetches `action_logs` on demand (not embedded in the `calls` row) — so even if action_logs arrive slightly after the call record, a page refresh shows complete data. Do NOT embed action_logs in the calls row at insert time.
**Warning signs:** Call detail page shows empty tool badges on first load but populated on refresh.

### Pitfall 4: cost field precision loss
**What goes wrong:** Vapi sends `cost` as a float (e.g., `0.0234`). PostgreSQL `NUMERIC(10,4)` rounds to 4 decimal places. If Vapi sends more precision, data is silently truncated.
**Why it happens:** Vapi's cost field is `number` in TypeScript (64-bit float, ~15 significant digits).
**How to avoid:** Use `NUMERIC(10,6)` for 6 decimal places, or store as TEXT and display as-is. `NUMERIC(10,4)` is likely sufficient since Vapi bills in USD cents.
**Warning signs:** Displayed cost slightly differs from Vapi dashboard total.

### Pitfall 5: Observability sidebar link is disabled
**What goes wrong:** `app-sidebar.tsx` has `active: false` on the Observability nav item (`/dashboard/calls`). After Phase 3, it must be set to `active: true`.
**Why it happens:** Pre-built placeholder from Phase 1.
**How to avoid:** Include sidebar update as an explicit task in the plan (last plan of the phase).
**Warning signs:** Admin cannot navigate to calls page from sidebar.

### Pitfall 6: Next.js 15 searchParams is async
**What goes wrong:** Accessing `searchParams.page` directly (sync) triggers a deprecation warning in Next.js 15 and will break in future versions.
**Why it happens:** Next.js 15 changed `searchParams` to be a Promise.
**How to avoid:** Always `const params = await searchParams` at the top of Server Component page functions.
**Warning signs:** Console warning "searchParams should be awaited before accessing its properties."

---

## Code Examples

### Calls Table Server Action (getCalls)

```typescript
// Source: Supabase JS docs + existing organizations actions pattern
// src/app/(dashboard)/calls/actions.ts
'use server'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20

export async function getCalls({
  page = 1, from, to, status, assistantId, callType, q,
}: {
  page?: number; from?: string; to?: string; status?: string;
  assistantId?: string; callType?: string; q?: string;
}) {
  const supabase = await createClient()
  let query = supabase
    .from('calls')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)
  if (status) query = query.eq('ended_reason', status)
  if (assistantId) query = query.eq('assistant_id', assistantId)
  if (callType) query = query.eq('call_type', callType)
  if (q) {
    // ILIKE search across phone and name — Supabase .or() for multi-column
    query = query.or(`customer_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
  }

  const { data, count, error } = await query
  if (error) throw error
  return { calls: data ?? [], total: count ?? 0 }
}
```

### Dashboard Metrics Server Action

```typescript
// Source: Supabase JS filter/count docs
export async function getDashboardMetrics() {
  const supabase = await createClient()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [todayRes, weekRes, monthRes, successRateRes, recentCalls, recentFailures] =
    await Promise.all([
      supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('action_logs').select('status').gte('created_at', monthStart),
      supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('action_logs').select('*').in('status', ['error', 'timeout'])
        .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }).limit(20),
    ])

  const logs = successRateRes.data ?? []
  const successRate = logs.length === 0 ? null
    : Math.round(logs.filter(l => l.status === 'success').length * 100 / logs.length)

  return {
    callsToday: todayRes.count ?? 0,
    callsWeek: weekRes.count ?? 0,
    callsMonth: monthRes.count ?? 0,
    toolSuccessRate: successRate,
    recentCalls: recentCalls.data ?? [],
    recentFailures: recentFailures.data ?? [],
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `searchParams` as sync prop | `searchParams` as `Promise<...>` — must await | Next.js 15 | Server component pages must `await searchParams` |
| `getSession()` in middleware | `getClaims()` — already addressed in Phase 1 | Supabase SSR deprecation | No new impact for Phase 3 |
| Separate transcript normalization service | Store `artifact.messages` directly as JSONB | Vapi SDK 2024+ | Messages array is already structured — no normalization needed |

**Deprecated/outdated:**
- Flat transcript string: `artifact.transcript` — present but unusable for turn-by-turn rendering; store JSONB messages instead.
- `x-vapi-secret` legacy header: Vapi now recommends HMAC or Bearer Token credential configuration. For MVP, checking a static secret in `process.env.VAPI_WEBHOOK_SECRET` against the header is acceptable.

---

## Open Questions

1. **Webhook authentication for end-of-call route**
   - What we know: `/api/vapi/tools` currently does no header-based authentication check (service-role key protects write access at DB level).
   - What's unclear: Whether the project requires HMAC signature verification for the end-of-call route, or if the same "no auth check, service-role DB write" approach is acceptable.
   - Recommendation: Match the existing tools route pattern — skip HMAC for MVP. Add a `VAPI_WEBHOOK_SECRET` env check if security is a concern (low complexity, add as optional task).

2. **Dashboard home page route**
   - What we know: `src/app/(dashboard)/page.tsx` currently `redirect('/dashboard/organizations')`.
   - What's unclear: Should the dashboard home become the metrics page, or should `/dashboard/calls` be the landing page and the home remain a redirect?
   - Recommendation: Make `/dashboard` redirect to `/dashboard/calls` after Phase 3, and add a `/dashboard/overview` page for OBS-07 metrics. Or: make `/dashboard/calls` the new default and embed a compact metrics banner at the top of the calls page.

3. **assistant_id filtering in calls list (OBS-03)**
   - What we know: `assistant_id` is a Vapi string stored in the `calls` table. The assistants page lists mappings from `assistant_mappings` table which has `vapi_assistant_id` and a human-readable `name`.
   - What's unclear: The filter UI should show assistant names, not raw UUIDs. This requires joining `calls.assistant_id` against `assistant_mappings.vapi_assistant_id` to get the name.
   - Recommendation: Server action fetches distinct `assistant_id` values from recent calls, then joins with `assistant_mappings` to build the filter dropdown.

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies — all required tools and services are already in use from Phases 1 and 2).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run tests/call-ingestion.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | Webhook parses end-of-call payload and inserts into calls table | unit | `npx vitest run tests/call-ingestion.test.ts` | Wave 0 |
| OBS-01 | Invalid/malformed webhook returns 200 without throwing | unit | `npx vitest run tests/call-ingestion.test.ts` | Wave 0 |
| OBS-02 | getCalls() returns paginated results with correct total count | unit | `npx vitest run tests/calls-actions.test.ts` | Wave 0 |
| OBS-03 | getCalls() filters correctly by date range, status, callType, assistantId | unit | `npx vitest run tests/calls-actions.test.ts` | Wave 0 |
| OBS-04 | getCalls() with q param filters by customer_number and customer_name ILIKE | unit | `npx vitest run tests/calls-actions.test.ts` | Wave 0 |
| OBS-05 | buildTimeline() merges turns and tool badges in order | unit | `npx vitest run tests/call-detail.test.ts` | Wave 0 |
| OBS-06 | buildTimeline() correctly offsets action_logs by call started_at | unit | `npx vitest run tests/call-detail.test.ts` | Wave 0 |
| OBS-07 | getDashboardMetrics() returns correct counts and success rate | unit | `npx vitest run tests/dashboard-metrics.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/[relevant-test-file].test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/call-ingestion.test.ts` — covers OBS-01 (Zod schema validation, webhook route logic)
- [ ] `tests/calls-actions.test.ts` — covers OBS-02, OBS-03, OBS-04 (server action query logic)
- [ ] `tests/call-detail.test.ts` — covers OBS-05, OBS-06 (buildTimeline utility function)
- [ ] `tests/dashboard-metrics.test.ts` — covers OBS-07 (metrics aggregation)

---

## Sources

### Primary (HIGH confidence)

- Vapi SDK TypeScript types (via GitHub raw): `ServerMessageEndOfCallReport.ts`, `Artifact.ts`, `Call.ts`, `BotMessage.ts`, `UserMessage.ts`, `ToolCallMessage.ts` — full field shapes
- Next.js 15 App Router docs — `searchParams` as Promise behavior confirmed
- Existing project codebase — `organizations-table.tsx`, `/api/vapi/tools/route.ts`, `vitest.config.ts`, `app-sidebar.tsx` — patterns confirmed by reading source

### Secondary (MEDIUM confidence)

- [Vapi Server Events docs](https://docs.vapi.ai/server-url/events) — end-of-call-report structure overview (artifact, call, analysis confirmed)
- [Vapi Call Analysis docs](https://docs.vapi.ai/assistants/call-analysis) — analysis.summary, analysis.structuredData confirmed
- [Next.js pagination docs](https://nextjs.org/learn/dashboard-app/adding-search-and-pagination) — server component + URL searchParams pagination pattern
- [Supabase JS filter docs](https://supabase.com/docs/reference/javascript/using-filters) — .gte, .lte, .or filter methods

### Tertiary (LOW confidence)

- Vapi community forum thread on [ServerMessageEndOfCallReport type mismatch](https://vapi.ai/community/m/1383826355195609241) — confirms fields like transcript/messages are present in payload but missing from some SDK types; LOW confidence as forum post, HIGH as confirmed by SDK source review
- [Vapi server authentication docs](https://docs.vapi.ai/server-url/server-authentication) — HMAC/Bearer auth options; verified as current approach but not tested in this project

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed and in use
- Architecture (webhook schema): HIGH — verified against Vapi SDK TypeScript source files
- Architecture (UI patterns): HIGH — directly mirrors existing project patterns
- Pitfalls: HIGH for items derived from existing code; MEDIUM for race condition pitfall (logical inference)
- SQL schema: HIGH — follows exact pattern of migration 002

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (Vapi API schema changes infrequently; Next.js 15 searchParams behavior is stable)
