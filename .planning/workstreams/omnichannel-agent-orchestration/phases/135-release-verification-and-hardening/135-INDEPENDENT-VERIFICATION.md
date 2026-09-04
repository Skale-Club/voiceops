---
phase: 135-release-verification-and-hardening
verified: 2026-09-04
verifier: independent (adversarial)
status: passed_with_findings
requirements: [TEST-02, TEST-03, TEST-04]
---

# Phase 135 Independent Verification — Release Verification and Hardening

## Method

Read `135-CONTEXT.md` and all three `135-0X-PLAN.md` files first, then verified the
actual codebase adversarially: ran the real test files, deliberately broke a pinned
safety set and confirmed the gate exits non-zero, restored it and confirmed a clean
tree, inspected the CI workflow for escape hatches, and cross-checked the CRLF fix
commit `e7fd07e5`. Read `135-VERIFICATION.md` (author's own report) last, only to
diff against these findings.

## Verdict per requirement

### TEST-02 (tenant isolation, delegated authz, cross-agent calls, cycle/depth
limits, handoff injection resistance, OpenRouter-only generation, Xkedule
idempotency) — **SATISFIED**

- `scripts/release-gate.ts` declares `GATE_MEMBERS` as data (9 files), each tagged
  with the `Test02Area`(s) it proves. `tests/release-gate.test.ts` asserts every
  member file exists on disk and every one of the seven `TEST02_AREAS` maps to at
  least one member — deleting a suite or an area tag fails this test, not just
  shrinks coverage silently.
- Read what each member actually asserts, not just that it exists:
  - `agent-partner-edge-authz.test.ts` — cross-org denial, same-org composite FK
    checks (tenant isolation / delegated authz / cross-agent calls).
  - `agent-schema-rls-smoke.test.ts` — real `pg_class`/`pg_policy` introspection
    when `SUPABASE_DB_URL`/`DATABASE_URL` is set; soft-skips (not silently-pass)
    with a printed warning otherwise. Confirmed this is documented honestly in
    `docs/agents/release-gate.md`.
  - `agent-delegation.test.ts` — `delegation_cycle`, `delegation_depth_exceeded`,
    11 denial cases, and the Xkedule action-set pins.
  - `agent-handoff-contract.test.ts` — 41+ cases including nested-array injection,
    `__proto__`/`constructor` prototype-pollution keys, anchored-match
    false-positive guards. Ran it directly: 195 assertions pass across the full
    gate-member set including this file.
  - `openrouter-provider-policy.test.ts` — construction-not-import drift guard,
    asserts every `new OpenAI(` site is either the documented embedding exception
    or paired with the OpenRouter base URL.
  - `idempotency-ingress-key.test.ts` / `vapi-tools-idempotency.test.ts` — Xkedule
    idempotency mechanism.
  - `coverage-pins.test.ts` — the coverage half of the Xkedule gap (see below).
- **Adversarial proof the gate blocks:** removed `'xkedule_cancel_booking'` from
  the pinned `EXPECTED_SIDE_EFFECTING` array in `tests/coverage-pins.test.ts` and
  ran `npm run release-gate`. Result: 2 failing assertions (`SIDE_EFFECTING_ACTIONS`
  exact-match mismatch, and the "every action type classified" check flags
  `xkedule_cancel_booking` as unclassified since it's no longer in any of the three
  buckets), `RELEASE GATE: FAILED` printed, **process exit code 1** (verified via
  `echo $?` outside a pipe — piping to `tail` had earlier masked this and would
  have been a false negative). Restored the file from a scratch backup; `git status
  --short tests/coverage-pins.test.ts` shows no diff; re-ran the full gate and it
  passes (9 files, 210 tests, 33/33 workflow validations, `RELEASE GATE: PASSED`).
- **CRLF fix verified real, not cosmetic.** Read `tests/coverage-pins.test.ts` and
  confirmed the `readSource()` helper (`.replace(/\r\n/g, '\n')`) is used at all
  three call sites that parse production source as text
  (`deriveActionEngineTypes`, `derivePartnerEdgeDenialReasons`,
  `deriveAgentChannels`) — no remaining `readFileSync(...).utf8` call in this file
  bypasses it. Ran the file directly on this Windows checkout: 15/15 assertions
  collect and pass, confirming the regex is no longer anchored on a line ending
  that CRLF breaks. Commit `e7fd07e5` also credits an "independent verifier run"
  for finding the original break — consistent with this being a real, previously
  caught defect, now closed.
- The Xkedule coverage gap this phase exists to close is real and closed:
  `SIDE_EFFECTING_ACTIONS` in `src/lib/agent-runtime/idempotency.ts` contains all
  three Xkedule booking mutations, and `coverage-pins.test.ts` pins that exact
  membership plus asserts every one of the 48 action types execute-action.ts
  dispatches is in exactly one of three explicit buckets (deliberate reads,
  side-effecting, or the named `WRITES_PENDING_IDEMPOTENCY_REVIEW` bucket) — so a
  future addition cannot walk past classification unnoticed the way the Xkedule
  mutations did through Phase 133.

