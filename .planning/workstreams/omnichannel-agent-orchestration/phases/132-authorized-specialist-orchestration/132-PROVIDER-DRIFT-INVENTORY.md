---
phase: 132-authorized-specialist-orchestration
type: reference
created: 2026-09-03
supersedes: the provider inventory in 132-CONTEXT.md and 132-04-PLAN.md files_modified
---

# Phase 132 — Verified Generative Provider Drift Inventory

The inventory drafted during planning was written from memory and is inaccurate in
both directions: it lists two files that are **not** violations and misses two files
that **are**. This document is the verified list, produced by grepping for actual
client construction (`new Anthropic(`, `new OpenAI(`) rather than for imports.
Plan 132-04 Task 2 must use this list.

## Violations — must migrate to the OpenRouter resolver

| # | Site | Line | Problem |
|---|------|------|---------|
| 1 | `src/app/api/ads/memories/extract/route.ts` | 56 | `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` — hardcoded platform env, no tenant provider resolution at all. Worst case in the set. |
| 2 | `src/app/(dashboard)/workflows/flows/_actions/ai-build.ts` | 127 | `new Anthropic({ apiKey })` — direct, unconditional. The file also has a correct OpenRouter path at line 61, so it is a mixed/fallback drift. |
| 3 | `src/app/(dashboard)/email-marketing/_actions/generate.ts` | 19-21 | `new Anthropic` with the OpenRouter `baseURL` applied only when `provider.kind === 'openrouter'` — falls back to direct Anthropic otherwise. |
| 4 | `src/app/api/email-templates/generate/route.ts` | 171-173 | Same conditional-baseURL pattern as #3. |
| 5 | `src/lib/knowledge/query-knowledge.ts` | 122 | `new Anthropic({ apiKey: provider.apiKey })` as the fallback branch of the synthesis path (the OpenRouter branch at 109-112 is already correct). |
| 6 | `src/lib/chat/stream/anthropic.ts` | 25 | `new Anthropic({ apiKey: p.apiKey })`. **Missing from `132-04-PLAN.md` `files_modified`** — named in 132-CONTEXT.md but never scheduled for migration. |
| 7 | `src/lib/copilot/run-turn.ts` | 353 | `new Anthropic({ apiKey: args.provider.apiKey })`. **Missing from both the plan and the context.** The file's line 243 OpenRouter path is already correct, so this is the fallback branch. |

## Not violations — do not modify

| Site | Why |
|------|-----|
| `src/lib/knowledge/embed.ts` (24, 39) | Embedding infrastructure. OpenAI-compatible client with an optional `baseURL` that already supports OpenRouter. Changing the embedding model would require a full reindex — explicitly out of scope per 132-CONTEXT.md. Document as the sanctioned exception in the drift-guard test. |
| `src/lib/prospects/qualify-llm.ts` | Already tenant-OpenRouter-first / platform-OpenRouter-second via `@openrouter/ai-sdk-provider` (lines 101-105, 119-121). It was wrongly listed as drift. **Verify only** whether the residual `kind: 'anthropic'` branch of `LlmProviderChoice` (line 95) still reaches a direct Anthropic call; if it does, remove the branch, otherwise leave the file untouched. |
| `src/lib/flows/ai-tools.ts` | Type-only import. No client construction. |
| `src/lib/chat/stream/tool-schemas.ts` | Type-only import. No client construction. |
| `src/lib/copilot/tools/types.ts` | Type-only import. No client construction. |

## Consequence for the drift-guard test

The static contract test in 132-04 Task 2 must allow SDK *imports* (types are used
widely) and fail only on generative **client construction** outside the documented
exception list — otherwise it will produce false positives on the three type-only
files above. The OpenAI SDK remains permitted as transport when paired with the
OpenRouter base URL.
