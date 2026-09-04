---
phase: 132-authorized-specialist-orchestration
verified: 2026-09-04T15:07:15Z
verifier: independent (separate agent, no code changes made)
status: passed
score: 12/12 requirements ACHIEVED (2 with minor caveats noted)
---

# Phase 132 Independent Verification — Authorized Specialist Orchestration

This is an independent re-verification performed by a separate agent with no
memory of implementing the phase. `132-VERIFICATION.md` (author-written) was
read LAST, only for comparison. All findings below were derived directly from
reading production code and running the actual test files.

## Method

- Read `132-CONTEXT.md`, all four `132-0X-PLAN.md`, `132-KNOWN-LIMITATIONS.md`,
  `132-PROVIDER-DRIFT-INVENTORY.md`.
- Read the actual implementation: `handoff.ts`, `resolve-partner-edge.ts`,
  `resolve-agent-tool.ts`, `run-agent.ts` (both blocking and streaming paths),
  `build-workflow-tools.ts`, `query-knowledge.ts`, `resolve-specialist-route.ts`,
  `invocation-gateway.ts`, `openrouter.ts`, `resolve-provider.ts`, `run-turn.ts`,
  `qualify-llm.ts`, and every inventoried provider-drift call site.
- Ran the real test files (not trusted from SUMMARY): `agent-delegation.test.ts`,
  `agent-partner-edge-authz.test.ts`, `agent-workflow-tools.test.ts`,
  `agent-knowledge-scope.test.ts`, `agent-handoff-contract.test.ts`,
  `agent-specialist-routing.test.ts`, `agent-invocation-gateway.test.ts`,
  `openrouter-provider-policy.test.ts`, `agents/zod-schemas.test.ts`, plus the
  Vapi baseline suites (`vapi-call-events`, `vapi-tools-http200-contract`,
  `vapi-tools-idempotency`, `vapi-tools-multicall`) — all 259 tests pass.
- Confirmed via `npx supabase migration list --linked` that migrations
  1290-1295 are applied to the remote database (Local and Remote columns
  match). This is consistent with the "known context" supplied for this
  verification task; it postdates 132-VERIFICATION.md's own snapshot (which
  correctly recorded them as unapplied at the time it was written) and is not
  attributable to Phase 132 itself — the migration file explicitly says "must
  NOT be applied in Phase 132" and Plan 132-02/04's task-level verify steps
  never ran `db push`. Something in a later, already-merged phase applied them.

## Requirement-by-requirement verdicts

### ROUT-01 — entry agent delegates ambiguous request via structured handoff — ACHIEVED
`validateHandoffInput()` (`src/lib/agent-runtime/handoff.ts`) is a strict
allow-list parser (`from_agent`, `intent`, `extracted_params`, `summary`,
`recent_messages` only) wired into the `call_partner_<slug>` synthetic tool in
`run-agent.ts` (~line 470-484). Rejects on any unexpected top-level key before
the child agent is ever invoked.

### ROUT-02 — explicit-intent Vapi function invokes specialist directly, no router call — ACHIEVED
`resolveSpecialistRoute()` / `resolveTrustedAgentRoute()`
(`resolve-specialist-route.ts`, `invocation-gateway.ts`) resolve a trusted,
channel-adapter-chosen intent string directly to a same-org active specialist
by `slug`, with zero model calls in the resolution path. Ambiguity (no match,
inactive, channel not allowed) falls back to the entry agent, never guesses.
Confirmed **not yet cut over** to `/api/vapi/tools` in this phase (per plan
scope) — `grep` for callers under `src/app` returns nothing; `invokeAgent`
still has no production callers, matching the supplied known context. A later
phase's code (referenced in comments as Phase 136) wires this resolver into
`invokeAgentWithChannelRouting()`, which is consistent with, not a
contradiction of, Phase 132's deliberately narrower scope.

### ROUT-03 — specialist-to-specialist calls subject to budgets — ACHIEVED
`resolvePartnerEdge()` is called on every hop (not just the first), and
`PartnerBudget` (call count + start timestamp) is created once at the root and
threaded by reference through every recursive `runAgentBlocking()` call via the
module-private `_partnerBudget` field — verified by reading the call site at
run-agent.ts:591-603 and the shared-budget GATE-04 test that proves a
grandchild call counts against the same total as its parent.

