---
phase: 134-traceability-and-reversible-routing
plan: 01
commit: 33dfc6c5
status: complete
---

# 134-01 - Workflow runs linked to their causing trace

## What it changed

Migration 1292 added a nullable trace id and a composite same-organization invocation reference to workflow_runs, with ON DELETE SET NULL so the column never blocks deletion. Both nullable because cron, campaign and manual runs legitimately have no agent invocation.

## Worth knowing

The Vapi route passes null rather than reusing call.id: that id is TEXT everywhere else and is not UUID-shaped, and forcing it risked dropping the whole log row on a latency-sensitive always-200 path. Real trace threading flows through execute-workflow-tool.ts instead.

## Files

```
src/app/api/vapi/tools/route.ts                    |  15 +
src/lib/workflows/log-tool-run.ts                  |  15 +
.../migrations/1292_workflow_run_trace_linkage.sql | 107 +++++++
tests/workflow-run-trace-linkage.test.ts           | 334 +++++++++++++++++++++
```
