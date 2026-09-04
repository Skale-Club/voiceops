---
phase: 132-authorized-specialist-orchestration
plan: 01
commit: 599118e9
status: complete
---

# 132-01 - Typed handoff and specialist-result contracts

## What it changed

Replaced an unrestricted partner payload and a string-only result. The old validator was a deny-list of three keys applied to objects only; the new one is an allow-listed schema that recursively rejects identity, organization, agent, role/system/instruction, secret/credential/token, runtime-control and prototype-pollution keys across nested objects AND arrays. Results became a discriminated union: success, business_failure, retryable_failure, handoff.

## Worth knowing

The delegation suite's local validator now calls the production findForbiddenHandoffKey instead of duplicating the old regex, so the test cannot drift from the code it guards. 41 new contract tests, 91/91 with the pre-existing delegation suite.

## Files

```
src/lib/agent-runtime/handoff.ts     | 330 +++++++++++++++++++++++++++++++++++
src/lib/agent-runtime/run-agent.ts   | 100 +++++++----
src/lib/agent-runtime/types.ts       |   6 +
tests/agent-delegation.test.ts       |  25 +--
tests/agent-handoff-contract.test.ts | 300 +++++++++++++++++++++++++++++++
```