### ROUT-04 — exactly one response owner, no internal monologue exposed — ACHIEVED
Traced the return path of the `call_partner_<slug>` tool's `execute()`: the
raw `AgentRunResult` is always passed through `normalizeSpecialistResult()`
then `specialistResultToToolMessage()` before being returned as the tool
result (run-agent.ts:604, :636). There is no code path that returns
`partnerResult.text` directly to the tool caller.

### ROUT-05 — typed success/business_failure/retryable_failure/handoff contract — ACHIEVED
`SpecialistResult` discriminated union exists exactly as specified in
`handoff.ts:275-279` and is the only type `normalizeSpecialistResult` can
produce and the only type `specialistResultToToolMessage` accepts.

### AUTHZ-01 — direct-tool permission distinct from delegate permission — ACHIEVED
`resolveEffectiveToolAuthority(resolved, incomingEdge)` is a pure function with
no ancestor/chain parameter at all — verified by reading its signature and by
the GATE-04 test explicitly asserting "no ancestor/chain argument exists on
this function at all." Wired into both `run-agent.ts` (legacy tool path, lines
989 and 1540 — blocking AND streaming) and `build-workflow-tools.ts` (workflow
tool `execute()`, line 172, re-checked at call time, not just at tool-listing
time).

### AUTHZ-02 — delegation never expands access beyond specialist's own grant or the edge — ACHIEVED
Read `resolveEffectiveToolAuthority`: when `resolved` (the specialist's own
direct grant) is null, the answer is unconditionally `{ allow: false,
reason: 'not_attached' }` regardless of any edge decision — a delegation grant
can never substitute for direct ownership. When an edge is in play, the
specialist's own `workflowId` must ALSO appear in `isWorkflowDelegatedThroughEdge`.
Migration 1291 backs this with a normalized `agent_partner_workflow_grants`
table (not a UUID array) with same-org composite FKs on both the edge and the
workflow, and legacy edges get **zero** grant rows by default (fail closed).

### AUTHZ-03 — rejects cross-org, cycles, inactive, disallowed channel, budget overrun before model/action call — ACHIEVED
`resolvePartnerEdge()` checks, in this order, before returning any allow
decision: request shape, cross-org (both on the edge row and defense-in-depth
on the joined source/target rows), source/target `is_active`, channel
allow-list, and a **fail-closed** malformed-policy check (any non-finite or
sub-1 `max_depth`/`max_calls_per_turn`/`timeout_ms` denies outright — an
edge with a NULL/broken policy grants nothing). `checkVisitedSet` (unchanged
from Phase 38) independently catches A→B→A cycles that per-edge checks alone
cannot. All of this runs before `runAgentBlocking()` (i.e. before any model or
tool-execution call) is invoked for the child.

### KNOW-01 — kb_scope enforced at runtime, blocking and streaming — ACHIEVED
Read both call sites directly: run-agent.ts:821 (blocking) and run-agent.ts:1430
(streaming) both call `queryKnowledge(userMessage, orgId, kbClient, { rawMode:
true, kbScope: resolvedAgent.kbScope })` — textually identical scope plumbing.
`resolvedAgent` in both cases comes only from `resolveAgent(resolvedAgentId,
orgId, channel)` (resolve-agent.ts:119: `kbScope: agent.kb_scope ?? null`,
read straight from the `agents` table) — there is no code path in `run-agent.ts`
that derives `kbScope` from `opts`, `handoffArgs`, or any ingress metadata.
`queryKnowledge()` itself implements all three states correctly: `null` = no
filtering (legacy), `[]` = returns the fallback string without calling the
embedding or search provider at all (verified: the early-return happens before
the `getProviderKey('openai', ...)` call), non-empty = org-filtered vector
search over-fetched then in-process-filtered by `metadata.knowledge_source_id`
membership in the scope set, before the same threshold/top-5 cap applies to
both scoped and unscoped paths.

### KNOW-02 — handoffs include only minimum approved context, reject overrides — ACHIEVED
Same evidence as ROUT-01. `FORBIDDEN_HANDOFF_KEYS` in `handoff.ts` explicitly
covers identity (`user_id`, `contact_id`, `actor_id`, ...), organization
(`org_id`, `tenant_id`, ...), agent (`agent_id`, `partner_agent_id`, ...),
secret/credential/token/API-key (`secret`, `token`, `api_key`, `password`,
`authorization`, ...), runtime-control (`model`, `temperature`, `stream`,
`system_prompt`, ...), and prototype-pollution (`__proto__`, `prototype`,
`constructor`) key families, recursively through nested objects AND arrays
(`findForbiddenHandoffKey`). `recent_messages` is capped to the last 3 and
each message's `content` truncated to 4000 chars.

