---
phase: 133-idempotent-action-and-vapi-safety
verified: 2026-09-04
verifier: independent (fresh read, not the executing agent)
status: gaps_found
---

# Phase 133 Independent Verification — Idempotent Action and Vapi Safety

This is a from-scratch re-verification, done without trusting `133-VERIFICATION.md`
(read last, only for comparison). Goal-backward: for each requirement, checked what
must be true, then read the actual source and ran the actual tests.

## Requirement verdicts

| Requirement | Verdict | Summary |
|---|---|---|
| SAFE-01 | **PARTIAL** | Ingress-scoped key + conflict/abandoned discrimination correctly built and wired at all three call sites that guard side-effecting actions (Vapi route, run-agent.ts, build-workflow-tools.ts). But `SIDE_EFFECTING_ACTIONS` covers only 9 action types; `tests/coverage-pins.test.ts` itself documents 24 real write action types (`create_task`, `send_email`, `pipeline_move_opportunity`, `manychat_*`, `send_whatsapp_*`, etc.) in `WRITES_PENDING_IDEMPOTENCY_REVIEW` — explicitly unguarded. The requirement's own text ("...and other side-effecting operations receive a stable idempotency key") is not true of those 24. |
| SAFE-02 | **ACHIEVED** | Xkedium booking mutations now in `SIDE_EFFECTING_ACTIONS` (post-correction). Vapi route wraps `executeAction()` with the ingress-scoped guard, keyed on `call.id`+`toolCall.id`, only when `requiresIdempotency()` is true. Replay returns cached result; conflict is distinct and never replays. Verified in source and by running `tests/vapi-tools-idempotency.test.ts` (all pass). |
| PERF-01 | **ACHIEVED, mechanism-only — flagged** | `channel-policy.ts` + `checkChannelModelInvocationCeiling` correctly wired into **both** `invokeInternalSpecialist()` (gateway) and `run-agent.ts`'s own partner-recursion loop (the gap the executing agent's own verification caught and fixed in `c31368fb`). However: **no production code path ever invokes `runAgent`/`invokeAgent` with `channel: 'voice'`.** The only production `channel:'voice'` value in the codebase is inside `vapi/tools/route.ts`'s idempotency-key derivation — an unrelated string used only for `deriveIngressIdempotencyKey`, not for `AgentChannel` routing. The real Vapi tool webhook calls `executeAction()` directly and never runs an agent at all. So today the ceiling is reachable only from `tests/agent-voice-latency-policy.test.ts` and the dashboard `/api/playground/[agentId]` tool (a developer testing surface, not live call traffic). This is consistent with the phase's explicit "no production Vapi cutover" boundary (deferred to Phase 135/136), so it is not a hidden defect the way the SAFE-02 gap was — but it is exactly the same *shape* of risk: a correct mechanism with zero live callers. |
| PERF-02 | **ACHIEVED** | `runtime = 'nodejs'` retained; every path (rejected secret, malformed JSON, schema failure, unresolvable org, unconfigured tool, executor throw, timeout, conflict, abandoned, outer catch) returns HTTP 200; logging deferred via `after()`; no non-canonical origin found in route source. `tests/vapi-tools-http200-contract.test.ts` (11 cases) all pass. |
| PERF-03 | **PARTIAL** | `recordAbandonedIdempotency()` is correctly wired into the Vapi route's timeout catch, before the fallback message returns (verified by test: "timeout on a side-effecting action still returns 200 AND records abandoned ownership before the fallback goes out"). But it is **never called** from `run-agent.ts`'s own `executeAction()` catch block (line ~1108: `catch (err) { result = 'Tool execution failed' ... }`, no abandoned-marker recording despite `idempotencyKey`/`idempotencyNeeded` being in scope) nor from `build-workflow-tools.ts`'s flow-dispatch path (no abandoned recording on a non-`ok` or thrown `executeWorkflowTool`). Grep confirms `recordAbandonedIdempotency` has exactly one production call site (the Vapi route). A side-effecting agent-driven tool call (web widget, playground) that times out mid-flight leaves no traceable-ownership marker — the same class of gap PERF-03 was written to close, just not closed everywhere idempotency-guarded execution happens. Lower blast radius than SAFE-02's Xkedule gap (invocation-scoped keys aren't retry-stable across a fresh HTTP request the way Vapi's ingress key is), but real and unaddressed. |
| OBS-03 | **ACHIEVED** | `toolCallList[0]` truncation replaced with `Promise.all` over every call; per-call try/catch isolates failures; each result carries its own `toolCallId`. `tests/vapi-tools-multicall.test.ts` (3 cases, including "one throwing call does not suppress the others") all pass. |

