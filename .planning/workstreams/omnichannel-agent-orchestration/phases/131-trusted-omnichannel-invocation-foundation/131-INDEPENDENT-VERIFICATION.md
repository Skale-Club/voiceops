---
phase: 131-trusted-omnichannel-invocation-foundation
verified: 2026-09-04T11:15:00Z
verifier: independent (fresh read, no shared context with executor)
status: gaps_found (minor) — goal substantially achieved, one flaky-test finding, one stale-claim finding
score: 6/6 requirements achieved at code level; 1 quality caveat (TEST-01 flakiness)
---

# Phase 131: Independent Verification Report

**Phase Goal:** Establish a trusted, typed boundary through which voice and text can invoke the existing Xphere agent runtime; make `voice` a first-class channel; add a tenant-safe optional Vapi→entry-agent binding; restore a trustworthy Vapi/Action Engine regression baseline. Explicitly NOT: production cutover of Vapi traffic to the gateway.

## Requirement-by-Requirement Verdict

### AIGW-01 — one typed invocation boundary — **ACHIEVED**

`src/lib/agent-runtime/types.ts` defines `TrustedAgentRoute` (orgId, agentId, channel, externalInteractionId, conversationId?, sessionId?, traceId?, idempotencyKey?) and `AgentInvocationEnvelope` (route + untrusted `input` with userMessage/intent/locale/actor/metadata). `src/lib/agent-runtime/invocation-gateway.ts` exports `invokeAgent()`, which builds `AgentRunOptions` **only** from `envelope.route` and `envelope.input.userMessage`/history/mode/maxSteps/extraInstructions — `input.metadata`, `input.actor`, `input.locale`, `input.intent` are never spread into the options object passed to `runAgent`.

`tests/agent-invocation-gateway.test.ts` is a real test, not a placeholder: it mocks `runAgent`, invokes with attacker-controlled `metadata.organization_id` / `metadata.agent_id` / `metadata.orgId` / `metadata.agentId`, and asserts the mock was called with the trusted `orgId`/`agentId` and that the resulting options object has no `organization_id`/`agent_id`/`metadata`/`actor`/`locale`/`intent` properties at all. It also verifies UUID generation when trace/idempotency are omitted, pass-through when supplied, and that both `voice` and `web_widget` route through the identical function. Ran it standalone — 6/6 pass in <30ms after mocks.

### AIGW-02 — Vapi assistant → internal entry agent, no untrusted routing authority — **ACHIEVED**

Migration `1290_omnichannel_agent_invocation_foundation.sql` adds nullable `assistant_mappings.entry_agent_id uuid`, a `UNIQUE (organization_id, id)` constraint on `agents`, and a composite FK `assistant_mappings_entry_agent_same_org_fkey FOREIGN KEY (organization_id, entry_agent_id) REFERENCES public.agents(organization_id, id)` — this makes a cross-tenant binding structurally impossible, not just application-enforced. No backfill/INSERT/UPDATE against `assistant_mappings` in the migration (verified by reading the file and by the passing `tests/assistant-agent-binding.test.ts` text-contract assertions).

`src/lib/vapi/end-of-call.ts`'s `resolveOrgForCall()` now selects `organization_id, entry_agent_id` from the assistant-mapping row and returns `entryAgentId` only when the **assistant-mapping path** wins; every phone-number-only fallback path (Vapi-native number match, legacy per-number override) explicitly returns `entryAgentId: null`. Nothing in this function or the Vapi tools route reads `agentId`/`agent_id`/`organization_id` from call metadata or tool arguments — confirmed by reading the full function body.

### AIGW-03 — voice is first-class with channel-specific prompt/model/history/tool/latency/delegation policy — **ACHIEVED at the code level examined, with one scope caveat**

`voice` is in the Postgres `agent_channel` enum (migration 1290), `AgentChannel` union in `src/types/database.ts`, `PUBLIC_AGENT_CHANNELS`/`AGENT_CHANNEL_LABELS` in `src/lib/agents/channels.ts`, and `tests/agents/zod-schemas.test.ts` asserts a valid voice channel-override (prompt suffix/model/temperature/max_tokens/max_history — the existing `channel_overrides` mechanism, unchanged by this phase). Per-channel tool assignment already existed generically via `agent_tools.allowed_channels`, which now works for `voice` too since it is a member of `AGENT_CHANNELS`.