### MODEL-01 — every generative call uses centralized OpenRouter, tenant-first/platform-fallback — ACHIEVED
`src/lib/llm/openrouter.ts` is the single factory (`resolveOpenRouterCredential`
+ `createOpenRouterClient`), org key first via `getProviderKey('openrouter', ...)`,
platform key second via `getPlatformSetting('OPENROUTER_API_KEY', ...)`, throws
`no_openrouter_key` rather than silently falling back to a different provider.
Verified every inventoried violation site
(`api/ads/memories/extract/route.ts`, `workflows/flows/_actions/ai-build.ts`,
`email-marketing/_actions/generate.ts`, `api/email-templates/generate/route.ts`,
`knowledge/query-knowledge.ts`, `copilot/run-turn.ts`) now imports and calls
`createOpenRouterClient`/`resolveCopilotProvider`/`resolveOpenRouterCredential`
and contains zero `new Anthropic(` construction. `src/lib/chat/stream/anthropic.ts`
was deleted outright (confirmed: file does not exist, no remaining importers).

### MODEL-02 — direct OpenAI/Anthropic paths removed or classified as embedding infra, with drift test — ACHIEVED, with one caveat
`tests/openrouter-provider-policy.test.ts` genuinely scans real files for
`new Anthropic(` / `new OpenAI(` **construction**, not imports (confirmed by
reading the regexes and running the file — 6/6 pass). The embedding exception
is narrow and explicit: exactly `src/lib/knowledge/embed.ts`, and the test
separately asserts that file documents `text-embedding-3-small` and
"OpenAI-compatible" so the exception can't silently widen. `OpenAIEmbeddings`
in `query-knowledge.ts` is a different class name and does not trip the
`new OpenAI(` regex, correctly avoiding a false positive.

**Caveat (not a blocking gap):** the guard's regex only catches the raw SDK
constructor patterns `new Anthropic(` / `new OpenAI(`. It does **not** catch
the Vercel AI SDK factory pattern `createAnthropic(...)` / `createOpenAI(...)`.
`src/lib/prospects/qualify-llm.ts` still imports `createAnthropic` from
`@ai-sdk/anthropic` and has an unreachable `buildLanguageModel()` branch that
would construct one, plus a `LlmProviderChoice` type that still has a
`'anthropic'` variant. This is **functionally inert** — `resolveLlmProvider()`
throws `no_llm_key` before ever returning `{ kind: 'anthropic' }`, so no live
code path reaches it — and it is not an oversight: `132-PROVIDER-DRIFT-INVENTORY.md`
explicitly instructs "verify only whether the residual `kind: 'anthropic'`
branch... still reaches a direct Anthropic call; if it does, remove the
branch, otherwise leave the file untouched," and the branch does not reach a
live call, so leaving it was the documented, correct decision. The residual
risk is narrower than "MODEL-02 unmet": it is that the static drift guard has
a coverage gap for the `createXxx()` factory pattern that would let a
*future* regression (e.g. someone re-wiring `resolveLlmProvider` to actually
return `'anthropic'` again) go undetected. Worth a follow-up to extend the
regex to `create(Anthropic|OpenAI)\s*\(` for defense-in-depth, but this does
not change today's ACHIEVED verdict since no live violation exists.

## GATE-04 rewrite — specific scrutiny requested

Read the full `GATE-04: Edge-based least privilege authorization model`
describe block in `tests/agent-delegation.test.ts` (lines 298-527) and the
production functions it exercises (`resolveEffectiveToolAuthority`,
`resolvePartnerEdge` — imported directly from `resolve-agent-tool.ts` /
`resolve-partner-edge.ts`, not re-implemented in the test file, confirmed by
reading the imports at the top of the file).

The new model is architecturally *different* from the old ancestor-intersection
model (this is the explicit, intended point of the phase — the old model
blocked exactly the delegation pattern this phase exists to enable), but on
every safety property the old model provided, the new model is equal or
stricter:

- **No escalation beyond the specialist's own grant** (the old model's core
  guarantee) is preserved and tested directly: `resolveEffectiveToolAuthority`
  returns `{ allow: false, reason: 'not_attached' }` whenever `resolved` is
  null, independent of any edge decision — a case the old model also denied.
