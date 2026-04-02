# VoiceOps — State

## Current Position

Phase: Not started (defining roadmap)
Plan: —
Status: Defining requirements
Last activity: 2026-04-02 — Milestone v1.0 started

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

## Decisions

| Decision | Rationale |
|----------|-----------|
| Admin panel first, client panel later | Agency validates before showing clients |
| GoHighLevel as first integration | First client uses GHL — validates Action Engine with real use case |
| Edge Functions for all Vapi routes | Vapi latency sensitivity requires sub-500ms with no cold start |
| Supabase RLS for multi-tenant isolation | Data isolation even with code bugs |
| pgvector for RAG | Keeps stack simple, co-located with app data |
| No Stripe/billing in MVP | Monetization handled outside platform initially |

## Blockers

(none)

## Todos

(none)