**Caveat:** `131-CONTEXT.md` itself is explicit that Phase 131 only *defines* the contract for voice-specific delegation and latency enforcement — actual enforcement is scoped to later phases ("routing/safety phases"). In the code as it exists in this fully-merged `main` branch, that enforcement is present (`checkChannelModelInvocationCeiling` / `invokeInternalSpecialist` in `invocation-gateway.ts`, explicitly commented as "Phase 133 (PERF-01)"), so the requirement reads as satisfied **today**, but that satisfaction is not attributable to Phase 131's own deliverable — it was delivered by Phase 133 code that has since landed on the same file. If you are scoring Phase 131 in isolation (e.g., at the commit boundary `0484b7d6`), latency/delegation enforcement for voice did not yet exist.

### AIGW-04 — web widget and Vapi share one specialist agent definition, no per-channel duplication — **ACHIEVED (capability), not yet exercised in production**

`invokeAgent()` is channel-agnostic — the `voice` and `web_widget` cases in `tests/agent-invocation-gateway.test.ts` are handled by the identical function with identical dispatch to `runAgent`. Underlying agent/prompt/tool storage was already channel-agnostic before this phase (one `agents` row + `channel_overrides`), so no new duplication was introduced. As documented in Known Context and reconfirmed here: `invokeAgent` has **zero** production callers. `rg "invokeAgent" src/app/api/vapi/tools/route.ts src/app/api/chat/[token]/route.ts` returns nothing. The widget route calls `runAgent` directly; `/api/vapi/tools` calls `executeAction` directly (bypassing agent invocation entirely for the legacy path). This is **consistent with the phase's explicit non-goal** ("no production route cutover occurs in Phase 131") — so it is not a defect relative to what Phase 131 promised, but it does mean AIGW-04's "no duplication" claim is proven only by test doubles, not by an actual shared request path yet.

### AUTHZ-04 — authenticated config stays RLS-scoped; Vapi webhook path stays privileged/explicit — **ACHIEVED**

No RLS policy for `assistant_mappings` or `agents` was touched — `supabase/migrations/001_foundation.sql` remains the only file defining `mappings_select/insert/update/delete` policies; migration 1290 contains zero `POLICY`/`RLS` statements (confirmed by reading the file in full). Vapi resolution continues to use the existing service-role/bootstrap `resolveOrgForCall` pattern with explicit same-tenant number-mismatch handling, now extended to also surface `entryAgentId` — this is additive, not a new trust path.

### TEST-01 — repaired baseline distinguishes real regressions from stale mocks/Redis — **ACHIEVED, with a flakiness caveat not disclosed in the SUMMARY/VERIFICATION**

