---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: VoiceOps MVP
status: executing
last_updated: "2026-04-02T23:55:00.000Z"
last_activity: 2026-04-02
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 6
  completed_plans: 6
---

# VoiceOps — State

## Current Position

Phase: 1 (Foundation) — COMPLETE ✓
Plan: 6 of 6
Status: Phase verified — ready to plan Phase 2
Last activity: 2026-04-02 -- All 6 plans complete + verified (5/5 success criteria passed)

## Milestone

Version: v1.0
Name: VoiceOps MVP
Started: 2026-04-02

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

## Blockers

(none)

## Todos

(none)
