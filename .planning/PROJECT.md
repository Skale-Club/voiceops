# VoiceOps

## What This Is

A multi-tenant SaaS platform that serves as the operational layer for agencies running voice AI assistants via Vapi.ai. It centralizes action execution (Tools), knowledge base (RAG), outbound campaigns, and call observability into a single panel — completely eliminating the dependency on n8n for scaling across multiple clients. The platform does NOT compete with Vapi; it handles everything Vapi doesn't: mapping assistants to clients, executing business logic when tools are triggered, providing real-time call visibility, and managing outbound campaigns.

## Core Value

**The Action Engine must work.** When Vapi triggers a Tool during a live call, the platform receives the webhook, identifies the client, executes the business logic (create contact in CRM, check calendar, send SMS), and returns the result — all in under 500ms. If this works reliably, everything else is incremental.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Admin can create and manage organizations (tenants) for each client company
- [ ] Admin can link Vapi assistant IDs to specific organizations (assistant mapping)
- [ ] Admin can configure integration credentials per organization (GoHighLevel, Twilio, Cal.com, custom webhook)
- [ ] Admin can configure Tools with trigger-action logic per organization (Action Engine)
- [ ] Platform receives Vapi tool-call webhooks via Edge Functions and routes to correct organization
- [ ] Platform executes business actions against configured integrations (create contact, check availability, book appointment, send SMS, query knowledge base, custom webhook)
- [ ] Platform logs every tool execution with status, timing, request/response payloads (action_logs)
- [ ] Platform receives end-of-call webhooks from Vapi and stores transcripts, summaries, and call metadata (call_logs)
- [ ] Admin can view call list with filters (date, assistant, status, type, phone number search)
- [ ] Admin can view call detail with chat-format transcript and inline tool execution badges (success/fail with timing)
- [ ] Admin can view main dashboard with aggregated metrics (total calls, tool success rate, recent calls, failure alerts)
- [ ] Platform processes uploaded documents (PDF, URL, text, CSV) into vectorized chunks via OpenAI embeddings stored in pgvector
- [ ] Platform serves knowledge base queries during calls via semantic search against tenant-scoped pgvector data
- [ ] Admin can manage knowledge base documents (upload, delete, view processing status)
- [ ] Admin can create outbound calling campaigns with contact lists imported via CSV
- [ ] Platform dials contacts via Vapi Outbound API with configurable cadence and real-time status tracking
- [ ] Platform supports multi-tenant data isolation via Supabase Row Level Security (RLS) on all tables
- [ ] User authentication via Supabase Auth (admin and client roles)

### Out of Scope

- Voice processing (STT/TTS) — handled by Vapi
- Assistant configuration (prompts, voice, model selection) — done in Vapi dashboard
- LLM conversation logic — handled by Vapi
- Payment/billing (Stripe) — monthly billing managed outside platform for MVP
- Client-facing panel (member role dashboard) — admin panel first, client views later
- Mobile application — web-first
- OAuth/social login — email/password sufficient for MVP
- In-app notifications — deferred to post-MVP
- Multi-language UI — English only for MVP, bilingual (PT/EN) later

## Context

- Currently managing 1 client via Vapi with n8n workflows. Scaling to 20+ clients with scattered webhooks, duplicated credentials, and duplicated n8n logic is unsustainable.
- The agency (us) is the admin/owner. Each served company is a tenant. End clients will eventually get a read-only panel showing their own logs, transcripts, and automation statuses.
- First client uses GoHighLevel as CRM — this integration is the highest priority.
- Vapi is extremely latency-sensitive on tool webhooks. All `/api/vapi/*` routes MUST be Edge Functions (no cold start). Heavy processing must respond immediately to Vapi and delegate asynchronously.
- The "n8n Lite" Action Engine is the heart of the platform — a simplified Trigger → Action configuration interface where the admin maps a Vapi tool name to a sequence of actions (create contact, check availability, send confirmation) against specific integrations.
- Observability (transcripts with inline tool badges) is the highest perceived value feature for proving the system works to clients.

## Constraints

- **Tech Stack**: Next.js 14+ (App Router), TypeScript (strict mode), Supabase (PostgreSQL + RLS + pgvector), Vercel hosting, shadcn/ui components — as specified in master prompt
- **Edge Functions**: All Vapi webhook routes MUST be Edge Functions — no exceptions. Sub-500ms response required
- **Multi-Tenancy**: Supabase RLS on all tables with `organization_id` — data isolation is non-negotiable
- **Encryption**: Integration credentials must be encrypted in the database, never stored as plain text in production
- **No n8n**: The platform completely replaces n8n. No fallback, no hybrid mode
- **UI Simplicity**: End clients are business owners, not developers. Everything visual and intuitive, no JSON, no code visible to clients
- **Commits in English**: Code and commits in English, future UI bilingual PT/EN
- **Timeline**: Faster is better — prioritize Action Engine + Observability working end-to-end over full feature coverage

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin panel first, client panel later | Agency needs to configure and validate before showing clients | — Pending |
| GoHighLevel as first integration | First client uses GHL — validates the Action Engine with real use case | — Pending |
| Edge Functions for all Vapi routes | Vapi latency sensitivity requires sub-500ms responses with no cold start | — Pending |
| Supabase RLS for multi-tenant isolation | Impossible for client A to see client B's data even with code bugs | — Pending |
| pgvector for RAG (not external vector DB) | Keeps stack simple, co-located with application data, Supabase-native | — Pending |
| No Stripe/billing in MVP | Monetization handled outside platform initially | — Pending |

## Current Milestone: v1.0 VoiceOps MVP

**Goal:** Build the complete operational layer for agencies running voice AI via Vapi.ai — Action Engine, Observability, Knowledge Base, and Campaigns in a multi-tenant admin panel.

**Target features:**
- Multi-Tenancy: org management, assistant mapping, RLS data isolation
- Authentication: Supabase Auth with admin/member roles
- Action Engine: Edge webhook → execute GoHighLevel actions → log (<500ms)
- Observability: call logs, chat-format transcripts, inline tool badges, dashboard
- Knowledge Base: document upload → vectorize (OpenAI + pgvector) → semantic search during calls
- Outbound Campaigns: CSV contact import, Vapi outbound dial, real-time per-contact status

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-02 — Milestone v1.0 started*
