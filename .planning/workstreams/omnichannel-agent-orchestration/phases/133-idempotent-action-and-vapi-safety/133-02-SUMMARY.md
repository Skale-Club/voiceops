---
phase: 133-idempotent-action-and-vapi-safety
plan: 02
commit: e007da1c
status: complete
---

# 133-02 - Voice latency policy on the shared budget

## What it changed

A channel-keyed policy caps internal specialist model invocations per turn - one for voice, unrestricted elsewhere - counted on the Phase 132 tree-shared PartnerBudget rather than a second parallel limiter. Exhaustion returns a lean recoverable result, never a throw or a hang.

## Worth knowing

Shipped wired into the gateway only. The recursive in-process handoff loop in run-agent.ts, where a specialist three hops deep actually lives, was left ungated and closed separately in c31368fb with tests pinning that the check runs before the traversal is counted.

## Files

```
src/lib/agent-runtime/channel-policy.ts     |  79 +++++++++++
src/lib/agent-runtime/guardrails.ts         |  38 ++++-
src/lib/agent-runtime/invocation-gateway.ts |  73 ++++++++++
tests/agent-voice-latency-policy.test.ts    | 211 ++++++++++++++++++++++++++++
```
