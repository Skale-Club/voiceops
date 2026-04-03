# VoiceOps

## What This Is

A multi-tenant SaaS platform that serves as the operational layer for agencies running voice AI assistants via Vapi.ai. Centralizes action execution (Tools), knowledge base (RAG), outbound campaigns, and call observability into a single admin panel — completely replacing n8n for scaling across multiple clients. The platform handles everything Vapi doesn't: mapping assistants to clients, executing business logic when tools are triggered, providing real-time call visibility, and managing outbound campaigns.

## Core Value

**The Action Engine must work.** When Vapi triggers a Tool during a live call, the platform receives the webhook, identifies the client, executes the business logic (create contact in CRM, check calendar, send SMS), and returns the result — all in under 500ms. If this works reliably, everything else is incremental.

## Requirements

### Validated

- ✓ Admin can create and manage organizations (tenants) — v1.0
- ✓ Admin can link Vapi assistant IDs to specific organizations — v1.0
- ✓ Admin can configure integration credentials per organization (GoHighLevel + 7 providers) — v1.0
- ✓ Admin can configure Tools with trigger-action logic per organization — v1.0
- ✓ Platform receives Vapi tool-call webhooks via Edge Functions and routes to correct organization — v1.0
- ✓ Platform executes GoHighLevel actions (create contact, check availability, book appointment) — v1.0
- ✓ Platform logs every tool execution with status, timing, request/response payloads — v1.0
- ✓ Platform receives end-of-call webhooks and stores transcripts, summaries, call metadata — v1.0
- ✓ Admin can view call list with filters (date, assistant, status, type, phone search) — v1.0
- ✓ Admin can view call detail with chat-format transcript and inline tool execution badges — v1.0
- ✓ Admin can view dashboard with aggregated metrics (total calls, tool success rate, recent calls, failure alerts) — v1.0
- ✓ Platform processes documents into vectorized chunks via OpenAI embeddings in pgvector — v1.0
- ✓ Platform serves knowledge base queries during calls via tenant-scoped semantic search — v1.0
- ✓ Admin can manage knowledge base documents (upload, delete, view status) — v1.0
- ✓ Admin can create outbound campaigns with CSV contact import — v1.0
- ✓ Platform dials contacts via Vapi Outbound API with cadence and real-time status — v1.0
- ✓ Multi-tenant data isolation via Supabase RLS on all tables — v1.0
- ✓ User authentication via Supabase Auth — v1.0
- ✓ Per-org API key management with AES-256-GCM encryption — v1.0

### Active

- [ ] Vapi webhook HMAC/secret validation on /api/vapi/* routes
- [ ] send_sms action type (Twilio executor)
- [ ] custom_webhook action type (configurable URL, method, headers, body)
- [ ] Campaign calls auto-appear in Observability call list
- [ ] Client-facing read-only panel (member role dashboard)
- [ ] Email alerts on tool execution failures or latency threshold

### Out of Scope

- Voice processing (STT/TTS) — handled by Vapi
- Assistant configuration (prompts, voice, model) — done in Vapi dashboard
- LLM conversation logic — handled by Vapi
- Payment/billing (Stripe) — monthly billing outside platform for MVP
- Mobile application — web-first, responsive
- OAuth/social login — email/password sufficient
- Multi-language UI — English only, bilingual PT/EN later
- Real-time call monitoring (live streaming) — high complexity, post-MVP
- White-label branding — post-MVP competitive feature

## Context

Shipped v1.0 MVP with ~44K LOC TypeScript across 231 files in 4 days.
Tech stack: Next.js 14 (App Router), Supabase (PostgreSQL + RLS + pgvector), Vercel, shadcn/ui.
Currently managing 1 client via Vapi with GoHighLevel as CRM.
Platform is ready to scale to 20+ clients — each as a tenant with isolated data.
All Vapi webhook routes are Edge Functions (no cold start, <500ms response).
6 database migrations, 8 integration providers supported, Deno Edge Function for async embeddings.

## Constraints

- **Tech Stack**: Next.js 14+ (App Router), TypeScript (strict), Supabase (PostgreSQL + RLS + pgvector), Vercel, shadcn/ui
- **Edge Functions**: All Vapi webhook routes MUST be Edge Functions — sub-500ms response
- **Multi-Tenancy**: Supabase RLS on all tables with `organization_id` — non-negotiable
- **Encryption**: Integration credentials encrypted with AES-256-GCM, never stored as plain text
- **No n8n**: Platform completely replaces n8n — no fallback, no hybrid mode
- **UI Simplicity**: Business owners, not developers — everything visual and intuitive
- **Commits in English**: Code and commits in English

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin panel first, client panel later | Agency validates before showing clients | ✓ Good — shipped faster |
| GoHighLevel as first integration | First client uses GHL — validates Action Engine | ✓ Good — real use case |
| Edge Functions for all Vapi routes | Latency sensitivity requires sub-500ms | ✓ Good — achieved target |
| Supabase RLS for multi-tenant isolation | Data isolation even with code bugs | ✓ Good — enforced on all tables |
| pgvector for RAG (not external vector DB) | Keeps stack simple, co-located | ✓ Good — works well |
| No Stripe/billing in MVP | Monetization outside platform initially | — Pending |
| getClaims() in middleware | Supabase deprecated getSession() | ✓ Good — current best practice |
| Belt-and-suspenders auth in layout | Protects against middleware bypass | ✓ Good — extra safety |
| Per-org API keys in DB (not env vars) | Enables multi-tenant key management | ✓ Good — Phase 6 delivered |
| OpenRouter as synthesis fallback | Saves per-org Anthropic key overhead | ✓ Good — flexible provider chain |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-03 after v1.0 milestone*
