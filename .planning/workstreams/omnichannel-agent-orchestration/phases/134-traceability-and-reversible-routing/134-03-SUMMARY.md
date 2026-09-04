---
phase: 134-traceability-and-reversible-routing
plan: 03
commit: 10dedba4
status: complete
---

# 134-03 - Delegation, denials and redacted observability

## What it changed

partner_calls went from a column with zero writes anywhere in the runtime to a record of the edges actually traversed, their timing and their outcome. Every Phase 132/133 denial class is now recorded as a denial rather than an error, since a denied call is a deliberate refusal.

## Worth knowing

Redaction runs inside the single invocation writer, before persistence, never as a display filter. Migration 1294 repaired the workflow_tool_logs view, which hardcoded NULL for the two columns 134-01 had just made real. Phone numbers are deliberately not redacted: a loose-digit heuristic collided with dash-separated UUID trace ids.

## Files

```
src/lib/agent-runtime/build-workflow-tools.ts      |  17 +-
src/lib/agent-runtime/execute-workflow-tool.ts     |  14 +
src/lib/agent-runtime/invocations.ts               |  17 +-
src/lib/agent-runtime/observability.ts             |  93 +++-
src/lib/agent-runtime/redact.ts                    | 145 ++++++
src/lib/agent-runtime/run-agent.ts                 | 190 +++++++-
.../1294_workflow_tool_logs_trace_columns.sql      |  89 ++++
tests/agent-voice-latency-policy.test.ts           |   8 +-
tests/invocation-partner-calls.test.ts             | 508 +++++++++++++++++++++
tests/invocation-redaction.test.ts                 | 338 ++++++++++++++
```
