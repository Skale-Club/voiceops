---
phase: 139-agent-mesh-as-a-template
plan: 03
status: complete
completed: 2026-09-04
requirements: [TMPL-04]
---

# Plan 139-03 Summary

## Outcome

An operator can now view and flip, per channel, whether that channel routes through the
legacy entry-agent flow or Phase 132's specialist mesh — from `Settings`, without database
access. This closes the one genuine SQL-only gap 139-CONTEXT.md's addendum identified
(`agent_channel_defaults` already had `ChannelDefaultsCard`; only
`agent_channel_routing_modes` lacked a surface).

## Changes

- `2c086548`-adjacent commit `e90a895c` — `src/app/(dashboard)/agents/actions.ts`:
  `getChannelRoutingModes()` / `setChannelRoutingMode()`, mirroring
  `getChannelDefaults()`/`setChannelDefault()`'s exact shape. A channel with no row in
  `agent_channel_routing_modes` reports `'legacy'`, matching both the table's own default
  and `routing-mode.ts`'s fail-closed contract. `setChannelRoutingMode()` upserts on
  `(organization_id, channel)` — writes exactly one row, never touches an agent, mapping,
  workflow, or invocation-history row.
- `f6036319` — `src/components/agents/channel-routing-modes-card.tsx`: a two-option
  `Select` (Legacy default / Specialist mesh) per `PUBLIC_AGENT_CHANNELS` entry, modeled on
  `ChannelDefaultsCard`'s `Card`/`Select`/`Label` structure and
  `useTransition` + `toast` + `router.refresh()` pattern. Wired into
  `AgentSettingsButton` below the existing Channel Defaults section, and into the agents
  page's data-fetch `Promise.all` alongside `getChannelDefaults()`.
- `src/app/(dashboard)/agents/page.tsx`: fetches `getChannelRoutingModes()` alongside the
  page's other settings data.
- `tests/agent-channel-routing-modes-actions.test.ts`: 4 cases — legacy-default fill for
  channels with no row, the upsert shape, upserting when no row previously existed, and
  the unauthenticated-caller convention.

## Verification

- `npx vitest run tests/agent-channel-routing-modes-actions.test.ts` — 4/4 passed,
  independently re-run at verification time.
- Independently confirmed at verification time by direct read of
  `src/components/agents/agent-settings-button.tsx` and
  `src/app/(dashboard)/agents/page.tsx`: `ChannelRoutingModesCard` is genuinely rendered
  in the settings dialog, not merely imported and unused.

## Files Modified

- `src/app/(dashboard)/agents/actions.ts`
- `src/components/agents/channel-routing-modes-card.tsx`
- `src/components/agents/agent-settings-button.tsx`
- `src/app/(dashboard)/agents/page.tsx`
- `tests/agent-channel-routing-modes-actions.test.ts`

## Commits

- `e90a895c` — `feat(139-03): server actions for the channel routing-mode switch`
- `f6036319` — `feat(139-03): channel-routing card in the agents Settings dialog`

## Self-Check: PASSED (reconstructed independently from commits `e90a895c`/`f6036319` and
the live source tree; this SUMMARY was not written by the executing agent and is being
added retroactively during verification)