Confirmed via direct testing:
- `tests/action-engine.test.ts` now mocks `@/lib/redis` and `@/lib/logger` at the top (hoisted `vi.mock`), and `tests/vapi-call-events.test.ts`'s fake chains support `maybeSingle`.
- All 5 focused files pass together on a warm run: 62/62, ~11–24s (matches the SUMMARY's claimed "62/62 in 11.22s" order of magnitude).

**However**, I found the create_contact/get_availability dispatcher tests sit right at the edge of the 10s per-test timeout for a reason unrelated to Redis: importing `@/lib/action-engine/execute-action.ts` cold (its ~60-module transitive import graph) reproducibly takes **~10.4–10.6 seconds** on first import in this environment (verified directly with a throwaway profiling test — second import of the same module in the same process is 2ms, i.e., fully cached). On an unloaded machine this stays just under 10s and the file passes cleanly; on a loaded machine (e.g., running all 5 focused files, or the full suite, concurrently) I reproduced actual timeouts and vitest's global `retry: 1` silently absorbing them — first attempt: `create_contact` 25243ms, `get_availability` 38411ms, both `Test timed out in 10000ms`, then passing on retry. This means the plan's own stated acceptance bar for this specific test — "completes inside the 10-second test timeout **with no Redis network log or retry**" — is not reliably met; it is not a Redis problem (Redis is correctly mocked and never logs), but it is a real, reproducible, environment-load-sensitive flake in exactly the file this phase's Task 2 was chartered to make deterministic. I did not find this caveat mentioned in `131-01-SUMMARY.md`, `131-03-SUMMARY.md`, or `131-VERIFICATION.md`.

This is not attributable to unrelated pre-existing suite failures (the Known Context's "~29-30 failing files for live-DB/module-resolution reasons") — it is inside a file this phase explicitly touched and whose flake risk this phase explicitly promised to eliminate.

## Anti-Pattern / Stub Scan

No stub/placeholder patterns found in the phase's modified files. `invokeAgent`, `resolveOrgForCall`, the migration, and the channel registry all contain real logic, not scaffolding. No blockers found.

## Data-Flow / Wiring Note (Level 4)

`invokeAgent` and `invokeAgentWithChannelRouting` are real and tested in isolation, but as of this phase (and still true in the fully-merged `main` used for this verification) they are not on any HTTP request path. This is by explicit design for Phase 131 ("no production route cutover"), not a hidden gap — flagging only so it's not mistaken for an oversight when read out of context.

## Requirements Coverage Table

| Requirement | Verdict | Evidence |
|---|---|---|
| AIGW-01 | ACHIEVED | `invocation-gateway.ts` + `agent-invocation-gateway.test.ts`, identity isolation proven with hostile metadata keys |
| AIGW-02 | ACHIEVED | Migration 1290 composite FK; `end-of-call.ts` returns `entryAgentId` only from trusted mapping path |
| AIGW-03 | ACHIEVED (scope caveat) | voice in enum/registry/schema; latency+delegation enforcement exists in current `main` but was delivered by Phase 133, not 131 |
| AIGW-04 | ACHIEVED (capability only) | Shared `invokeAgent` proven in tests; zero production callers, consistent with declared non-goal |
| AUTHZ-04 | ACHIEVED | No RLS touched; Vapi path stays privileged/explicit |
| TEST-01 | ACHIEVED (flakiness caveat) | Redis fully mocked and silent; but ~10.4s cold-import cost makes 2 specific tests genuinely timeout-and-retry under load, contradicting the plan's explicit "no retry" acceptance bar |

## Agreements and Disagreements with `131-VERIFICATION.md`

**Agree:**
- All 6 requirement PASS verdicts at the code/test level.
- No production route cutover occurred; `/api/vapi/tools` contains no `invokeAgent`.
- Migration 1290 contains no data mutation/backfill.
- RLS was not touched.
- The combined 5-file suite does pass 62/62 on a normal/warm run, matching their reported timing.

**Disagree / add nuance:**
1. **Migration-1290 application status is now stale, not wrong-at-the-time.** `131-VERIFICATION.md` states "Migration 1290 has not been applied to any database" (true as of 2026-09-03, per `.continue-here.md` from the same day). Per this task's Known Context and my own `npx supabase migration list --linked` check, migration 1290 (and 1291-1295) **are now applied to the linked/production database** — presumably applied later, during Phase 132+ work. Anyone reading `131-VERIFICATION.md` today without this note would draw a false conclusion about current DB state. Not a defect in the original verifier's work, but worth flagging since the file is a durable artifact that no longer matches reality.
2. **TEST-01's "no retry" claim needs qualification.** `131-VERIFICATION.md` and `131-01-SUMMARY.md` report clean, retry-free passes. I reproduced clean passes too on most runs, but also reproduced genuine `Test timed out in 10000ms` + automatic retry on the exact two dispatcher tests Task 2 targeted, when the machine was under concurrent test-file load. The root cause is cold-import cost of the ~60-module `execute-action.ts` graph, not Redis — Redis mocking itself is correctly implemented and verified silent. This is a real, reproducible flake risk the original verification does not mention.
3. **AIGW-03's "latency and delegation policies" should be attributed more precisely.** The original verification's evidence line for AIGW-03 lists only the channel-registry/schema pieces (correct), but the requirement text explicitly promises latency and delegation policy for voice — those are real in today's `main` only because Phase 133 code (`invokeInternalSpecialist`, `checkChannelModelInvocationCeiling`) has since landed in the same file. If AIGW-03 is being credited to Phase 131 specifically, that overstates Phase 131's own scope; `131-CONTEXT.md` itself defers this to later phases. This isn't a disagreement about current PASS/FAIL, just about attribution.

## Overall Verdict

**Phase 131's goal was substantially achieved.** The typed invocation envelope, the identity-isolation guarantee, the tenant-safe optional Vapi entry-agent binding, and the `voice` channel are all real, tested, and additive — no stubs, no shortcuts, no RLS or production-route regressions. The two items above are quality/documentation nuances (a stale "not applied" claim, and an undisclosed but reproducible test flake) rather than goal failures — I would not block this phase, but I would flag the TEST-01 flakiness for follow-up (e.g., raising the timeout for `tests/action-engine.test.ts` specifically, or lazy-importing the executor catalog) since it undermines the "distinguish regressions from flaky infra" purpose TEST-01 was chartered to deliver.
