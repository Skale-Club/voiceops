---
phase: 136-cuts-and-culture-canary-rollout
verified: 2026-09-04T15:18:22Z
status: gaps_found
score: 1/3 requirement claims fully hold (ROLL-01 PARTIAL, ROLL-02-wiring PARTIAL/inert, ROLL-03 correctly BLOCKED)
independence: true
gaps:
  - truth: "ROLL-01: Cuts & Culture is configured as the first tenant canary"
    status: partial
    reason: >
      The graph is authored as a reviewable JSON artifact and its shape,
      channel coverage, and least-privilege grant claim are all proven by
      test against a mocked Supabase client. But scripts/provision-canary-graph.ts
      has never been run against any real organization -- no Cuts & Culture
      org exists in the live database with these agents, edges, or grants.
      "Configured" is a present-tense claim about a tenant's live state;
      what exists today is a declared-but-unprovisioned artifact plus a
      script proven safe in isolation. REQUIREMENTS.md itself hedges this
      with "(configuration authored, not provisioned)" next to the [x],
      which is the right instinct but is easy to misread as done-done at a
      glance, and the roadmap checkbox for 136-01/136-02 plans reads as
      unqualified completion.
    artifacts:
      - path: ".planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json"
        issue: "Declared, well-formed, tested against a fake client -- never applied to any real org row."
      - path: "scripts/provision-canary-graph.ts"
        issue: "Zero real invocations; only exercised through tests/canary-graph-shape.test.ts's FakeSupabase."
    missing:
      - "Either reword ROLL-01's roadmap/requirements status to something like 'authored, unprovisioned' rather than a bare done-checkbox, or run the script against the real Cuts & Culture org before calling it configured."
  - truth: "ROLL-02 wiring (carried into this phase) makes the routing switch actually switch something in production"
    status: partial
    reason: >
      136-CONTEXT.md frames wiring the switch as "the first task of this
      phase" so that "merging the wiring changes nobody's behavior until
      someone deliberately flips a row" -- implying that after this phase, a
      flipped row would eventually take effect. What was actually built is
      a new function, invokeAgentWithChannelRouting(), that consults the
      switch correctly and is unit-tested thoroughly -- but it has ZERO
      callers anywhere under src/app. The live widget route
      (src/app/api/chat/[token]/route.ts) calls runAgent() directly; the
      live voice tool webhook (src/app/api/vapi/tools/route.ts) calls
      executeAction() directly; and src/lib/agent-runtime/index.ts
      re-exports only invokeAgent, not invokeAgentWithChannelRouting. So
      flipping a row today, even after every step in the runbook up through
      Step 5, would change nothing -- a fact the runbook itself discloses
      as a newly-required "Step 5.0" (an ingress code change through its
      own PR/CI/deploy cycle) that was not in 136-CONTEXT.md's original
      5-step human/production boundary list. This is disclosed honestly by
      the executing agent (commendable), but it means the phase's own
      framing of "wiring" as complete is narrower than the plain reading of
      136-CONTEXT.md's carried-forward-gap language.
    artifacts:
      - path: "src/lib/agent-runtime/invocation-gateway.ts"
        issue: "invokeAgentWithChannelRouting() is correct and tested, but is dead code from production's perspective -- no caller in src/app."
    missing:
      - "An ingress route (voice or widget) actually calling invokeAgentWithChannelRouting(), OR explicit acknowledgement in 136-CONTEXT.md/ROADMAP.md that this phase wires the trusted-boundary library function only, not any live ingress path."
human_verification: []
---

# Phase 136: Cuts & Culture Canary Rollout -- Independent Verification

**Phase Goal:** Cuts & Culture alone runs the first production specialist graph across
voice and widget, proving shared specialization, real idempotent booking, and complete
tracing without installing tenant-specific behavior as a platform default.

**Requirements verified:** ROLL-01, ROLL-03 (ROLL-02 touched incidentally via plan 136-01;
noted below because it directly determines whether ROLL-03 could even become true).

**Verified:** 2026-09-04
**Status:** gaps_found (documentation/status-labeling gaps, not code defects -- see below)
**Independence:** This report was written before reading `136-VERIFICATION.md` in detail
beyond a final comparison pass; all code, tests, and DB artifacts below were verified
directly against the repository, not against that file's prose.

## Central Question: Is ROLL-03 Correctly Graded as Blocked?

**Yes. The executing agent's judgement is correct, and if anything slightly
understates how far from "live" the system actually is.**

