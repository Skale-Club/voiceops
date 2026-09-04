---
phase: 134-traceability-and-reversible-routing
verified: 2026-09-04T00:00:00Z
verifier: independent (second-pass)
status: gaps_found
requirements_scope: [OBS-01, OBS-02, ROLL-02]
---

# Phase 134 — Independent Verification

## Method

Read `134-CONTEXT.md` and all three `134-0X-PLAN.md` files first. Then read the
actual production source (`run-agent.ts` in full, `invocations.ts`,
`redact.ts`, `routing-mode.ts`, `invocation-gateway.ts`, `execute-workflow-tool.ts`,
`build-workflow-tools.ts`, `observability.ts`, `log-tool-run.ts`, the dashboard
UI components that consume the read side, and migrations 1292-1295). Ran the
phase's own test suite plus the neighbouring regression suites named in the
plans (188 tests / 9 files, all green). Read `134-VERIFICATION.md` last, only
to diff against these independent findings.

## Verdict per requirement

### OBS-01 — trace joins ingress → entry agent → specialists → workflow run → Action Engine: **ACHIEVED at the data/backend layer, with an unrendered read-side gap**

Confirmed genuinely wired, not just present:

- `run-agent.ts` declares one `traceId` per turn and threads it into
  `buildWorkflowTools()` → `executeWorkflowTool()` → `logToolRun()` on **both**
  the blocking path (line ~1153) and the streaming path (line ~1647) — this is
  the same call site pattern the task asked me to check for asymmetry, and it
  is symmetric.
- Migration 1292 adds `workflow_runs.trace_id` / `agent_invocation_id`
  (nullable, composite same-org FK, `ON DELETE SET NULL`), migration 1294 fixes
  the `workflow_tool_logs` view that was previously hardcoding
  `NULL::uuid` for both columns on its `workflow_runs` branch (a real
  pre-existing "unreached" bug this phase found and closed, not one it
  introduced).
- `observability.ts`'s `attachWorkflowRuns()` does one extra `.in(...)` query
  over `workflow_tool_logs` keyed by `agent_invocation_id` and mutates each
  tree node's `workflowRuns`. `tests/invocation-partner-calls.test.ts` exercises
  this against a real two-node tree plus a workflow-run row and asserts
  attachment to the correct child node — a genuine join test, not a
  column-existence assertion.