### TEST-03 (p95 < 5s, documented profile) — **SATISFIED**

- `docs/agents/latency-profile.md` was read in full. It states, per boundary,
  whether it is real production code or a simulated delay, cites a source or
  explicitly labels a figure as an assumption (30ms DB round trip, 900ms model
  turn, 300ms Xkedule call), states the scenario ("simple voice lookup": one
  specialist hop, one tool call, no retries), states iteration count (50),
  defines p95 by the nearest-rank method with an explicit formula, states the
  target (5000ms) and explicitly declines to assume a hardware class. It is
  explicit about what it does NOT prove (network transit to Vapi, real model
  inference, real vendor latency) and specifically declines to reuse
  `client.ts`'s documented 5.1s cold-cache figure because that describes a
  different (pathological) scenario — a materially more honest choice than
  padding the number to look conservative.
- `tests/vapi-latency-profile.test.ts` walks real orchestration code:
  `resolveChannelRoutingMode`, `resolveTrustedAgentRoute`/`resolveSpecialistRoute`,
  `invokeInternalSpecialist` (and the real `PartnerBudget` accounting inside it),
  and `executeAction('xkedule_check_availability', …)` all run as actual imports
  from `src/`, unmocked. Only the boundaries the profile names as simulated are
  mocked: Supabase `.maybeSingle()` calls, the `runAgent()` LLM call (mocked at
  its module boundary, matching the technique already used in
  `agent-invocation-gateway.test.ts`), the Xkedule credentials DB read, and the
  underlying `fetch()` call inside the Xkedule client — `xkeduleFetchJson`/
  `xkeduleFetch`/`checkXkeduleAvailability` request-building logic still runs for
  real on top of the mocked `fetch`.
- Confirmed the test fails on target miss, not merely reports: the assertion is
  `expect(p95, <message with measured/over-budget figures>).toBeLessThan(5000)` —
  a real Vitest assertion, not a `console.log`. Ran the file directly: both tests
  pass, p95 measured at ~1.3-1.4s (well under target, consistent with the
  documented ~1290ms of injected delay plus real in-process overhead).
- Injected latencies are honestly labelled as assumptions with rationale, not
  presented as measurements, and the test's own hard-coded constants
  (`DB_ROUND_TRIP_MS`, `SPECIALIST_MODEL_TURN_MS`, `XKEDULE_VENDOR_CALL_MS`)
  match the profile document's table exactly — no drift between the two files.

### TEST-04 (build/suites/workflow validation/UAT checklist gate before enabling
routing) — **SATISFIED, with a documentation-drift finding (see Disagreements)**

- `.github/workflows/release-gate.yml`: triggers on every `pull_request` and on
  `push` to `main`/`dev` restricted to orchestration-relevant paths. Steps are
  `npm ci` → `npm run release-gate` → `npx vitest run
  tests/vapi-latency-profile.test.ts`. **Grepped for `continue-on-error`,
  `|| true`, `exit 0` — none found.** Any non-zero step exit fails the job by
  default GitHub Actions behavior; nothing overrides that. This is a real block,
  not an advisory report.
- Correctly and explicitly does NOT touch `build-deploy.yml` (verified: no other
  workflow file references `release-gate`), matching the plan's explicit
  constraint not to couple an unproven gate to the live deploy path.
- `npm run build` is deliberately excluded, with the rationale documented in both
  the workflow's own comments and `docs/agents/release-gate.md` (8GB heap,
  10-30 min, `build-deploy.yml` already builds on every push to `main`). This is
  a defensible, honestly-labeled scope decision, not a silent gap — the phase
  plan itself calls this out as an accepted tradeoff.
