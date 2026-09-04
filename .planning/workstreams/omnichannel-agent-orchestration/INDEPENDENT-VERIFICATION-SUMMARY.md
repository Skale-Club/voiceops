---
type: verification
created: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Independent Verification — Consolidated Result

All six phases were re-verified by `gsd-verifier` agents that did not execute the work.
Each was told to read the executing agent's own `VERIFICATION.md` **last**, only to
compare, and to list every disagreement.

This pass exists because the original verifications were written by the same agent that
did the work. That is exactly the conflict the separate verifier role is meant to remove,
and it cost something: the Xkedule gap survived Phase 133's own verification and was only
caught later, by accident, while building Phase 135's gate.

## Verdicts

| Phase | Independent verdict | What changed as a result |
|---|---|---|
| 131 | Achieved | Flakiness finding recorded; stale "migration not applied" claim corrected |
| 132 | Achieved (12/12) | Drift-guard blind spot recorded |
| 133 | **Gaps found** | PERF-03 fixed in `0e2008c8`; SAFE-01 downgraded to PARTIAL |
| 134 | **Partial** | ROLL-02 downgraded to PARTIAL; UI gap recorded |
| 135 | Achieved | Gate proven to block adversarially; stale docs fixed |
| 136 | **Gaps found** | ROLL-01 downgraded to PARTIAL; ROLL-03 confirmed correctly blocked |

## What it found that my own verification did not

### A real defect, now fixed — PERF-03

Phase 133 built abandoned-ownership recording and wired it into exactly one call site:
the Vapi tool webhook. `run-agent.ts` (blocking and streaming) and
`build-workflow-tools.ts` all derive idempotency keys for side-effecting actions, all
handle failure, and none recorded abandonment. An agent-driven side-effecting call that
timed out left no ownership marker, so a later retry saw a free slot.

The widget route is live and calls `runAgent` directly, so this was reachable in
production. Fixed in `0e2008c8`, with tests that pin the reach on all three paths rather
than the mechanism alone.

This is the third instance of one pattern: **a mechanism that is correct and never
reached.** Xkedule was the first, the channel ceiling the second, this the third.

### Three requirements were graded more generously than the evidence supported

- **SAFE-01** → PARTIAL. The requirement says "...and other side-effecting operations
  receive a stable idempotency key". The guard reaches 11 of the 35 write action types.
  The other 24 are named and pinned, but naming them is not satisfying the requirement.
- **ROLL-02** → PARTIAL. "Operators can switch each channel" is not true: nothing reads
  `resolveChannelRoutingMode`, and there is no UI or API that writes
  `agent_channel_routing_modes`. There is no operator surface even in principle.
- **ROLL-01** → PARTIAL. "Cuts & Culture is configured as the canary" is not satisfied by
  a graph that has never been provisioned to a tenant.

I had recorded the underlying facts honestly in each case, and still let the checkbox
say Done. The facts were right and the grade was wrong.

### A gate that was lying about itself, and one that was not

`tests/coverage-pins.test.ts` had stopped collecting entirely on this Windows checkout —
a pattern anchored on a blank line stopped matching once a branch switch rewrote line
endings to CRLF. Fifteen assertions were silently gone. I had run the gate and read a
truncated tail, taking its trailing `PASSED` line at face value; the gate itself was
correct throughout and exited non-zero. Fixed in `e7fd07e5`.

The Phase 135 verifier then proved the gate genuinely blocks by removing a pinned value
and confirming exit code 1 — and flagged the trap I had fallen into: piping through
`tail` masks the real exit code.

### Documentation that had drifted from behavior

`docs/agents/release-gate.md` and the workflow header still described
`security-secdef-isolation` as excluded pending an unapplied fix. Migration 1295 is
applied and the suite is a gate member again. Corrected.

## Still open, recorded not fixed

- **The 24 unclassified write action types.** `send_whatsapp_message`, `send_email`, the
  whole pipeline surface. Fixing spans most of the product's integration surface and the
  guard fails closed, so a wrong classification suppresses real work. Needs its own phase.
- **The dashboard never renders what Phase 134 records.** `delegation-tree.tsx` ignores
  `InvocationTreeNode.workflowRuns`, and `partner_calls` is rendered nowhere. The join is
  correct and tested; an operator cannot see it in the product. A fourth instance of the
  same pattern, at the UI layer.
- **The drift guard misses the factory pattern.** It catches `new Anthropic(` and
  `new OpenAI(` but not the Vercel AI SDK's `createAnthropic()` / `createOpenAI()`, which
  `qualify-llm.ts` still imports as dead code.
- **Schema drift beyond the one function reconciled.** See `FINDINGS-OUTSIDE-SCOPE.md`.

## What this pass says about the process

Five of six phases were substantively sound. The failures were not in the code so much as
in the grading: every requirement whose grade moved was one where I had documented the
limiting fact and then checked the box anyway.

The single highest-value change would be to stop letting the executing agent write the
verification. Every gap above was findable from the same evidence I had.
