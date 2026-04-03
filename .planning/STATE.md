---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: VoiceOps MVP
status: complete
last_updated: "2026-04-03T09:45:00Z"
last_activity: 2026-04-03
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 19
  completed_plans: 19
---

# VoiceOps — State

## Current Position

Phase: 5 (Outbound Campaigns) — COMPLETE ✓
Plan: 5 of 5
Status: ALL PHASES COMPLETE — v1.0 MVP shipped
Last activity: 2026-04-03

## Milestone

Version: v1.0
Name: VoiceOps MVP
Started: 2026-04-02
Completed: 2026-04-03

## Accumulated Context

- Project replaces n8n for managing Vapi.ai voice AI workflows across multiple clients
- Action Engine is the critical path — must respond to Vapi webhooks in <500ms
- GoHighLevel is the first integration priority (first client uses GHL)
- All /api/vapi/* routes must be Edge Functions — no cold starts
- Supabase RLS enforces multi-tenant data isolation at the database level
- 42 v1 requirements across 6 categories (TEN, AUTH, ACTN, OBS, KNOW, CAMP)
- 5 phases: Foundation → Action Engine → Observability → Knowledge Base → Outbound Campaigns
- Phase 4 (Knowledge Base) depends on Phase 2 (Action Engine) — knowledge executor runs through the Action Engine registry
- Phase 5 (Campaigns) depends on Phase 3 (Observability) — campaign call results surface via the call log pipeline

## Decisions

| Decision | Rationale |
|----------|-----------|
| Admin panel first, client panel later | Agency validates before showing clients |
| GoHighLevel as first integration | First client uses GHL — validates Action Engine with real use case |
| Edge Functions for all Vapi routes | Vapi latency sensitivity requires sub-500ms with no cold start |
| Supabase RLS for multi-tenant isolation | Data isolation even with code bugs |
| pgvector for RAG | Keeps stack simple, co-located with app data |
| No Stripe/billing in MVP | Monetization handled outside platform initially |
| TEN + AUTH in one foundation phase | RLS and auth are co-dependent — neither is safe to ship without the other |
| ACTN as a dedicated phase before OBS | You need tool executions before you can observe them — action_logs feeds the inline badges in Phase 3 |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY naming | New Supabase key naming (not ANON_KEY) since late 2025 — used consistently across all clients |
| getClaims() in middleware | Supabase deprecated getSession() in middleware — getClaims() is the current recommended approach |
| Database type deferred to Plan 01-03 | Wave 1 parallel execution — Supabase clients import Database type but 01-03 provides the actual type |
| Belt-and-suspenders auth guard in dashboard layout | Dashboard layout checks getUser() directly even though middleware enforces auth — protects against middleware bypass edge cases |
| SidebarTrigger in sidebar header (not inset) | Collapses naturally with sidebar on mobile |
| Error boundary at app root | Catches layout-level rendering errors across all routes |

- [Phase 01-foundation]: vitest node environment — integration tests target Supabase server clients, not browser DOM
- [Phase 01-foundation]: it.todo stubs allow test harness to exit 0 before any feature implementation exists
- [Phase 01-02]: Manual scaffold instead of create-next-app due to existing files in worktree directory
- [Phase 01-foundation]: createOrganization uses service-role client to bootstrap org + org_members atomically (RLS bootstrap gap — get_current_org_id() returns NULL before first org_members row)
- [Phase 01-foundation]: getClaims() returns `{ data: { claims } }` — middleware uses `claimsData?.claims` pattern (not direct destructure)
- [Phase 02-action-engine]: 37 total it.todo stubs across 4 files covering all ACTN-01 through ACTN-12 requirement IDs
- [Phase 02-action-engine]: Use dynamic import() in vitest tests (not require()) for ESM path alias compatibility with @/ prefix
- [Phase 02-action-engine]: status TEXT CHECK instead of ENUM for action_logs.status — avoids third enum for a simple 3-value domain
- [Phase 02-action-engine]: action_logs tool_config_id ON DELETE SET NULL — preserves audit history even when tool configs are reconfigured or deleted
- [Phase 02-action-engine]: ToolConfigWithIntegration type exported from resolve-tool.ts — gives webhook route a named type for the joined result
- [Phase 02-action-engine]: logAction uses try/catch to also catch synchronous errors from Supabase client construction, not just async rejection
- [Phase 02-action-engine]: AbortController timeout set to 400ms in ghlFetch — leaves 100ms margin within 500ms Vapi budget
- [Phase 02-action-engine]: API key never pre-filled in integration edit form (security requirement ACTN-04)
- [Phase 02-action-engine]: Textarea shadcn component added to ui/ to support fallback message field in tool-config-form
- [Phase 02-action-engine]: Cast getToolArguments() return to Json type for logAction payload — resolves TS2322 type mismatch between Record<string,unknown> and Json
- [Phase 03-observability]: calls.vapi_call_id is TEXT NOT NULL UNIQUE — joins with action_logs.vapi_call_id (both TEXT)
- [Phase 03-observability]: transcript_turns JSONB stores artifact.messages array (NOT flat transcript string)
- [Phase 03-observability]: duration_seconds GENERATED ALWAYS AS computed column — no manual calculation needed
- [Phase 03-observability]: POST /api/vapi/calls always returns 200 — end-of-call webhook has no latency constraint, written synchronously
- [Phase 03-observability]: buildTimeline is pure — no React/Next.js imports, fully unit-testable without mocking
- [Phase 03-observability]: Filter state for calls list lives entirely in URL searchParams — no client state
- [Phase 03-observability]: getDashboardMetrics runs 6 queries in Promise.all for minimum latency
- [Phase 03-observability]: toolSuccessRate null when no action_logs exist — shown as "No data" in UI
- [Phase 05-outbound-campaigns]: REPLICA IDENTITY FULL on campaign_contacts is critical for Supabase Realtime full row in payload.new
- [Phase 05-outbound-campaigns]: Individual POST /call per contact (not Vapi Campaign API) — metadata.campaign_contact_id roundtripped for webhook correlation
- [Phase 05-outbound-campaigns]: mapEndedReasonToStatus is a pure exported function — fully testable without mocking
- [Phase 05-outbound-campaigns]: importContacts uses service-role for bulk insert; 23505 unique_violation handled gracefully (not thrown)
- [Phase 05-outbound-campaigns]: CampaignStatus and CampaignContactStatus declared before Database interface (required for use inside interface)

## Blockers

(none)

## Todos

v1.0 MVP COMPLETE — all 5 phases, all 19 plans executed.

Next steps:
- Apply migrations 005_campaigns.sql to production Supabase instance
- Add VAPI_API_KEY to production environment
- Enable Supabase Realtime for campaign_contacts table in Supabase dashboard
- Human UAT: navigate /dashboard/outbound, create campaign, import CSV, start campaign, verify realtime updates

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 05 | 01 | ~8 min | 2 | 2 |
| 05 | 02 | ~6 min | 2 | 6 |
| 05 | 03 | ~10 min | 2 | 3 |
| 05 | 04 | ~8 min | 2 | 5 |
| 05 | 05 | ~12 min | 2 | 8 |
