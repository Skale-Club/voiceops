// tests/channel-routing-wiring.test.ts
// Phase 136 Plan 01 (ROLL-02 wiring): the trusted boundary in
// invocation-gateway.ts now consults resolveChannelRoutingMode() ONCE per
// invocation before choosing a path. Phase 134 built the switch and
// deliberately wired it into nothing (confirmed by grep before this plan);
// this file proves the wiring itself is safe to merge before any
// organization's row is flipped away from the implicit legacy default.
//
// The single most important property under test: merging this changes NO
// organization's behavior today. Migration 1293 inserts no rows, so every
// organization resolves through absence-of-row to legacy — and the legacy
// branch here must be byte-for-byte invokeAgent()'s existing, unchanged
// behavior, not a parallel reimplementation of it.
//
// Mocking style matches tests/agent-invocation-gateway.test.ts (runAgent
// mocked at the module boundary) and tests/vapi-latency-profile.test.ts
// (a single createServiceRoleClient mock dispatching on table name, so one
// mock covers both agent_channel_routing_modes and agents).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runAgentMock } = vi.hoisted(() => ({ runAgentMock: vi.fn() }))
vi.mock('@/lib/agent-runtime/run-agent', () => ({ runAgent: runAgentMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { invokeAgent, invokeAgentWithChannelRouting } from '@/lib/agent-runtime/invocation-gateway'
import type { AgentRunResult } from '@/lib/agent-runtime/types'

const ORG_ID = 'org-11111111-1111-1111-1111-111111111111'
const ENTRY_AGENT_ID = 'agent-entry-000-0000-0000-000000000001'
const SPECIALIST_AGENT_ID = 'agent-specialist-0-0000-000000000002'
const SPECIALIST_SLUG = 'availability_specialist'

function runtimeResult(traceId = 'runtime-trace'): AgentRunResult {
  return {
    text: 'ok',
    usage: { tokensIn: 1, tokensOut: 1 },
    invocationId: 'invocation-1',
    traceId,
    status: 'success',
  }
}

function envelope(channel: 'voice' | 'web_widget' = 'voice', agentId = ENTRY_AGENT_ID) {
  return {
    route: {
      orgId: ORG_ID,
      agentId,
      channel,
      externalInteractionId: 'external-1',
    },
    input: { userMessage: 'Quais horários estão disponíveis?' },
  } as const
}

type RoutingSourceOptions = {
  modeRow?: { mode: unknown } | null
  modeError?: unknown
  modeByChannel?: Record<string, { mode: unknown } | null>
  agentRow?: Record<string, unknown> | null
}

/**
 * Single Supabase mock covering both tables the wiring can touch:
 * agent_channel_routing_modes (routing-mode.ts) and agents
 * (resolve-specialist-route.ts, reached only through resolveTrustedAgentRoute
 * on an explicit specialist mode). Records every table `.from()` was called
 * with, so tests can prove the specialist lookup is never reached when the
 * resolved mode is legacy.
 */
function mockRoutingSource(options: RoutingSourceOptions = {}) {
  const { modeRow = null, modeError = null, modeByChannel, agentRow = null } = options
  const calledTables: string[] = []

  const from = vi.fn((table: string) => {
    calledTables.push(table)

    if (table === 'agent_channel_routing_modes') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_col: string, channel: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: modeError ? null : modeByChannel ? (modeByChannel[channel] ?? null) : modeRow,
                error: modeError,
              }),
            })),
          })),
        })),
      }
    }

    if (table === 'agents') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: agentRow, error: null }),
            })),
          })),
        })),
      }
    }

    throw new Error(`channel-routing-wiring test: unexpected table "${table}"`)
  })

  vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never)
  return { from, calledTables }
}

function buildAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SPECIALIST_AGENT_ID,
    organization_id: ORG_ID,
    slug: SPECIALIST_SLUG,
    is_active: true,
    allowed_channels: ['voice', 'web_widget'],
    ...overrides,
  }
}

