---
phase: 131-trusted-omnichannel-invocation-foundation
plan: 02
status: complete
completed: 2026-09-03
requirements: [AIGW-02, AIGW-03, AIGW-04, AUTHZ-04]
---

# Plan 131-02 Summary

## Outcome

Added the additive, tenant-safe data foundation for shared voice/text agents without changing live Vapi routing or production data.

## Changes

- Added `voice` to the PostgreSQL `agent_channel` enum and the application channel registry.
- Added nullable `assistant_mappings.entry_agent_id` with a composite same-organization foreign key to `agents(organization_id, id)`.
- Preserved legacy routing when `entry_agent_id` is NULL; the migration contains no mapping insert, update, or backfill.
- Updated generated-style database projections, labels, validation coverage, and exhaustive channel defaults.
- Added deterministic migration contract tests for idempotency, tenant isolation, and absence of data mutation.

## Verification

- `npx vitest run tests/agents/zod-schemas.test.ts tests/assistant-agent-binding.test.ts`
- Result: 2 files passed, 16 tests passed, 0 failed, duration 5.73s.
- `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run build`
- Result: production build passed, including TypeScript and 220 static pages. Local Redis connection warnings were non-fatal environmental noise.

## Files Modified

- `supabase/migrations/1290_omnichannel_agent_invocation_foundation.sql`
- `src/types/database.ts`
- `src/lib/agents/channels.ts`
- `src/app/(dashboard)/agents/actions.ts`
- `tests/agents/zod-schemas.test.ts`
- `tests/assistant-agent-binding.test.ts`

## Operational Note

Migration 1290 is committed source only. It was not applied to any database, and no Vapi assistant was bound or cut over.

## Deviations

- The default 2 GB Node heap completed Webpack compilation but was previously terminated during TypeScript validation. Re-running with a 4 GB heap completed the full production build.
- `src/app/(dashboard)/agents/actions.ts` was added to the change set because its exhaustive `Record<AgentChannel, ...>` required the new `voice` key.

## Self-Check: PASSED