- `/api/vapi/tools` deliberately passes `traceId: null` / `NO_AGENT_TRACE` —
  confirmed by reading the route: it calls `executeAction` directly and never
  creates an `agent_invocations` row, so there is no real trace to attach.
  This is a documented, reasoned scope boundary (matches the task's "known
  facts"), not a defect.

**Gap found (not in the phase's own report):** `getConversationDelegationTree()`
populates `InvocationTreeNode.workflowRuns`, but the only two UI consumers of
that tree — `src/components/conversations/delegation-tree.tsx` (used by both
`/conversations/[id]` and `InvocationDetailDrawer`) — never read
`node.workflowRuns` at all. `grep` for `workflowRuns` and `partner_calls` across
`src/app` and `src/components` returns zero UI matches. The join this plan
exists to make visible is provable in a test and in a direct query, but an
operator opening the actual dashboard today cannot see it — the tree only
renders agent name, status pill, latency, and cost. This is a second,
UI-layer instance of "built but never reached on a production path," distinct
from the ROLL-02 instance the task already flagged. It does not fail OBS-01
as literally worded in REQUIREMENTS.md (a data-model/join claim, which holds),
but it does undercut the phase's stated GOAL ("operators can follow one
request... in a test that walks the join rather than asserting the columns
exist" — true for the test, not yet true for the product).

### OBS-02 — partner_calls, denials, redaction: **ACHIEVED at the persistence layer**

Confirmed genuinely wired, matching the task's specific concerns:

- **partner_calls on both paths:** `partnerCallsLog` is declared once per
  `runAgent()` invocation and shared by reference into `buildPartnerTools()`.
  The blocking path's `finally` block (line 1279) and the streaming path's
  `after()` post-persist block (line 1805) **both** call `updateInvocationEnd`
  with `partnerCallsJson: partnerCallsLog`. Every denial branch inside
  `buildPartnerTools`'s `execute()` (cycle, depth ceiling, edge decision
  reason, partner-budget timeout, channel model-invocation ceiling) pushes a
  `buildDeniedPartnerCallEntry`, and the completed-traversal path pushes
  `buildCompletedPartnerCallEntry` with the child's own status/errorDetail —
  so a specialist-side denial is never swallowed. `applyNestedFailurePenalty`
  downgrades an otherwise-`success` parent to `error` only for a genuine
  `retryable_failure`, never for a mere `business_failure` denial — verified
  by reading and by the passing unit tests.
- **Redaction is centralized at the only writer.** `grep` across `src/` for
  every reader/writer of `agent_invocations` found exactly one write path:
  `insertInvocationStart` / `updateInvocationEnd` in `invocations.ts`. Every
  other file that touches `agent_invocations` is a `SELECT` (cron alerts,
  playground routes, guardrails cost sum, observability reads). Both write
  functions call `redactText`/`redactJson` unconditionally before every
  `.insert()`/`.update()`, so there is no code path that writes
  `user_message`, `assistant_reply`, `tool_calls`, or `partner_calls` without
  redaction — the concern the task specifically raised does not hold here.
  `redact.ts` itself is a real two-layer implementation (exact-match sensitive
  keys + regex patterns for `xph_` tokens, Bearer tokens, vendor `sk-`/`pk-`
  keys, JWTs, emails, spaced card numbers), deliberately omits a phone-number
  heuristic to avoid corrupting UUID trace/invocation ids (a defensible,
  documented trade-off, not an oversight).
- Idempotency replay/conflict/abandoned are recorded as `denied: true` entries
  in `tool_calls` (pre-existing Phase 133 mechanism, left alone rather than
  duplicated into `partner_calls`) — confirmed present in both the blocking
  and streaming tool loops.

**Same UI caveat as OBS-01** applies: `partner_calls` is written and
redacted correctly, but nothing in the dashboard renders it — an operator
cannot see denial reasons or delegation edges without querying
`agent_invocations` directly or opening a test.

### ROLL-02 — operators can switch a channel between legacy/specialist routing and roll back: **NOT ACHIEVED as an operator-visible capability (mechanism only)**

This matches the task's specific hypothesis exactly, and the phase's own
`134-VERIFICATION.md` already self-discloses it — no disagreement on the
underlying fact, but I independently re-derived and extend it:

- Migration 1293 creates `agent_channel_routing_modes` correctly: composite
  unique `(organization_id, channel)`, `CHECK (mode IN ('legacy','specialist'))`
  defaulting to `'legacy'`, RLS consistent with neighbouring agent tables, no
  backfill (absence of a row means legacy for every org/channel).
- `resolveChannelRoutingMode()` in `routing-mode.ts` is a correct, cheap,
  fail-closed resolver: returns `'legacy'` for a missing row, a read error, an
  unrecognised string, or malformed data — never infers `'specialist'`.
  Voice/text resolve independently (two independent rows). All confirmed by
  35 passing tests in `channel-routing-mode.test.ts`, including a rollback
  test that snapshots agents/mappings/workflows/invocations, flips
  legacy→specialist→legacy, and asserts byte-identical state.
- `invokeAgentWithChannelRouting()` in `invocation-gateway.ts` does consult
  `resolveChannelRoutingMode()` — but this wiring was added by a **later**
  commit (`a8e78e97 feat(136-01): consult the channel routing mode at the
  trusted boundary`), not by Phase 134. `git log -- invocation-gateway.ts`
  confirms `feat(131-03)` → `feat(132-04)` → `feat(133-02)` →
  `feat(136-01)`; Phase 134 touched none of this file.
- **Checked whether ANY production code calls `invokeAgent` or
  `invokeAgentWithChannelRouting`, as instructed:** `grep -rln
  "invokeAgentWithChannelRouting\|invokeAgent(" src --include=*.ts
  --include=*.tsx | grep -v test` returns only `invocation-gateway.ts` and
  `routing-mode.ts` (a comment) — **zero callers**. The widget route
  (`src/app/api/chat/[token]/route.ts`, `src/app/api/widget/playground/route.ts`)
  and the playground route call `runAgent()` directly; `/api/vapi/tools` calls
  `executeAction()` directly. This matches the task's stated known facts and
  extends them: even the Phase 136-01 wiring that supposedly "consults" the
  switch is itself dead code today — nothing invokes the function that
  invokes the resolver.
- **Additional gap beyond what the phase's own report states:** there is no
  operator-facing way to write to `agent_channel_routing_modes` at all —
  `grep -rln "agent_channel_routing_modes" src/app src/components` returns
  nothing. No settings page, no server action, no API route. Even if a
  production route eventually called `invokeAgentWithChannelRouting`, an
  operator today has no product surface to flip the switch; it would require
  a direct SQL write. `134-VERIFICATION.md` documents "wired into nothing" but
  does not mention this — it defers wiring to Phase 136, but the missing
  control surface hasn't been mentioned in either phase's material I read.

REQUIREMENTS.md marks ROLL-02 `[x]` "Done" after Phase 134. Read literally
("Operators can switch each channel... independently and roll back"), this is
not true yet on `main` at HEAD, including after the Phase 136-01 commit
already merged: no operator, and no code path reachable from any inbound
webhook or dashboard action, can currently produce a different routing
outcome by flipping this row. The mechanism is real, tested, and honestly
scoped in the phase's own plan (`134-02-PLAN.md`: "Build the resolver only —
do not wire it into any live route"), but graded against the phase GOAL text
rather than the plan's self-imposed scope, this is a mechanism, not a
capability.

## Overall verdict: PARTIAL

- OBS-01 and OBS-02: the backend/persistence work is solid, correctly wired
  on both the blocking and streaming `run-agent.ts` loops (the specific
  asymmetry the task asked me to hunt for does **not** exist here), and
  redaction is centralized at the single writer so no bypass is possible.
  Grade: ACHIEVED at the layer the requirements text actually describes, with
  a UI-surfacing gap flagged as a new finding.
- ROLL-02: mechanism-only, exactly as the task suspected and as the phase's
  own verification already (partially) admits. Grade: NOT ACHIEVED as an
  operator-visible capability, even measuring against the state of `main` at
  HEAD (which already includes the later Phase 136-01 wiring commit) — still
  zero production callers and zero operator control surface.

## Disagreements with `134-VERIFICATION.md`

1. **No disagreement on facts for ROLL-02** — the phase's own report already
   says "PASS as a mechanism — the switch is not yet read by anything" and
   adds an explicit "Scope note on ROLL-02" admitting the requirement is
   "satisfied at the mechanism level and inert at the behavior level." I
   independently re-derived the same conclusion from the code and git log
   before reading their report. My disagreement is with **REQUIREMENTS.md**
   marking ROLL-02 `[x]` Done, and with treating overall phase `status:
   verified` as sufficient without a louder caveat given the requirement's
   literal wording is about operator capability, not internal plumbing.
2. **New finding they did not report:** the dashboard UI
   (`delegation-tree.tsx`, used by both `/conversations/[id]` and
   `InvocationDetailDrawer`) never renders `workflowRuns` or `partner_calls`.
   Their verification focus table item #1 and #3 both grade PASS based on the
   join/write existing and being tested — accurate as far as it goes — but
   neither their report nor the phase's plans mention that the read side's
   new fields are invisible in the actual product today. This is the same
   class of defect the task asked me to hunt for, found in a place the task
   didn't specifically point at.
3. **Production build claim not independently verified.** Their report
   states `npm run build` passed with an 8 GB heap. Per task instructions I
   did not run the build; I have no basis to confirm or dispute this, and
   flag it only as unverified rather than disputed.
4. Everything else in their verification-focus table (nested-failure
   penalty, denial-class coverage, redaction coverage, safe defaults, channel
   independence, regression-suite green) I independently re-confirmed by
   reading the source and running the named test files directly — no
   disagreement.

## Evidence index

- `src/lib/agent-runtime/run-agent.ts` — partnerCallsLog declared line 890,
  threaded into `buildWorkflowTools`/`buildPartnerTools` in both the blocking
  loop (~1153-1188) and streaming loop (~1647-1679); `updateInvocationEnd`
  called with `partnerCallsJson` in both the blocking `finally` (line 1279)
  and the streaming `after()` block (line 1805).
- `src/lib/agent-runtime/invocations.ts` — sole writer of
  `user_message`/`assistant_reply`/`tool_calls`/`partner_calls`; both
  `redactText`/`redactJson` calls unconditional.
- `src/lib/agent-runtime/redact.ts` — two-layer redaction implementation.
- `src/lib/agent-runtime/routing-mode.ts`, `src/lib/agent-runtime/invocation-gateway.ts`
  — mechanism exists; zero production callers (`grep -rln
  "invokeAgentWithChannelRouting\|invokeAgent(" src | grep -v test`).
- `src/components/conversations/delegation-tree.tsx`,
  `src/components/agents/invocation-detail-drawer.tsx` — UI never reads
  `workflowRuns` or `partner_calls`.
- `supabase/migrations/1292-1295` — read and reasoned about; not applied by
  me (already applied to production per task's stated known facts).
- Test run: `npx vitest run tests/channel-routing-mode.test.ts
  tests/invocation-partner-calls.test.ts tests/invocation-redaction.test.ts
  tests/workflow-run-trace-linkage.test.ts tests/agent-delegation.test.ts
  tests/vapi-tools-http200-contract.test.ts tests/vapi-tools-idempotency.test.ts
  tests/vapi-tools-multicall.test.ts tests/agent-invocation-gateway.test.ts`
  → 9 files, 188 tests, all passed.
