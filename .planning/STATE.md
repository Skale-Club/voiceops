# VoiceOps — State

## Current Position

Phase: Phase 1 — Foundation
Plan: —
Status: Ready to plan
Last activity: 2026-04-02 — Roadmap created, 5 phases defined, 42/42 requirements mapped

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

## Blockers

(none)

## Todos

(none)