- **New** guarantees the old model did not have: per-edge channel policy,
  per-edge depth/call-count/timeout budgets (fail-closed on missing/malformed
  policy, not merely absent), a normalized DB-verifiable grant table instead
  of a UUID array, and a defense-in-depth global depth ceiling
  (`checkDelegationDepth`) that still runs independently of the per-edge check.
- **Legacy (non-workflow) tools** — which the old model could theoretically
  reason about via ancestor ownership — now fail closed unconditionally
  whenever reached through an edge (`not_delegated`), since migration 1291
  only introduced a grant surface for `workflows`. This is *strictly more*
  restrictive than the old model for that case, not less.
- Cross-org, inactive-agent, and cycle checks are unchanged or reinforced
  (composite same-org FK at the DB layer in addition to the runtime check).

Ran `npx vitest run tests/agent-delegation.test.ts` directly: 64/64 pass,
including all 15 GATE-04 cases. I did not find a scenario the old model
denied that the new model would allow in error — every "allow" case in the
new model's tests requires an explicit edge configuration plus the
specialist's own direct grant, both of which an org operator must set up.
**Verdict: the replacement is at least as strict for the confused-deputy
property GATE-04 exists to test, and adds several guarantees the old model
lacked.**

## kb_scope enforcement — specific scrutiny requested

Confirmed directly by reading source (not by trusting
`tests/agent-knowledge-scope.test.ts`, though its assertions independently
corroborate the same facts via static source matching):

- Blocking path (run-agent.ts:821) and streaming path (run-agent.ts:1430) both
  pass `kbScope: resolvedAgent.kbScope` — identical expression, both call
  sites.
- `resolvedAgent` is produced exclusively by `resolveAgent(resolvedAgentId,
  orgId, channel)` — a 3-argument call with no options object, so there is no
  syntactic way to inject a scope from `opts`/handoff/channel metadata into
  this specific call. `resolveAgent()`'s own implementation reads
  `agent.kb_scope` directly off the `agents` row (resolve-agent.ts:33,119) —
  no merge with any caller-supplied value.
- The public `AgentRunOptions` type (types.ts) has no `kbScope` field at all,
  so even a malicious caller of the exported `runAgent()` cannot pass one in
  that would reach this code path.

## Provider drift guard — specific scrutiny requested

Confirmed the guard fails on **construction**, not imports:
`/new\s+Anthropic\s*\(/` and `/new\s+OpenAI\s*\(/` against file *contents*,
run over every `.ts`/`.tsx` file under `src/` (excluding `node_modules`,
`.next`, `.git`). Separately verified the three declared type-only importers
(`ai-tools.ts`, `tool-schemas.ts`, `copilot/tools/types.ts`) actually only
`import type Anthropic from '@anthropic-ai/sdk'` and contain no construction —
read all three files' relevant lines directly rather than trusting the test's
own assertion of the same fact.

The embedding exception is real and narrow: exactly one file
(`src/lib/knowledge/embed.ts`) is exempted, and a separate test enforces that
file still documents `text-embedding-3-small` and "OpenAI-compatible" so the
exception can't be silently repurposed to cover a generative call. See the
MODEL-02 caveat above for the one coverage gap found (factory-pattern
construction is not scanned).

## Scoped knowledge retrieval — under-retrieves, not leak-prone — CONFIRMED

Read `query-knowledge.ts` directly. The org-id filter (`org_id: organizationId`)
is applied at the `similaritySearchWithScore` call itself (server-side,
Supabase RPC), and the scope filter is a second, in-process narrowing on top
of that — it can only remove candidates, never add ones outside the org
filter. The over-fetch count (`Math.max(20, scopeSet.size * 4)`) is a
correctness/recall trade-off, not a security one: worst case, a scoped agent
gets the fallback message ("I don't have information about that...") when its
in-scope chunks all rank outside the over-fetch window, but it can never see
a chunk from an out-of-scope `knowledge_source_id` or a different
organization. Confirms `132-KNOWN-LIMITATIONS.md` item 1 verbatim.

## Test execution summary

