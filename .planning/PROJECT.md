# VoiceOps

## What This Is

A multi-tenant SaaS platform that serves as the operational layer for agencies running voice AI assistants via Vapi.ai. It centralizes action execution, knowledge base workflows, outbound campaigns, and call observability in one admin panel so agencies can scale beyond a single-client setup.

VoiceOps is not meant to encode one universal agency workflow. It is the shared integration and orchestration substrate that lets each client organization run its own operational flow on top of common primitives such as assistant mappings, provider credentials, tool execution, outbound calling, and observability.

## Core Value

**The Action Engine must work.** When Vapi triggers a tool during a live call, the platform must identify the tenant, execute the business logic, and return a result fast enough for production call flows.

That business logic may differ by client. The invariant is the reliability of the execution path, not that every tenant follows the same call pattern.

## Requirements

### Validated

- Admin can create and manage organizations (tenants) - v1.0
- Admin can link Vapi assistant IDs to specific organizations - v1.0
- Admin can configure integration credentials per organization (GoHighLevel + 7 providers) - v1.0
- Admin can configure tools with trigger-action logic per organization - v1.0
- Platform can serve as the orchestration layer for client-specific workflows built from shared tenant-aware primitives - v1.0
- Platform receives Vapi tool-call webhooks via Next.js route handlers and routes to the correct organization - v1.0
- Platform executes GoHighLevel actions (create contact, check availability, book appointment) - v1.0
- Platform logs every tool execution with status, timing, and request/response payloads - v1.0
- Platform receives end-of-call webhooks and stores transcripts, summaries, and call metadata - v1.0
- Admin can view call list with filters - v1.0
- Admin can view call detail with transcript and inline tool execution badges - v1.0
- Admin can view dashboard metrics and recent activity - v1.0
- Platform processes documents into vectorized chunks via OpenAI embeddings in pgvector - v1.0, upgraded to LangChain pipeline - v1.1
- Platform serves knowledge base queries during calls via tenant-scoped semantic search - v1.0, LangChain SupabaseVectorStore with org_id filter - v1.1
- Admin can manage knowledge base documents (files + URLs, 5 each per org, with status indicators) - v1.1
- Admin can create outbound campaigns with CSV contact import - v1.0
- Platform dials contacts via Vapi Outbound API with cadence and real-time status - v1.0
- Multi-tenant data isolation via Supabase RLS on all tables - v1.0
- User authentication via Supabase Auth - v1.0
- Per-org API key management with AES-256-GCM encryption - v1.0

### Active

- Vapi webhook HMAC/secret validation on `/api/vapi/*` routes
- `send_sms` action type (Twilio executor)
- `custom_webhook` action type (configurable URL, method, headers, body)
- Campaign calls auto-appear in Observability call list
- Client-facing read-only panel (member role dashboard)
- Email alerts on tool execution failures or latency threshold

### Out of Scope

- Voice processing (STT/TTS) - handled by Vapi
- Assistant configuration - handled in Vapi
- LLM conversation logic - handled by Vapi
- Payment and billing - outside MVP
- Mobile app
- OAuth/social login
- White-label branding

## Context

Shipped v1.0 MVP on 2026-04-03. Shipped v1.1 Knowledge Base on 2026-04-03.

- Tech stack: Next.js 15, Supabase, Vercel Hobby, shadcn/ui, LangChain
- Deployment split: Vercel Hobby for the app, Supabase for data/auth/background work, GitHub Actions for auxiliary cron
- Canonical production origin: `https://voiceops.skale.club`
- Vapi webhook routes now run in Node.js route handlers instead of depending on Vercel Edge Runtime
- Supabase Edge Functions remain the place for background processing such as embeddings
- Knowledge base uses LangChain `SupabaseVectorStore` — `documents` table with `content/metadata/embedding`, `match_documents` RPC, `knowledge_sources` for source tracking
- Product examples should be treated as tenant-specific workflows unless explicitly promoted to a reusable platform capability

## Constraints

- Tech stack: Next.js App Router, TypeScript strict mode, Supabase, Vercel Hobby, shadcn/ui
- Deployment: avoid depending on Vercel Edge Runtime or Vercel Cron for core product flows
- Multi-tenancy: Supabase RLS on all tenant tables is non-negotiable
- Encryption: integration credentials must remain encrypted with AES-256-GCM
- Vapi webhooks: always return HTTP 200 and stay fast
- No n8n fallback
- Do not overfit the product model around a single client playbook when the same outcome can be represented as tenant-specific configuration or orchestration
- First-party webhook construction must use `https://voiceops.skale.club` as the public base URL unless planning explicitly documents a different production host

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin panel first, client panel later | Agency validates value before exposing clients | Good |
| GoHighLevel as first integration | First real customer uses it | Good |
| Client workflows stay tenant-specific by default | Agencies need different operational automations even when they share the same platform | Current product framing |
| `voiceops.skale.club` is the canonical public origin | Prevents webhook drift across preview URLs, legacy relays, and ad hoc hostnames | Current deployment target |
| Node.js route handlers for Vapi routes on Vercel Hobby | Keeps the app compatible with the free Vercel plan without relying on Edge Runtime | Current deployment target |
| Auth enforced in layouts and route handlers | Avoids depending on Vercel middleware for session gating | Current deployment target |
| Supabase RLS for multi-tenant isolation | Protects data even when app code is wrong | Good |
| pgvector for RAG instead of external vector DB | Keeps the stack simple and co-located | Good |
| Per-org API keys in DB instead of env vars | Enables tenant-specific integrations | Good |
| LangChain as vector abstraction (v1.1) | Community-maintained, clean API for chunk/embed/search | Good |
| `metadata.org_id` for vector isolation (v1.1) | Follows LangChain SupabaseVectorStore conventions | Good |

## Evolution

Update this file whenever deployment assumptions, validated requirements, or core constraints change.

*Last updated: 2026-04-03 after v1.1 Knowledge Base milestone*
