---
phase: 133-idempotent-action-and-vapi-safety
plan: 01
commit: 7b399031
status: complete
---

# 133-01 - Ingress-scoped idempotency keys

## What it changed

The existing key hashed a freshly generated invocation id, so a retry minted a new id and the guard could not recognise the replay. Added a derivation from trusted channel ingress identity, keeping the invocation-scoped form as the fallback for widget, campaign and cron paths.

## Worth knowing

checkIdempotency became a discriminated outcome - fresh, replay, conflict, abandoned. Conflict was previously not detected at all: the three existing callers only checked cached !== null. Also edited run-agent.ts and build-workflow-tools.ts, outside the stated file list, because changing the signature without updating its callers would not compile.

## Files

```
src/lib/agent-runtime/build-workflow-tools.ts |  27 ++-
src/lib/agent-runtime/idempotency.ts          | 173 ++++++++++++++-
src/lib/agent-runtime/run-agent.ts            |  41 +++-
tests/idempotency-ingress-key.test.ts         | 303 ++++++++++++++++++++++++++
```