ROLL-03 requires: (1) a real widget interaction and a real Vapi interaction reaching the
same specialist in production, (2) a real idempotent booking, (3) a complete trace. None of
the three has happened -- confirmed by the "Known facts" given for this verification (no
assistant bound, no routing row flipped, no booking placed) and independently corroborated
by code inspection:

- `invokeAgentWithChannelRouting()` -- the only code path that would consult the routing
  switch and dispatch to a specialist -- has no caller anywhere in `src/app`. Even if a
  human flipped a routing row today, nothing would read it, because no ingress route calls
  this function. The live widget route calls `runAgent()` directly; the live Vapi tools
  route calls `executeAction()` directly.
- `docs/agents/canary-activation-runbook.md` discloses this itself, in its own words,
  under "The fact that makes Step 5 mandatory, not optional" and introduces a **Step 5.0**
  (an ingress code change, its own PR/CI/deploy) that is not mentioned in
  `136-CONTEXT.md`'s original 5-step human/production boundary list.
- No booking has been placed (confirmed: no test exercises a real Xkedule mutation; the
  idempotency guard is proven only against mocked/replayed webhook payloads in
  `tests/vapi-tools-idempotency.test.ts` and `tests/idempotency-ingress-key.test.ts`).

The self-written `136-VERIFICATION.md` reaches the same conclusion, states it plainly under
"Status is deliberately not 'verified'" and "The fact that reframes the whole milestone,"
and does not claim ROLL-03 achieved. **This is one of the more honest self-verifications I
have reviewed** -- it volunteers the "zero production callers" finding rather than letting
it hide behind the unit tests passing.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cuts & Culture graph exists as tenant-scoped, isolated declarative data (not a platform default) | VERIFIED | `.planning/.../canary/cuts-and-culture.json` exists; `tests/canary-graph-shape.test.ts` asserts `GRAPH_PATH` is outside `supabase/seeds/workflows/` and that no seed YAML mentions "cuts and culture" (regex walk). Ran: 22/22 pass. |
| 2 | Only Booking holds an Xkedule write grant | VERIFIED (against simulated apply, not live data) | `assertOnlyBookingHoldsWriteGrants()` fails closed before any write; `tests/canary-graph-shape.test.ts` additionally asserts this against the *rows a mocked provisioning apply actually writes* (joining grants -> workflows -> edges -> agents), not just the JSON labels. No live grant rows exist yet because nothing has been provisioned -- this is the correct proof available given that constraint. |
| 3 | Voice and widget reference ONE Availability specialist, by id | VERIFIED | JSON declares exactly one `availability` agent and one `entry_to_availability` edge covering both channels. Test asserts `availabilityAgents` and `availabilityEdges` both have length 1, both by id, in both the raw graph and the fake-provisioned rows. |
| 4 | Cuts & Culture is "configured" as the first tenant canary | **PARTIAL -- disagree with an unqualified "done"** | No organization in any real database has this graph. The script that would provision it has never been run outside tests. "Configured" is stronger than "authored." See gap entry above. |
| 5 | The routing switch (ROLL-02 carryover) is wired so flipping a row changes behavior | **PARTIAL -- inert in production** | `invokeAgentWithChannelRouting()` correctly consults the switch and is unit-tested (117/117 pass across the four Plan-01 verify files), but has zero callers under `src/app`. Confirmed by grep and by tracing `src/lib/agent-runtime/index.ts`'s exports (only `invokeAgent`, not the routed variant, reaches `src/app/api/chat/[token]/route.ts`, `src/app/api/playground/[agentId]/route.ts`, `src/app/api/widget/playground/route.ts`). |
| 6 | The provisioning script is dry-run by default, refuses a non-target org, and is idempotent | VERIFIED | `parseArgs([])` -> `{org: null, apply: false}`, no network call; `assertSafeToWrite` throws when `apply && !org`; `provisionCanaryGraph` re-validates the live org's `slug` against `graph.organization.slug` before any write and throws on mismatch or nonexistence; re-running `apply` twice produces identical row counts and identical returned ids in `tests/canary-graph-shape.test.ts`. Ran: 22/22 pass, including the org-refusal and re-run-is-a-no-op cases. |
| 7 | Legacy routing is unaffected; channels move independently | VERIFIED | `tests/channel-routing-wiring.test.ts`: byte-for-byte equality between `invokeAgent()` and the legacy branch of `invokeAgentWithChannelRouting()`; six fail-to-legacy cases (absent row, read error, unrecognised string, malformed value, explicit legacy, specialist-mode-without-intent) all resolve to the untouched entry agent and never query `agents`; voice/widget flip independently in both directions. Ran: 117/117 pass across the plan's four verify files. |
| 8 | Activation runbook has an abort step per stage and does not imply the canary is live | VERIFIED | Every one of Steps 1-6 (plus the newly-disclosed 5.0) states precondition / action / success signal / abort step. The document opens and closes with explicit "no agent has performed any of this" language and a closing "proven vs. unproven" split that names the exact unproven claims (same specialist reached live, booking completing live, trace joining live rows). |
| 9 | Phases 131-135 suites stay green and the release gate passes | VERIFIED (re-run independently) | `npm run release-gate` -> `RELEASE GATE: PASSED`, 9 test files / 210 tests passed, plus 33/33 workflow YAML validations. |

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/agent-runtime/invocation-gateway.ts` (`invokeAgentWithChannelRouting`) | Trusted-boundary consultation of the routing switch | EXISTS, SUBSTANTIVE, **ORPHANED in production** | Correctly implemented and tested; zero callers under `src/app`. |
| `src/lib/agent-runtime/routing-mode.ts` | Unmodified switch resolver | UNCHANGED, VERIFIED | Fail-closed to legacy on every axis; 35/35 tests pass independently. |
| `.planning/.../canary/cuts-and-culture.json` | Tenant-scoped graph declaration | EXISTS, SUBSTANTIVE, tested | Never applied to a live org. |
| `scripts/provision-canary-graph.ts` | Idempotent, dry-run-default, org-scoped provisioning | EXISTS, SUBSTANTIVE, WIRED (to the JSON + Supabase client interface), tested against a fake client | Never invoked against a real Supabase project (git history: single commit, no execution artifacts; consistent with the task's stated known facts). |
| `docs/agents/canary-activation-runbook.md` | Ordered, reversible, abort-annotated human sequence | EXISTS, SUBSTANTIVE | Discloses Step 5.0 gap candidly. Contains an "Update 2026-09-04" note confirming migrations 1290-1295 were applied -- consistent with this task's stated known facts. |

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `invokeAgentWithChannelRouting` | `resolveChannelRoutingMode` | direct call, once per invocation | WIRED | Confirmed by test counting `agent_channel_routing_modes` lookups == 1 per call. |
| `invokeAgentWithChannelRouting` (specialist branch) | `resolveTrustedAgentRoute` | direct call on `mode === 'specialist'` | WIRED | Confirmed by test: specialist mode + matching intent resolves to the specialist agent id. |
| Any route under `src/app` | `invokeAgentWithChannelRouting` | import | **NOT WIRED** | Zero matches via grep across `src/app`; `src/lib/agent-runtime/index.ts` does not re-export it either. This is the single most consequential finding for ROLL-03's feasibility, and it is already disclosed in the runbook and self-verification. |
| `provision-canary-graph.ts` | `cuts-and-culture.json` | `loadCanaryGraph(GRAPH_PATH)` | WIRED | Confirmed by test importing both and asserting shape. |
| `provision-canary-graph.ts` | real Supabase org row | `--org=<uuid>` + `--apply` | **NEVER EXECUTED** | By design (task constraint) I did not run it; corroborated by single-commit git history and the explicit "has never been run against a real organization" comment in the script's own header, matching the task's stated known facts. |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ROLL-01 | 136-02 | Cuts & Culture configured as first tenant canary; only Booking gets Xkedule write | **PARTIAL** (roadmap/REQUIREMENTS.md mark [x] Done) | Graph authored and tested exhaustively; zero live provisioning. The literal claim "is configured" is not yet true of any real tenant. REQUIREMENTS.md already partially hedges this ("configuration authored, not provisioned") but the checkbox itself reads as unqualified completion. |
| ROLL-03 | 136-03 | Live canary proves shared specialist + real idempotent booking + full trace | **BLOCKED, correctly graded** | Confirmed unmet on all three legs (shared specialist reached live, real booking, live trace) both by the task's stated known facts and by independent code inspection (no ingress caller of the routed gateway exists at all, so even "flip a row" would not currently produce observable behavior). |
| ROLL-02 (incidental, owned by Phase 134 per REQUIREMENTS.md line 115/129) | 136-01 | Operators can switch routing per channel and roll back non-destructively | **Mechanism VERIFIED in isolation; inert end-to-end** | The switch resolves correctly and every failure mode is proven by test. But because nothing calls the function that consults it from any live route, an operator flipping a row today observes literally no difference -- which is the exact starting condition ROLL-02 was meant to move past. This is disclosed by the runbook (Step 5.0) and by `136-VERIFICATION.md`, not hidden. |

## Anti-Patterns Found

None that constitute code-quality stubs. The one substantive concern in this phase is a
**status-labeling gap, not a code gap**: ROLL-01's roadmap/requirements checkbox reads as
unqualified "Done" for a claim ("is configured") that is only true in the "authored, not
applied" sense. No `TODO`/placeholder/stub patterns found in the reviewed files
(`invocation-gateway.ts`, `routing-mode.ts`, `provision-canary-graph.ts`,
`cuts-and-culture.json`, the runbook, both test files).

## Agreement / Disagreement with `136-VERIFICATION.md`

**Where I agree:**
- ROLL-03 correctly graded as unmet / blocked on a human-executed live run. Status
  `verified_to_the_human_gate` (not `passed`) is the right call.
- The "zero production callers of `invokeAgent`/`invokeAgentWithChannelRouting`" finding is
  accurate and I independently reproduced it via grep and by tracing
  `src/lib/agent-runtime/index.ts`'s export surface.
- "Provisioning was never run" is accurate; the script's own docstring and single-commit git
  history corroborate it.
- All ten items in that document's "Verification focus" table check out against the actual
  test files and pass when re-run (117/117 for plan 01's tests, 22/22 for plan 02's tests,
  210/210 across the full release gate).
- The runbook's abort-step coverage and its explicit "not live" framing are accurate as
  described.

**Where I disagree / want to sharpen:**
1. **`136-VERIFICATION.md` does not explicitly grade ROLL-01 itself as partial.** It proves
   the graph's shape and the write-grant claim thoroughly (items 5-9 in its table), but
   never states in so many words that the top-level ROLL-01 claim -- "Cuts & Culture is
   configured" -- is not yet true of any real organization. It documents the underlying
   facts (provisioning never run) but stops short of saying "therefore ROLL-01 is only
   partially satisfied," leaving that inference to the reader. Given the task's explicit
   instruction to grade this bluntly even though the roadmap marks it done, I am recording
   ROLL-01 as PARTIAL rather than implicitly accepting the roadmap's unqualified `[x]`.
2. **The self-verification frames the "zero production callers" finding as "not a
   defect... no phase was authorized to cut over,"** which is true as far as it goes, but
   understates the gap between 136-CONTEXT.md's own framing of Plan 01 ("wiring it is
   cutting over routing... it must land in a state where legacy remains the default... until
   someone deliberately flips a row") and what was actually delivered (a library function
   nothing calls, so flipping a row changes nothing regardless of this phase's work). I
   don't think this reflects sloppy execution by 136-01 -- the plan's own file list was
   scoped narrowly to the gateway layer -- but the CONTEXT document's language oversold what
   "wiring" would accomplish, and neither the roadmap nor `136-VERIFICATION.md` flags that
   mismatch as a documentation defect to fix, only as a fact to note.
3. **Minor:** `136-VERIFICATION.md` cites "104/104 across the phase's suites" for item 10;
   I independently ran the full `npm run release-gate` and got 210/210 (9 files) plus 33/33
   workflow validations -- a different, larger number, likely because the release gate's
   `GATE_MEMBERS` list (TEST-02-scoped) differs from whatever narrower "phase suites" subset
   was run for that specific claim. Both pass; I flag the count mismatch only for
   traceability, not as a substantive disagreement.

No other item in the phase was graded more generously than the evidence supports. The
executing agent's overall candor here is unusually high for a self-report.

## Human Verification Required

None beyond what `docs/agents/canary-activation-runbook.md` already specifies for Steps
1-6 (plus 5.0). This report adds no new human-verification items; it narrows what "done"
means for ROLL-01 and flags the routing-switch's real-world inertness pending Step 5.0.

## Gaps Summary

Both gaps recorded here are **status/documentation gaps, not code defects**. The code that
exists (routing-mode consultation, the canary graph, the provisioning script, the runbook)
is well-built and thoroughly tested for what it claims to do. The issue is that two
roadmap-level claims -- "ROLL-01 is configured" and, more subtly, "the routing switch is
wired" -- read as more complete than the underlying production reality, which is: nothing
has been provisioned to any real organization, and no ingress route calls the function that
would make a routing-row flip observable. The phase's own runbook and self-verification
already surface the second fact prominently; they should be read as authoritative caveats on
the roadmap's `[x]` marks, not as satisfied by them.

---

*Verified: 2026-09-04T15:18:22Z*
*Verifier: Claude (independent gsd-verifier, second pass)*
