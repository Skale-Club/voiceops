---
phase: 131-trusted-omnichannel-invocation-foundation
plan: 03
status: complete
completed: 2026-09-03
requirements: [AIGW-01, AIGW-02, AIGW-03, AIGW-04, AUTHZ-04]
---

# Plan 131-03 Summary

## Outcome

Created one trusted typed invocation boundary for voice and text around the existing agent runtime, and exposed the optional Vapi entry-agent binding through tenant-safe assistant resolution. Production Vapi tool traffic remains on its unchanged legacy path.

## Changes

- Added `TrustedAgentRoute`, `AgentInvocationEnvelope`, and `AgentInvocationResult` contracts.
- Added `invokeAgent()` with blocking and streaming overloads matching `runAgent()` behavior.
- Copied organization, agent, channel, session, conversation, and trace identity only from the trusted route object.
- Kept untrusted actor, locale, intent, and metadata fields out of `AgentRunOptions`; tests include hostile `orgId`, `organization_id`, `agentId`, and `agent_id` values.
- Generated normalized UUID trace and ingress idempotency keys when channel adapters omit them, without changing `AgentRunResult`.
- Extended `resolveOrgForCall()` to return nullable `entryAgentId` only from the active assistant mapping that owns the organization.
- Kept all Vapi-native-number and legacy assistant-number fallback paths at `entryAgentId: null`.

## Verification

- `npx vitest run tests/agent-invocation-gateway.test.ts tests/action-engine.test.ts tests/vapi-call-events.test.ts tests/agents/zod-schemas.test.ts tests/assistant-agent-binding.test.ts --testTimeout=10000`
- Result: 5 files passed, 62 tests passed, 0 failed, duration 11.22s.
- `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run build`
- Result: production build passed; Webpack compiled in 3.2 minutes, TypeScript completed in 2.5 minutes, and 220 static pages generated in 31.6 seconds.
- `rg "invokeAgent" src/app/api/vapi/tools/route.ts` returned no matches.
- Migration 1290 contains no `UPDATE` or `INSERT` against `assistant_mappings`.

## Files Modified

- `src/lib/agent-runtime/types.ts`
- `src/lib/agent-runtime/invocation-gateway.ts`
- `src/lib/agent-runtime/index.ts`
- `src/lib/vapi/end-of-call.ts`
- `tests/agent-invocation-gateway.test.ts`
- `tests/vapi-call-events.test.ts`

## Operational Note

No production route invokes the gateway yet. No database migration was applied, no tenant configuration was changed, and no Vapi assistant was cut over.

## Deviations

- The first combined test attempt had one existing dynamic-import test exceed the explicit 10-second timeout under concurrent cold loading. The isolated rerun passed, and the exact five-file compatibility command then passed 62/62 with the same timeout; no production or timeout setting was changed.

## Self-Check: PASSED