- `docs/agents/uat-checklist.md`: 12 items, each with a stated precondition, an
  exact action (specific UI path, e.g. "Agents → [agent] → the 'Test Your Bot'
  panel"), and an observable expected result (e.g. "a small pill-shaped badge…
  before the final answer appears" — not "verify it works"). It is genuinely
  executable by someone who has not read the repo: it names dashboard locations,
  not internal function names, in the Action/Expected columns (internal function
  names only appear in preconditions/rationale for the blocked section).
  Correctly marks 3 items **NOW** (delegation, denial, trace — mechanism-level,
  runs today via the Playground), 3 **PROD** (need a live bound Vapi number or
  live WhatsApp/ManyChat connection — normal production usage, not blocked by
  missing code), and 6 **PHASE-136** (blocked because, verified independently,
  `grep -rn "invokeAgentWithChannelRouting\|invokeAgent(" src/app/api` returns
  zero production callers — the routing switch genuinely has no live route
  consulting it yet, so the gate legend's claim is accurate, not just asserted).
  It covers both channels reaching the same specialist (UAT-11), explicit-intent
  direct routing (UAT-07/08), ambiguous-request fallback to the entry
  orchestrator (UAT-09/10), a delegated action succeeding (UAT-01), denial
  failing safely on both channels (UAT-02/UAT-04), duplicate/retry not
  double-booking on both channels (UAT-05/06), a trace being followable
  (UAT-03), and a non-destructive rollback drill (UAT-12) — every item the plan's
  Task 2 enumerated is present.

## Overall verdict: PASSED, with two documentation-drift findings that do not
affect gate correctness

The gate is real. It runs real tests against real orchestration code, it is
wired into CI with no escape hatches, and it demonstrably exits non-zero when a
safety-critical pin regresses — proven by deliberately breaking one and
confirming both the failure and the exit code, then restoring it cleanly.

## Disagreements with the author's `135-VERIFICATION.md`

1. **Stale exclusion narrative in `docs/agents/release-gate.md` and the CI
   workflow's own header comment.** Both documents currently describe
   `tests/security-secdef-isolation.test.ts` as *excluded* from `GATE_MEMBERS`
   because migration 1295 (the cross-org leak fix) is "authored but not
   applied," and both instruct a future reader to "add it back to
   `GATE_MEMBERS` … once 1295 is applied." That description is now false:
   `scripts/release-gate.ts` (updated in commit `d1642843`, same day) already
   lists `tests/security-secdef-isolation.test.ts` as a live `GATE_MEMBERS`
   entry, the migration is applied (confirmed as a known fact and re-confirmed
   here — the test connected to a real DB during my run and passed,
   `get_tag_usage refuses to count tags from a foreign org` in 452ms, meaning a
   live `SUPABASE_DB_URL`/`DATABASE_URL` was available and exercised), and the
   full gate genuinely runs 9 files / 210 tests today, not the 8 files these
   docs still describe. `d1642843` updated `scripts/release-gate.ts` and
   `FINDINGS-OUTSIDE-SCOPE.md` but did not touch `docs/agents/release-gate.md`
   or `.github/workflows/release-gate.yml`, so those two files now contradict
   the code they document. This is a real, checkable drift, not a nitpick: the
   workflow's own comment block ("the deliberately-excluded
   `tests/security-secdef-isolation.test.ts` (real cross-org data leak, fix
   authored but not applied)") and `release-gate.md`'s dedicated section
   ("**This is the exclusion to read carefully**") both actively mislead a
   future reader about current gate composition, even though the gate's actual
   *behavior* (running the file, blocking on failure) is correct. `135-
   VERIFICATION.md` states the opposite — that this doc gap was closed
   ("Stated in `docs/agents/release-gate.md` rather than left implicit … `1295`
   is applied and the suite is a gate member again") — but the actual file
   content still reads as if the exclusion is current fact, not struck
   through or updated. I disagree with the author's implicit claim that the
   documentation was reconciled; it was not, only the code and the findings
   log were.

2. **Stale test-count claim in `135-VERIFICATION.md` itself.** Its own
   verification-focus table row 6 states "`npm run release-gate` exits 0: 8
   files, 206 tests" — accurate as of the initial gate build (before migration
   1295 was applied and the security suite rejoined `GATE_MEMBERS`), but the
   document was edited afterward (its own body now says "applied 2026-09-04")
   without updating this figure. Running the gate today produces 9 files / 210
   tests. Minor, and does not change the pass/fail verdict, but it is an
   internal inconsistency within the same document between the table (stale)
   and the prose (updated).

Neither disagreement changes the requirement verdicts: the gate mechanism
itself is correct and demonstrably blocking; only two explanatory documents
lag behind a same-day follow-up commit that changed gate membership after
they were written.

## Environment notes (not phase-135 defects)

- The working tree was not clean at the start of this verification:
  `src/lib/agent-runtime/idempotency.ts`, `src/lib/agent-runtime/run-agent.ts`,
  and (noted mid-session) `src/lib/agent-runtime/build-workflow-tools.ts` carry
  uncommitted `PERF-03` changes (an `isAbortLikeError`/
  `recordAbandonedIdempotency` timeout-handling addition) unrelated to Phase
  135 — evidently a concurrent session's in-progress work in this shared
  checkout. Confirmed these edits do not touch `SIDE_EFFECTING_ACTIONS`,
  `COMMERCE_WRITE_ACTIONS`, or any other set `coverage-pins.test.ts` pins, so
  they do not affect this phase's gate correctness. Not reverted, since they
  predate this verification session and are out of scope.
- Per instructions, `npm run build` was not run and no migration was applied
  during this verification.
