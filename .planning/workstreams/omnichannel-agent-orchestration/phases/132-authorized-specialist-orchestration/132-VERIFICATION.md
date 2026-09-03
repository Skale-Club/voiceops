---
phase: 132-authorized-specialist-orchestration
status: verified
verified: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 132 Verification — Authorized Specialist Orchestration

## Goal restated

Turn the existing recursive partner-agent mechanism into a typed, tenant-safe,
least-privilege specialist graph shared by voice and text; let explicit intents select
a specialist without an extra router model call; route every Xphere-owned generative
call through OpenRouter.

## Commits

| Plan | Commit | Scope |
|------|--------|-------|
| 132-01 | `599118e9` | Typed handoff + specialist result contracts |
| 132-02 | `60690309` | Partner-edge policy schema (migration 1291) + fail-closed preflight |
| 132-03 | `07baabcf` | Edge-based least privilege + kb_scope enforcement |
| 132-04 | `5351f00c` | Trusted specialist routing + centralized OpenRouter access |
| docs | `cac188e3`, `5dc371f9` | Corrected drift inventory; accepted limitations |

## Verification focus from 132-CONTEXT.md

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | Cross-org edge insertion and invocation fail before model/action execution | PASS | Migration 1291 composite same-org FKs on both endpoints and on `agent_partner_workflow_grants`; `resolvePartnerEdge()` denies cross-org. `tests/agent-partner-edge-authz.test.ts`, GATE-04 case 4. |
| 2 | Direct tool denial holds even when a delegation edge grants the capability | PASS | `resolveEffectiveToolAuthority()` composes direct ∩ edge; a delegation grant never becomes a direct grant. GATE-04 case 1 (AUTHZ-02). |
| 3 | Delegated workflow succeeds only when specialist owns it AND the edge permits it | PASS | GATE-04 case 2 (owns but not delegated → deny) plus positive cases proving no ancestor ownership is required. |
| 4 | Cycle, inactive agent, channel, call count, depth, timeout deny before model/action execution | PASS | GATE-04 cases 5, 6, 7, 8, 10, 11, including a test proving the call budget is shared across a three-hop tree. |
| 5 | Handoff injection denied for nested objects and arrays, identity, instruction and secret keys | PASS | `tests/agent-handoff-contract.test.ts` — 41 tests covering root allow-list, deep object and array scanning, `__proto__`/`constructor`/`prototype`, and anchored-match false positives (`role_name`, `system_prompt_hint` stay allowed). |
| 6 | `kb_scope` enforced identically in blocking and streaming paths | PASS | `tests/agent-knowledge-scope.test.ts`; both `queryKnowledge()` call sites in `run-agent.ts` pass `resolvedAgent.kbScope`. `null` = full org, `[]` = no provider call, non-empty = filtered. See limitation 1 below. |
| 7 | Static contract test blocks new direct generative clients outside embedding exceptions | PASS | `tests/openrouter-provider-policy.test.ts` — asserts zero `new Anthropic(` under `src/`; every `new OpenAI(` is either `knowledge/embed.ts` or paired with an OpenRouter base URL; type-only importers explicitly confirmed as non-constructing. |
| 8 | Existing delegation, runtime, workflow-tool, gateway, Action Engine and Vapi suites stay green | PASS | Measured baseline comparison — see below. |

## Regression gate — measured, not inferred

Full suite at HEAD: **30 files / 52 tests failing**, 2664 passing.

The same 30 files were re-run in a throwaway worktree at the pre-phase baseline commit
`7c5b608e`: **30 files / 52 tests failing** — byte-identical failure count. Phase 132
introduced zero regressions.

Those 30 files fail for pre-existing, environment-shaped reasons unrelated to this
phase: unresolvable route/page module aliases (`accounts-actions`), undefined layout
metadata imports (`brand`), live-database dependencies (contacts, pipelines, RLS,
agent seed), and incomplete Supabase query-builder mocks (`zernio-process-event`
fails on `query.order is not a function` inside `src/lib/zernio/process-event.ts`,
a file this phase never touched, in a test that mocks `run-agent` away entirely).

Phase 132 suites, all green:

| Suite | Tests |
|-------|-------|
| agent-handoff-contract | 41 |
| agent-delegation | 50 |
| agent-partner-edge-authz | 44 |
| agent-workflow-tools | new, green |
| agent-knowledge-scope | new, green |
| agent-specialist-routing + agent-invocation-gateway | 23 |
| openrouter-provider-policy | 6 |
| Combined regression sweep | 205 passed, 0 failed |

Typecheck: `npx tsc --noEmit` reports zero errors under `src/`. The remaining `tests/`
errors about missing `expect`/`it` are pre-existing noise from invoking `tsc` directly,
since the build tsconfig does not include the test tree.

Production build: **PASS** — `npm run build` exit 0 with an 8 GB Node heap, including the `verify-sw` postbuild guard (`public/sw.js` generated, 85.4 KB).

## Production boundary — held

- Migrations 1290 and 1291 authored but **not applied**; `supabase migration list --linked`
  shows both as Local-only.
- `/api/vapi/tools` **not cut over**; `src/app/api/vapi/**` untouched across all four commits.
- No Vapi assistant bound or activated, no tenant agent data modified, no live booking executed.
- No Cuts & Culture configuration. Those gates remain in Phases 135-136.

## Accepted limitations

Recorded in `132-KNOWN-LIMITATIONS.md`: scoped knowledge retrieval filters in-process
and therefore under-retrieves rather than leaking; legacy non-workflow tools have no
per-edge grant surface and fail closed; internal recursion fields stay off the public
options contract.

## Deviations worth carrying forward

- `resolveTrustedAgentRoute()` was added as a wrapper rather than wired into
  `invokeAgent()`'s core path, because `agent-invocation-gateway.test.ts` asserts that
  `input.intent` never influences trusted identity. Trusted callers resolve the route
  first, then invoke. Phase 135 must respect that ordering when it cuts over Vapi.
- `src/lib/chat/stream/anthropic.ts` was deleted rather than migrated — it was fully
  orphaned dead code with zero non-self importers.
- `src/lib/copilot/resolve-provider.ts` still carries a stale header comment describing
  a four-step fallback whose Anthropic steps its own code no longer executes. Left
  untouched as out of scope; worth a one-line cleanup in a later phase.
