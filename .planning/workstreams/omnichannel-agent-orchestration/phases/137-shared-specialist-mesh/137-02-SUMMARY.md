---
phase: 137-shared-specialist-mesh
plan: 02
status: complete
completed: 2026-09-04
requirements: [MESH-02]
---

# Plan 137-02 Summary

## Outcome

`/api/vapi/tools` can now dispatch an explicit tool call to the specialist that owns it,
gated entirely behind the Phase 134 channel routing mode so an organization left on
`legacy` is byte-for-byte unchanged. Writes never take this path — they stay on the direct
Action Engine route so the ingress-scoped idempotency guard remains the only thing between
a Vapi retry and a double booking.

## Changes

- `resolveSpecialistForTool()` in `src/lib/agent-runtime/resolve-specialist-route.ts`: a
  new resolver that derives the tool-name-to-specialist mapping from the tenant's own
  `agent_tools` / workflow grants — never a hardcoded table of names — so a tenant that
  names its tools differently still resolves correctly. Fails closed (no route, not a
  guess) on an unknown tool name, an inactive agent, a channel mismatch, or more than one
  channel-eligible owner (ambiguous). The pre-existing slug-based
  `resolveSpecialistRoute()` was left untouched.
- `src/app/api/vapi/tools/route.ts`: resolves the Phase 134 channel routing mode once per
  request, defaulting to `legacy` on any error including a broken Supabase client. In
  `specialist` mode, a READ tool call whose name resolves to a specialist is dispatched
  through `invokeInternalSpecialist()`, which shares the Phase 133 voice invocation
  ceiling — exactly one internal model call, honoring the 6.5-8.3s `check_availability`
  latency constraint from `137-CONTEXT.md`. A write call (`requiresIdempotency() ===
  true`) always keeps using the direct Action Engine path regardless of routing mode. Any
  non-match, denial, or thrown error inside the specialist path falls back to the existing
  direct path rather than failing the call.
- `tests/vapi-specialist-dispatch.test.ts`: unit tests for the resolver, plus route-level
  integration tests proving legacy is a byte-for-byte no-op, specialist dispatch costs
  exactly one gateway call, writes are never delegated to a specialist, and every Phase
  133 guarantee (HTTP 200, per-call isolation, idempotency, abandoned-ownership recording)
  still holds.

## Verification

- `npx vitest run tests/vapi-specialist-dispatch.test.ts tests/vapi-tools-http200-contract.test.ts tests/vapi-tools-idempotency.test.ts tests/vapi-tools-multicall.test.ts`

## Files Modified

- `src/lib/agent-runtime/resolve-specialist-route.ts`
- `src/app/api/vapi/tools/route.ts`
- `tests/vapi-specialist-dispatch.test.ts`

## What this plan did not prove

This plan's own suites run against mocked Supabase doubles. Whether the dispatch actually
worked against the live tenant — and whether the six provisioned agents could even be
resolved — was not established here. It was established (and found broken, then fixed) by
the unplanned work in `137-03-PLAN.md`: the six agents had no active `agent_prompt_version`
row, so `resolveAgent()` refused every one of them and the specialist path was inert end to
end despite passing every test in this plan. Voice was left on `legacy` for this plan;
flipping the routing mode row is a separate, later action (see `137-VERIFICATION.md`).

## Deviations from Plan

None — plan executed as written. The gap between "tests pass" and "works against the live
tenant" surfaced in the follow-on work described in `137-03-PLAN.md`, not during this
plan's own execution.

## Self-Check: PASSED