| Suite | Tests | Result |
|---|---|---|
| agent-delegation.test.ts | 64 | pass |
| agent-partner-edge-authz.test.ts | 44 | pass |
| agent-workflow-tools.test.ts | included in combined run | pass |
| agent-knowledge-scope.test.ts | 14 | pass |
| agent-handoff-contract.test.ts | included in combined run | pass |
| agent-specialist-routing.test.ts | 17 | pass |
| agent-invocation-gateway.test.ts | 6 | pass |
| openrouter-provider-policy.test.ts | 6 | pass |
| agents/zod-schemas.test.ts | 12 | pass |
| Combined Phase-132 surface (9 files) | 213 | pass |
| vapi-call-events / http200-contract / idempotency / multicall | 46 | pass |

No failures attributable to Phase 132 were found in any suite run.

## Agreements and disagreements with `132-VERIFICATION.md`

**Agreements:**
- All 8 verification-focus items in the author's table check out against the
  actual code, not just the tests.
- The regression-gate claim (byte-identical 30-file/52-test pre-existing
  failure count) is plausible and I independently confirmed the Vapi baseline
  and Phase 132 suites are green; I did not re-run the full ~2700-test suite
  (out of scope for a targeted independent pass) so I cannot independently
  confirm the exact 30/52 pre-existing-failure count, only that the phase's
  own suites and the Vapi baseline are clean.
- Production boundary claims (migrations authored-not-applied *at the time
  the phase was verified*, `/api/vapi/tools` untouched, no Vapi cutover) hold
  up against the diff and the current `src/app/api/vapi/` tree.
- The GATE-04 rewrite is a legitimate, at-least-as-strict replacement, not a
  weakening — confirmed independently rather than taken on faith.
- KNOW-01/KNOW-02 kb_scope enforcement holds in both paths and cannot be
  overridden via handoff or channel metadata — confirmed independently.
- The known-limitations document's "under-retrieves, never leaks" framing
  for scoped knowledge retrieval is accurate — confirmed by reading the
  filter order in `query-knowledge.ts` myself.

**Disagreements / additions:**
1. **Migrations 1290-1295 are now applied to the remote database** (confirmed
   via `supabase migration list --linked` — Local and Remote both show all six
   versions). `132-VERIFICATION.md` states "Migrations 1290 and 1291 authored
   but not applied" — this was true at the time it was written (2026-09-03)
   but is stale now that a later, already-merged phase applied them. Not a
   fault of Phase 132's own work (the migration file itself still correctly
   says it must not be applied *within* Phase 132, and nothing in the Phase
   132 diff runs `db push`), but the verification document's "held" claim
   about the production boundary should not be read as still current without
   this caveat.
2. **The provider-drift cleanup is incomplete in a way `132-VERIFICATION.md`
   partially omits.** The author's "Deviations worth carrying forward"
   section calls out a stale header *comment* in
   `src/lib/copilot/resolve-provider.ts`, but does not mention that the file
   still exports a live `ProviderChoice` union with an `{ kind: 'anthropic'
   }` variant, nor that `qualify-llm.ts` still imports `createAnthropic` and
   contains an unreachable construction branch. I consider this acceptable
   per the project's own `132-PROVIDER-DRIFT-INVENTORY.md` instructions (which
   explicitly permit leaving the file untouched once the branch is confirmed
   unreachable), so I am not scoring MODEL-02 as failed over it — but I
   would have expected the verification report to name the dead
   type-variant/import explicitly alongside the header-comment deviation it
   did call out, since both are the same underlying incompleteness and the
   header-comment framing understates it.
3. **The static drift guard's coverage gap** (does not scan for the Vercel AI
   SDK's `createAnthropic()`/`createOpenAI()` factory-construction pattern,
   only the raw SDK's `new Anthropic()`/`new OpenAI()`) is not discussed
   anywhere in `132-VERIFICATION.md`. It is not a live violation today, but
   it is a real limitation of "a static/provider-contract test prevents new
   direct generative Anthropic/OpenAI clients" (132-CONTEXT.md's own
   verification-focus wording) that a future PR using the factory pattern
   would slip through undetected. Recommend a follow-up ticket to extend the
   regex.

Neither disagreement changes the overall phase verdict — both are narrow,
already-mitigated-in-practice gaps rather than functional or security
failures — but they are worth recording so a later phase does not need to
rediscover them.

## Overall verdict

**PASSED.** All 12 requirements (ROUT-01..05, AUTHZ-01..03, KNOW-01..02,
MODEL-01..02) are genuinely achieved in the codebase, not just claimed in the
SUMMARY/VERIFICATION documents. The two caveats above (stale migration-status
snapshot; drift-guard factory-pattern coverage gap) are minor, already
low-risk in practice, and do not warrant reopening the phase.