## Overall verdict: gaps_found

Mechanically the phase is well-built: every piece of machinery described in the plans
exists, is substantive, and is exercised by passing tests (144/144 across the phase's
own test files). The gaps are the same *category* as the one the executing agent's own
correction already found once in this phase (SAFE-02/Xkedule): **a correct mechanism
that isn't consulted on every path that needs it.**

Two new instances found, not previously documented:

1. **PERF-01 has zero production callers for `channel: 'voice'`.** This is disclosed
   as an intentional deferral in `133-CONTEXT.md` ("no production Vapi cutover... those
   gates remain in Phases 135-136"), so I do not treat it as a phase failure — but the
   REQUIREMENTS.md checkbox phrasing ("Voice uses a latency policy...") reads as an
   operating fact today, and it isn't one yet. Worth re-checking the instant Phase
   135/136 actually route real voice traffic through `invokeAgent`/`runAgent`.

2. **PERF-03's abandoned-ownership recording is Vapi-route-only.** `run-agent.ts` and
   `build-workflow-tools.ts` both derive idempotency keys and both have a `catch` around
   their side-effecting execution, but neither calls `recordAbandonedIdempotency()` on
   that catch. An agent-driven side-effecting tool call (not a raw Vapi webhook call)
   that times out leaves no abandoned marker. This was not flagged in the original
   `133-VERIFICATION.md`, which only exercised the Vapi route's own catch.

Also confirmed independently, matching the original verification:

- SAFE-01's 24-item `WRITES_PENDING_IDEMPOTENCY_REVIEW` bucket is real and current
  (grep + read of `tests/coverage-pins.test.ts`). I read this the same way the task
  brief suggested: the requirement text says "and other side-effecting operations,"
  and 24 real write action types are explicitly, deliberately still unguarded. That is
  a documented gap, not a hidden one, but it means SAFE-01 is PARTIAL, not fully
  achieved, under a literal reading of its own requirement text.
- `tests/coverage-pins.test.ts` fails to even collect in this environment
  (`Could not locate the PartnerEdgeDenialReason union in resolve-partner-edge.ts`).
  Root-caused: the regex in the test requires LF (`\n\n`) between the type union and
  the next `export type`, and this Windows checkout has CRLF line endings in
  `resolve-partner-edge.ts` (confirmed with `file` and a byte check). This is a
  Windows-checkout artifact, not a Phase 133 regression — that file belongs to Phase
  132 and was not touched by any of the three 133 plans. All 144 assertions in the
  other seven Phase-133-relevant test files passed cleanly in this same run.

## Disagreements with `133-VERIFICATION.md`

The existing document is unusually honest for a self-verification (it already contains
one appended correction for the SAFE-02 Xkedule gap, and an explicit "deviation" note
for a similar PERF-01 gap it caught before shipping — the `run-agent.ts` recursion loop
originally left ungated, fixed in `c31368fb`). I agree with everything it claims to have
verified. My disagreements are about what it did **not** check:

1. **It never re-derives whether PERF-01's mechanism has a live production caller.**
   Its own "Production boundary — held" section states the Vapi route "does not invoke
   the specialist graph" — which is the correct observation — but the verification
   table still marks focus item 6 ("Voice budget exhaustion returns a lean recoverable
   result") as a flat PASS without noting that this is currently untestable against
   real traffic because nothing routes real voice traffic through the mechanism yet.
   I'd downgrade this from an unqualified PASS to "PASS (mechanism only, unreachable in
   production today, disclosed as deferred)."

2. **It does not check `recordAbandonedIdempotency`'s call sites outside the Vapi
   route.** The verification's PERF-03 evidence is entirely about the Vapi route's
   catch block, which is correct as far as it goes, but the same requirement's plain
   text is broader than one route. I found the two other idempotency-guarded execution
   sites (`run-agent.ts`, `build-workflow-tools.ts`) still silently drop timeouts
   without recording abandonment — this is a gap of the identical shape to the one the
   document's own correction section calls out for SAFE-02, just not caught this time.

3. **Minor: SAFE-01's checkbox.** REQUIREMENTS.md marks SAFE-01 `[x]` Done. Given the
   24-item pending-review bucket is explicit and current, I'd mark this PARTIAL rather
   than Done, though I recognize the original verification and the requirement author
   likely intended "Done" to mean "the named operations (booking, rescheduling,
   cancellation, contact creation) are done, with the residual write types tracked,"
   which is a defensible but different reading than the literal requirement sentence.

