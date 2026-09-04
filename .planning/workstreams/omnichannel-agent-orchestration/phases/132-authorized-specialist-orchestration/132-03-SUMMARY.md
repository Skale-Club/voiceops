---
phase: 132-authorized-specialist-orchestration
plan: 03
commit: 07baabcf
status: complete
---

# 132-03 - Edge-based least privilege and knowledge scope

## What it changed

Removed the Phase 38 model where every ancestor in the chain had to own the specialist's tool. Effective authority is now the specialist's own grant, intersected with the current edge's grant and the channel policy, so an orchestrator can delegate without carrying its specialists' tools.

## Worth knowing

GATE-04 was rewritten rather than deleted, growing to eleven denial cases including a budget shared across a three-hop tree and a fail-closed path for absent policy. kb_scope moved from loaded-and-ignored to enforced in both the blocking and streaming paths. Legacy non-workflow tools have no per-edge grant surface, so they fail closed through delegation.

## Files

```
src/lib/agent-runtime/build-workflow-tools.ts |  47 +++--
src/lib/agent-runtime/guardrails.ts           |  51 +++++
src/lib/agent-runtime/resolve-agent-tool.ts   |  54 +++++
src/lib/agent-runtime/run-agent.ts            | 174 +++++++++++----
src/lib/knowledge/query-knowledge.ts          |  45 +++-
tests/agent-delegation.test.ts                | 293 ++++++++++++++++++++++----
tests/agent-knowledge-scope.test.ts           | 166 +++++++++++++++
tests/agent-workflow-tools.test.ts            | 256 ++++++++++++++++++++++
```
