---
phase: 133-idempotent-action-and-vapi-safety
plan: 03
commit: 3cc836aa
status: complete
---

# 133-03 - Vapi webhook made idempotent and multi-call safe

## What it changed

toolCallList[0] was silently dropping every additional call in a multi-call payload. Replaced with per-call execution and matching result ids, isolated so one failure cannot suppress the others. Side-effecting calls became guarded by the ingress-scoped key, and a timeout now records abandoned ownership before returning the fallback.

## Worth knowing

Regressed the pre-existing action-engine suite: an unguarded checkIdempotency throw fell into the per-call catch and turned both a successful execution and the tenant's own fallback message into a generic 'Service unavailable.'. Fixed in b6ad9f63; a cast for the nullable FK was replaced in 519ce698.

## Files

```
src/app/api/vapi/tools/route.ts           | 177 +++++++++++++++++++---
tests/vapi-tools-http200-contract.test.ts | 234 ++++++++++++++++++++++++++++++
tests/vapi-tools-idempotency.test.ts      | 215 +++++++++++++++++++++++++++
tests/vapi-tools-multicall.test.ts        | 169 +++++++++++++++++++++
```