No disagreement on SAFE-02, PERF-02, or OBS-03 — all three check out exactly as
described, against source and against passing tests.

## Evidence log

- `src/lib/agent-runtime/idempotency.ts` — ingress-scoped derivation, discriminated
  `IdempotencyOutcome`, `recordAbandonedIdempotency`, `SIDE_EFFECTING_ACTIONS` (9
  entries including the 3 Xkedule mutations).
- `src/app/api/vapi/tools/route.ts` — multi-call `Promise.all`, per-call idempotency
  guard gated by `requiresIdempotency()`, abandoned recording in the timeout catch,
  HTTP 200 on every path (read end-to-end).
- `src/lib/agent-runtime/channel-policy.ts`, `guardrails.ts` (`checkChannelModelInvocationCeiling`),
  `invocation-gateway.ts` (`invokeInternalSpecialist`, `buildSpecialistCeilingExhaustedResult`),
  `run-agent.ts` (partner recursion call site at the `checkChannelModelInvocationCeiling`
  invocation) — all read; ceiling wired at both call sites Phase 133 intended.
- `src/lib/agent-runtime/run-agent.ts` lines ~1026-1113 and ~1558-1600, and
  `src/lib/agent-runtime/build-workflow-tools.ts` lines ~186-275 — confirmed
  conflict/abandoned handling on read (replay/conflict), confirmed absence of
  `recordAbandonedIdempotency` on the execution catch (the PERF-03 gap above).
- `grep -rln recordAbandonedIdempotency src/ tests/` — exactly one production call site
  (`src/app/api/vapi/tools/route.ts`).
- `grep` across `src/app`, `src/lib/agent-runtime` for `channel: 'voice'` / `AgentChannel`
  usage — no production `runAgent`/`invokeAgent` caller ever sets `channel: 'voice'`.
- Ran: `npx vitest run tests/idempotency-ingress-key.test.ts
  tests/agent-voice-latency-policy.test.ts tests/vapi-tools-idempotency.test.ts
  tests/vapi-tools-multicall.test.ts tests/vapi-tools-http200-contract.test.ts
  tests/coverage-pins.test.ts tests/agent-delegation.test.ts
  tests/agent-invocation-gateway.test.ts` → 144 passed, 1 suite (`coverage-pins.test.ts`)
  failed to collect due to a CRLF-vs-LF regex mismatch in a Phase-132 file untouched by
  this phase (Windows checkout artifact, not a regression).
- `tests/coverage-pins.test.ts` source read directly (lines 128-230) for the
  `WRITES_PENDING_IDEMPOTENCY_REVIEW` set and the exhaustiveness assertions around it.

---

_Verified: 2026-09-04_
_Verifier: independent re-verification, not the phase-executing agent_
