---
phase: 134-traceability-and-reversible-routing
plan: 02
commit: fbb95d0d
status: complete
---

# 134-02 - Per-channel legacy and specialist routing mode

## What it changed

Migration 1293 stores a routing mode per organization and channel, defaulting to legacy and inserting no rows, so every organization resolves through absence and nothing is silently migrated. Deliberately separate from the unrelated calls routing_mode (browser / phone_forward).

## Worth knowing

The resolver falls back to legacy on a missing row, a read error, an unrecognised string, malformed data and missing inputs - an unknown value is never read as enable-specialist. Rollback proven non-destructive by snapshotting agents, mappings, workflows and invocations across a legacy to specialist to legacy flip.

## Files

```
src/lib/agent-runtime/routing-mode.ts             |  92 +++++++
src/lib/agents/zod-schemas.ts                     |  23 ++
src/types/database.ts                             |  49 +++-
supabase/migrations/1293_channel_routing_mode.sql |  63 +++++
tests/channel-routing-mode.test.ts                | 313 ++++++++++++++++++++++
```