describe('invokeAgentWithChannelRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runAgentMock.mockImplementation((options: { traceId: string }) =>
      Promise.resolve(runtimeResult(options.traceId)),
    )
  })

  // ---------------------------------------------------------------------
  // Task 1: specialist mode takes the Phase 132 trusted-route path; legacy
  // mode is byte-for-byte invokeAgent()'s existing behavior.
  // ---------------------------------------------------------------------

  it('specialist mode with a matching explicit intent routes to the resolved specialist agent', async () => {
    mockRoutingSource({ modeRow: { mode: 'specialist' }, agentRow: buildAgentRow() })

    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('voice') })

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: SPECIALIST_AGENT_ID, orgId: ORG_ID, channel: 'voice' }),
    )
  })

  it('legacy mode calls the runtime with the untouched entry agent id and never queries agents for a specialist', async () => {
    const { calledTables } = mockRoutingSource({ modeRow: { mode: 'legacy' } })

    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('voice') })

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: ENTRY_AGENT_ID, orgId: ORG_ID, channel: 'voice' }),
    )
    expect(calledTables).toEqual(['agent_channel_routing_modes'])
  })

  it('resolves the routing mode exactly once per invocation, not per tool call', async () => {
    const { from } = mockRoutingSource({ modeRow: { mode: 'legacy' } })

    await invokeAgentWithChannelRouting({ intent: null, envelope: envelope('voice') })

    const modeLookups = from.mock.calls.filter(([table]) => table === 'agent_channel_routing_modes')
    expect(modeLookups).toHaveLength(1)
  })

  it('legacy path returns byte-for-byte the same invocation result as calling invokeAgent directly', async () => {
    mockRoutingSource({ modeRow: null })
    const fixedEnvelope = {
      ...envelope('web_widget'),
      route: { ...envelope('web_widget').route, traceId: 'trace-fixed', idempotencyKey: 'idem-fixed' },
    }

    const direct = await invokeAgent(fixedEnvelope)
    const routed = await invokeAgentWithChannelRouting({ intent: null, envelope: fixedEnvelope })

    expect(routed).toEqual(direct)
  })

  // ---------------------------------------------------------------------
  // Task 2: every axis of uncertainty resolves to legacy, and the
  // specialist path is reachable only on an explicit 'specialist' value.
  // ---------------------------------------------------------------------

  it.each([
    ['no row present for the (org, channel) pair', {}],
    ['a read error even though a specialist row would otherwise match', { modeRow: { mode: 'specialist' }, modeError: new Error('boom') }],
    ['an unrecognised stored mode string', { modeRow: { mode: 'enabled' } }],
    ['a malformed stored mode value', { modeRow: { mode: 123 } }],
    ['an explicit legacy value', { modeRow: { mode: 'legacy' } }],
  ] as const)('takes the legacy path — never the specialist path — when the row lookup has %s', async (_label, opts) => {
    const { calledTables } = mockRoutingSource(opts as RoutingSourceOptions)

    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('voice') })

    expect(runAgentMock).toHaveBeenCalledWith(expect.objectContaining({ agentId: ENTRY_AGENT_ID }))
    expect(calledTables).not.toContain('agents')
  })

  it('never enters the specialist path when intent is absent, even in specialist mode', async () => {
    mockRoutingSource({ modeRow: { mode: 'specialist' }, agentRow: buildAgentRow() })

    await invokeAgentWithChannelRouting({ intent: undefined, envelope: envelope('voice') })

    expect(runAgentMock).toHaveBeenCalledWith(expect.objectContaining({ agentId: ENTRY_AGENT_ID }))
  })

  // ---------------------------------------------------------------------
  // Independence: voice and web_widget move independently.
  // ---------------------------------------------------------------------

  it('flipping voice to specialist changes voice and leaves the widget channel on legacy', async () => {
    mockRoutingSource({
      modeByChannel: { voice: { mode: 'specialist' }, web_widget: null },
      agentRow: buildAgentRow(),
    })

    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('voice') })
    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('web_widget') })

    expect(runAgentMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ agentId: SPECIALIST_AGENT_ID, channel: 'voice' }),
    )
    expect(runAgentMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ agentId: ENTRY_AGENT_ID, channel: 'web_widget' }),
    )
  })

  it('flipping the widget to specialist changes the widget and leaves voice on legacy', async () => {
    mockRoutingSource({
      modeByChannel: { web_widget: { mode: 'specialist' }, voice: null },
      agentRow: buildAgentRow(),
    })

    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('web_widget') })
    await invokeAgentWithChannelRouting({ intent: SPECIALIST_SLUG, envelope: envelope('voice') })

    expect(runAgentMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ agentId: SPECIALIST_AGENT_ID, channel: 'web_widget' }),
    )
    expect(runAgentMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ agentId: ENTRY_AGENT_ID, channel: 'voice' }),
    )
  })
})
