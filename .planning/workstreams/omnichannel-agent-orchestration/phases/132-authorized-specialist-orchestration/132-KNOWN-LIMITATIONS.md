---
phase: 132-authorized-specialist-orchestration
type: reference
created: 2026-09-03
---

# Phase 132 — Known Limitations Accepted at Implementation Time

These were reviewed and deliberately accepted. Each fails in the safe direction.
None is a security hole. Record them so a later phase does not rediscover them as
bugs, and so the trade-off is visible if behavior looks surprising in production.

## 1. Scoped knowledge retrieval is recall-limited, not leak-prone

`queryKnowledge()` (`src/lib/knowledge/query-knowledge.ts`) enforces a non-empty
`kb_scope` by over-fetching `max(20, scope.size * 4)` org-filtered chunks and then
filtering in-process on `metadata.knowledge_source_id`.

The `match_documents` RPC applies a JSONB-containment filter, which cannot express
an OR across several source ids — hence the in-process pass.

- **Safe direction:** an out-of-scope chunk can never be returned. Isolation holds.
- **Cost:** if an organization has a large corpus and the scoped source's chunks all
  rank below the over-fetch window, a scoped agent silently retrieves fewer results
  than it should, or none. It degrades to the no-knowledge fallback rather than
  answering from the wrong source.
- **Proper fix (deferred):** extend `match_documents` to accept an id array and push
  the filter into SQL. That needs a migration to the RPC, which is out of Phase 132's
  authored-but-unapplied migration budget. Revisit when scoped agents are configured
  with realistic corpora.

`null` (full-org legacy) and `[]` (retrieval disabled, no provider call) are exact and
carry no such caveat.

## 2. Legacy non-workflow tools are never delegable

Migration 1291 keys `agent_partner_workflow_grants` to `workflows`. Tools sourced from
`_legacy_tool_configs` therefore have no per-edge grant surface to check against.

Rather than infer authority for them, they fail closed whenever they are reached
through a delegation edge: usable when an agent is invoked directly, never inherited
by a specialist. This preserves the least-privilege invariant at the cost of requiring
legacy tools to be migrated to workflows before a specialist can use them.

## 3. Internal recursion fields are not part of the public contract

`_incomingEdge` and `_partnerBudget` are threaded through `run-agent.ts` via a locally
scoped `InternalAgentRunOptions` type instead of being added to `AgentRunOptions` in
`types.ts`. External callers cannot forge an edge or a budget, which is the point.
Anything that needs to start a delegation tree must go through the gateway, not
through a hand-built options object.
