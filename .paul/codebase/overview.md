# Operator — Codebase Overview

**Last updated:** 2026-04-03

## What It Is

Operator is a **multi-tenant AI voice automation platform** that lets businesses manage Vapi-powered AI phone assistants. Organizations can configure assistants, build knowledge bases, run outbound call campaigns, and integrate with CRMs like GoHighLevel — all through a Next.js 15 web dashboard.

## Core Value Proposition

- Inbound calls → AI assistant answers, uses tools (CRM lookup, appointment booking, knowledge Q&A)
- Outbound campaigns → bulk AI calls to contact lists at configurable pace
- Per-org isolation with encrypted credential storage and row-level security

## High-Level Architecture

```
Browser (React 19)
    ↕ Server Actions / API routes
Next.js 15 App (Vercel)
    ↕ Supabase (PostgreSQL + pgvector + Auth + Storage + Edge Functions)
    ↕ Vapi (voice calls + webhooks)
    ↕ GoHighLevel (CRM)
    ↕ OpenAI (embeddings) / Anthropic / OpenRouter (synthesis)
```

## Key Flows

| Flow | Entry Point | Key Files |
|------|------------|-----------|
| Vapi tool call (live call) | `POST /api/vapi/tools` | `src/app/api/vapi/tools/route.ts`, `src/lib/action-engine/` |
| End-of-call report | `POST /api/vapi/calls` | `src/app/api/vapi/calls/route.ts` |
| Outbound campaign | `POST /api/campaigns/[id]/start` | `src/lib/campaigns/engine.ts` |
| Knowledge base query | Inside action engine | `src/lib/knowledge/query-knowledge.ts` |
| Document upload + embed | `POST /api/knowledge/upload` | `src/actions/knowledge.ts`, `supabase/functions/process-embeddings/` |

## Technology At a Glance

| Concern | Choice |
|---------|--------|
| Framework | Next.js 15.5 (App Router) |
| Language | TypeScript 5 (strict) |
| Database | Supabase (PostgreSQL 15 + pgvector) |
| Auth | Supabase Auth |
| UI | React 19, Tailwind 4, shadcn/ui (Radix UI) |
| Voice | Vapi |
| CRM | GoHighLevel |
| AI | OpenAI (embed), Anthropic / OpenRouter (synthesis) |
| Testing | Vitest |
| Hosting | Vercel (implied) |

## Multi-Tenancy Model

Every data row is scoped to `organization_id`. RLS policies on all tables enforce this automatically via the `get_current_org_id()` helper function. Webhook routes use the service-role key and resolve org via `assistant_mappings`.
