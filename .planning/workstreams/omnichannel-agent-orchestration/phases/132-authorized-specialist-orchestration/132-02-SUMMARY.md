---
phase: 132-authorized-specialist-orchestration
plan: 02
commit: 60690309
status: complete
---

# 132-02 - Partner-edge policy and fail-closed preflight

## What it changed

Migration 1291 gave every agent-to-agent edge composite same-organization foreign keys on both endpoints, explicit allowed channels, and bounded call/depth/timeout policy. Delegated workflows became a normalized grant table rather than an unverifiable UUID array, so a cross-organization edge is impossible at the database boundary rather than merely denied in code.

## Worth knowing

resolvePartnerEdge() returns a typed allow/deny after checking organization, active endpoints, channel, explicit edge, limits and grants. A delegation grant never creates a direct tool grant; missing or malformed policy fails closed. Migration authored here, applied later on 2026-09-04.

## Files

```
src/lib/agent-runtime/resolve-partner-edge.ts      | 224 ++++++++++++
src/lib/agents/zod-schemas.ts                      |  25 ++
src/types/database.ts                              |  61 ++++
.../1291_authorized_agent_partner_edges.sql        | 210 +++++++++++
tests/agent-partner-edge-authz.test.ts             | 390 +++++++++++++++++++++
```
