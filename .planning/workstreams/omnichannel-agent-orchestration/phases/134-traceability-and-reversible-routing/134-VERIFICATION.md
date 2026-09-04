---
phase: 134-traceability-and-reversible-routing
status: pending_build
verified: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Phase 134 Verification — Traceability and Reversible Routing

## Goal restated

Operators can follow one request across every orchestration and action boundary,
understand nested failures and costs, and move channels between legacy and specialist
routing without destroying configuration or history.

## Commits

| Plan | Commit | Scope |
|------|--------|-------|
| docs | `89fce2a8` | Context + three plans |
| 134-01 | `33dfc6c5` | Migration 1292: trace and invocation linkage on `workflow_runs` |
| 134-02 | `fbb95d0d` | Migration 1293: per-channel routing mode + fail-to-legacy resolver |
| 134-03 | `10dedba4` | Migration 1294: view fix; `partner_calls`, denial recording, redaction, join |

## Verification focus from 134-CONTEXT.md

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | One trace joins ingress, entry agent, nested specialists, workflow run, Action Engine | PASS | `execute-workflow-tool.ts` threads trace and invocation identity into `logToolRun`; `getInvocationDelegationTree()` joins `workflow_tool_logs` onto the tree. The test builds a two-node invocation tree plus a workflow-run row keyed to the child and asserts the run attaches to the child node specifically — it walks the join rather than asserting columns exist. |
| 2 | A nested specialist failure is reflected in the parent's status | PASS | `applyNestedFailurePenalty()` downgrades an otherwise-successful parent to `error` with `nested_specialist_failure`, distinguishing a genuine `retryable_failure` from a policy `business_failure`. |
| 3 | `partner_calls` populated with edges traversed, timing, outcome | PASS | Previously a dead column with zero writes anywhere in `agent-runtime`. Now written per attempt in two shapes: a denied entry (refused before recursion) and a completed entry (actually recursed, carrying `edge_id`, outcome, child invocation id and child status). |
| 4 | Every Phase 132/133 denial class recorded, distinguishable from an error | PASS | `delegation_cycle`, `delegation_depth_exceeded` (global ceiling and per-edge), all eight `PartnerEdgeDenialReason` values, `partner_budget_timeout`, and `channel_model_invocation_ceiling`, each carried as `denied: true` rather than stuffed into `error_detail`. Idempotency `conflict`/`abandoned` and direct-tool denials were already recorded in `tool_calls` with the same flag — verified unchanged rather than duplicated. |
| 5 | An idempotency replay is visible as a replay | PASS | Carried through the existing `tool_calls` denial/outcome recording from Phase 133 rather than duplicated into `partner_calls`. |
| 6 | No credential or unnecessary personal data reaches a persisted row | PASS | `redact.ts` applied inside `insertInvocationStart`/`updateInvocationEnd`, before any write, over `user_message`, `assistant_reply`, `tool_calls`, `partner_calls`, including nested structures. Key-based redaction on exact-match keys, plus patterns for `xph_` tokens, Bearer tokens, vendor `sk-`/`pk-` keys, JWTs, emails, and spaced card numbers. See the caveat below. |
| 7 | Channel switch is independent and rollback destroys nothing | PASS | The rollback test snapshots agents, mappings, workflows and invocation rows, flips `legacy → specialist → legacy`, then asserts the resolver only ever queried its own table and the snapshot is unchanged. Independence proved by seeding one channel and asserting the other stays legacy. |
| 8 | Defaults are safe | PASS | Migration 1293 inserts no rows; every organization resolves through absence. The resolver returns legacy on missing row, read error, unrecognised string, malformed value, and missing inputs — an unknown value is never read as "enable specialist". |
| 9 | Phase 131/132/133 suites stay green | PASS | 292/292 across the full keep-green list plus the new suites. |

## Regression gate

Full suite at HEAD: **30 failing files / 52 failing tests** — exactly the core baseline,
with **zero files beyond it**. This is the cleanest gate of the workstream so far; the
two flaky over-baseline members seen during Phase 133 did not recur in this run.

Typecheck: zero errors under `src/`.

Production build: PENDING — see status field.

## Caveats recorded rather than closed

- **Phone numbers are deliberately not redacted.** A loose-digit heuristic collided with
  dash-separated UUID trace and invocation ids, which would have corrupted the very
  identifiers this phase exists to make traceable. `callerNumber` is also arguably
  necessary data for a voice trace rather than the "unnecessary personal data" OBS-02
  excludes. This is a judgment call, not an oversight — revisit if a stricter data
  policy is required.
- **The Vapi tool webhook still logs `traceId: null`.** 134-01 deliberately did not
  reuse `call.id` as the trace id: a Vapi call id is stored as `TEXT` everywhere else in
  this codebase and is not guaranteed UUID-shaped (other callers put values like
  `manychat:<eventId>` in the same logical slot), while the new column is UUID-typed to
  match `agent_invocations.trace_id`. Forcing it risked silently dropping the whole log
  row on a latency-sensitive always-200 path. That route never creates an agent
  invocation, so it has no real trace to attach — the linkage that matters flows through
  `execute-workflow-tool.ts`, which 134-03 wired.

## Scope added during execution

Migration 1255's `workflow_tool_logs` view hardcoded `NULL::uuid` for
`agent_invocation_id` and `trace_id` on its `workflow_runs` branch. Those columns became
real in 134-01, so the view was actively discarding them and the entire linkage would
have stayed invisible on the read side that backs the Workflow logs page. Found while
reviewing 134-01's report and folded into 134-03 as migration 1294 before that plan ran.

## Deviations worth carrying forward

- 134-03 edited `build-workflow-tools.ts`, outside its listed scope: threading trace
  identity from the agent tool path is impossible without touching that call site.
- 134-03 widened one source-pattern assertion in `tests/agent-voice-latency-policy.test.ts`
  because the Phase 133 single-line `if (ceilingDenial) return ceilingDenial` is now a
  block that also records the denial. The ordering assertion — ceiling checked before the
  traversal is counted — is untouched.
- 134-01's `src/types/database.ts` edit was swept into 134-02's commit by concurrent
  staging. Content verified present and correct; only the attribution is off.
- The locked D-34-10/12/13 decision that a denied top-level invocation writes no row was
  preserved. Nested-specialist denials surface through the parent's `partner_calls`.

## Production boundary — held

- Migrations 1290, 1291, 1292, 1293 and 1294 are all authored and **unapplied**.
- The 134-02 routing-mode resolver is built and tested but **wired into nothing**. No
  route reads it yet.
- `/api/vapi/tools` is not cut over. No Vapi assistant bound, no tenant agent modified,
  no live booking executed.
