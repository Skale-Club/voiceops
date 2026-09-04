// tests/vapi-specialist-dispatch.test.ts
// Phase 137 Plan 02 (MESH-02): explicit-intent specialist dispatch on the
// Vapi tool-call webhook.
//
// Two concerns, two describe blocks:
//   1. resolveSpecialistForTool() — trusted tool-name -> same-org,
//      channel-allowed specialist resolution, derived from the agents' own
//      granted workflows (agent_tools -> workflows), never a hardcoded
//      tool-name table. Tests the REAL implementation against a crafted
//      Supabase client.
//   2. The route itself — gated behind the Phase 134 channel routing mode,
//      byte-for-byte unchanged in 'legacy' mode, exactly one internal model
//      call per dispatched voice tool call in 'specialist' mode, and every
//      Phase 133 guarantee (HTTP 200, per-call isolation, the ingress-scoped
//      idempotency guard, abandoned-ownership recording) intact. This block
//      exercises resolveChannelRoutingMode() and resolveSpecialistForTool()
//      for REAL too (via a single dispatching Supabase mock, same technique
//      as tests/channel-routing-wiring.test.ts) rather than mocking them
//      directly — Part 1 already imports resolveSpecialistForTool
//      statically for its own unit tests, so this file cannot also replace
//      that module with a mock without the two concerns colliding.
//
// All vi.mock() factories and the mock functions they close over are
// declared at true module top level (never nested inside a describe/it),
// matching every other Vapi-tools test file in this repo — vi.mock calls
// are hoisted above imports, so a factory can only safely reference a
// variable that is guaranteed to exist by then.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mocks (module top level — see header note on hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

const { afterMock, pendingAfterCallbacks } = vi.hoisted(() => {
  const pendingAfterCallbacks: Array<Promise<unknown>> = []
  const afterMock = vi.fn((fn: () => unknown) => {
    const result = fn()
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      pendingAfterCallbacks.push(result as Promise<unknown>)
    }
  })
  return { afterMock, pendingAfterCallbacks }
})
vi.mock('next/server', () => ({ after: afterMock }))
async function flushAfter(): Promise<void> {
  while (pendingAfterCallbacks.length > 0) {
    const next = pendingAfterCallbacks.shift()
    if (next) await next
  }
}

const verifyVapiSecretMock = vi.fn(() => true)
vi.mock('@/lib/vapi/verify-signature', () => ({
  verifyVapiSecret: (...args: unknown[]) => verifyVapiSecretMock(...args),
}))

const resolveOrgForCallMock = vi.fn(async () => ({ organizationId: 'org-1' }))
vi.mock('@/lib/vapi/end-of-call', () => ({
  resolveOrgForCall: (...args: unknown[]) => resolveOrgForCallMock(...args),
}))

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn(async (v: string) => v) }))

const logToolRunMock = vi.fn(async () => null)
vi.mock('@/lib/workflows/log-tool-run', () => ({
  logToolRun: (...args: unknown[]) => logToolRunMock(...args),
}))

const checkIdempotencyMock = vi.fn(async () => ({ status: 'fresh' as const }))
const recordIdempotencyMock = vi.fn(async () => undefined)
const recordAbandonedIdempotencyMock = vi.fn(async () => undefined)
vi.mock('@/lib/agent-runtime/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()
  return {
    ...actual,
    checkIdempotency: (...args: unknown[]) => checkIdempotencyMock(...args),
    recordIdempotency: (...args: unknown[]) => recordIdempotencyMock(...args),
    recordAbandonedIdempotency: (...args: unknown[]) => recordAbandonedIdempotencyMock(...args),
  }
})

const resolveToolMock = vi.fn()
vi.mock('@/lib/action-engine/resolve-tool', () => ({
  resolveTool: (...args: unknown[]) => resolveToolMock(...args),
}))

const executeActionMock = vi.fn()
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: (...args: unknown[]) => executeActionMock(...args),
}))

// invokeInternalSpecialist lives in a module Part 1 never touches, so
// mocking it here has no effect on the real resolveSpecialistForTool import
// used by Part 1.
const invokeInternalSpecialistMock = vi.fn()
vi.mock('@/lib/agent-runtime/invocation-gateway', () => ({
  invokeInternalSpecialist: (...args: unknown[]) => invokeInternalSpecialistMock(...args),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  resolveSpecialistForTool,
  type ResolveSpecialistForToolParams,
} from '@/lib/agent-runtime/resolve-specialist-route'
import { POST } from '@/app/api/vapi/tools/route'

// ---------------------------------------------------------------------------
// Part 1: resolveSpecialistForTool() — real implementation, crafted client
// ---------------------------------------------------------------------------

const ORG_ID = 'org-11111111-1111-1111-1111-111111111111'
const OTHER_ORG_ID = 'org-22222222-2222-2222-2222-222222222222'
const AVAILABILITY_AGENT_ID = 'agent-availability-0000-000000000001'
const GENERALIST_AGENT_ID = 'agent-generalist-00000-000000000002'

type ToolOwnerAgentRowOverrides = Partial<{
  id: string
  organization_id: string
  slug: string
  is_active: boolean | null
  allowed_channels: string[] | null
}>

function buildOwnerRow(
  agentOverrides: ToolOwnerAgentRowOverrides = {},
  junctionAllowedChannels: string[] | null = null
) {
  return {
    agent_id: agentOverrides.id ?? AVAILABILITY_AGENT_ID,
    allowed_channels: junctionAllowedChannels,
    agents: {
      id: AVAILABILITY_AGENT_ID,
      organization_id: ORG_ID,
      slug: 'availability_specialist',
      is_active: true,
      allowed_channels: ['voice', 'web_widget'],
      ...agentOverrides,
    },
  }
}

/**
 * Builds a chainable Supabase mock matching resolveSpecialistForTool's exact
 * query shape: .from('agent_tools').select(...).eq(x5) with no terminal
 * .maybeSingle() — the function reads a row array, since more than one
 * candidate is a real (ambiguous) outcome it must detect.
 */
function mockAgentToolsLookup(rows: unknown[] | null, error: unknown = null) {
  const eqE = vi.fn(() => ({ data: rows, error }))
  const eqD = vi.fn(() => ({ eq: eqE }))
  const eqC = vi.fn(() => ({ eq: eqD }))
  const eqB = vi.fn(() => ({ eq: eqC }))
  const eqA = vi.fn(() => ({ eq: eqB }))
  const select = vi.fn(() => ({ eq: eqA }))
  const from = vi.fn(() => ({ select }))
  const client = { from }
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
  return { from, select, eqA, eqB, eqC, eqD, eqE }
}

function baseParams(
  overrides: Partial<ResolveSpecialistForToolParams> = {}
): ResolveSpecialistForToolParams {
  return {
    organizationId: ORG_ID,
    channel: 'voice',
    toolName: 'check_availability',
    ...overrides,
  }
}

describe('resolveSpecialistForTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches the single active, channel-allowed agent that has this tool_name granted', async () => {
    mockAgentToolsLookup([buildOwnerRow()])
    const decision = await resolveSpecialistForTool(baseParams())
    expect(decision.matched).toBe(true)
    if (decision.matched) {
      expect(decision.agentId).toBe(AVAILABILITY_AGENT_ID)
      expect(decision.agentSlug).toBe('availability_specialist')
    }
  })

  it('derives the mapping from agent_tools/workflows filters, not a hardcoded tool-name table', async () => {
    const { eqA, eqB, eqC, eqD, eqE } = mockAgentToolsLookup([buildOwnerRow()])
    await resolveSpecialistForTool(baseParams({ toolName: 'a_tenant_specific_tool_name' }))
    expect(eqA).toHaveBeenCalledWith('organization_id', ORG_ID)
    expect(eqB).toHaveBeenCalledWith('workflows.tool_name', 'a_tenant_specific_tool_name')
    expect(eqC).toHaveBeenCalledWith('workflows.is_active', true)
    expect(eqD).toHaveBeenCalledWith('workflows.health_blocked', false)
    expect(eqE).toHaveBeenCalledWith('agents.is_active', true)
  })

  it('denies with no_tool_name when the tool name is absent', async () => {
    mockAgentToolsLookup([])
    const decision = await resolveSpecialistForTool(baseParams({ toolName: undefined }))
    expect(decision).toEqual({ matched: false, reason: 'no_tool_name' })
  })

  it('denies with no_tool_name when the tool name is empty/whitespace', async () => {
    mockAgentToolsLookup([])
    const decision = await resolveSpecialistForTool(baseParams({ toolName: '   ' }))
    expect(decision).toEqual({ matched: false, reason: 'no_tool_name' })
  })

  it('denies with not_found when no agent owns this tool in this org', async () => {
    mockAgentToolsLookup([])
    const decision = await resolveSpecialistForTool(baseParams({ toolName: 'unknown_tool' }))
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('denies with not_found on a lookup error', async () => {
    mockAgentToolsLookup(null, { message: 'boom' })
    const decision = await resolveSpecialistForTool(baseParams())
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('denies with not_found when the only candidate does not allow this channel', async () => {
    // A generalist agent that also has this workflow attached but only
    // allows web_widget must never satisfy a voice request — this is the
    // exact "existing generalist has all eight tools" shape from the tenant
    // reality this phase was built against.
    mockAgentToolsLookup([
      buildOwnerRow({ id: GENERALIST_AGENT_ID, slug: 'generalist', allowed_channels: ['web_widget'] }),
    ])
    const decision = await resolveSpecialistForTool(baseParams({ channel: 'voice' }))
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('excludes a generalist that also owns the tool but does not allow this channel, matching the real specialist', async () => {
    mockAgentToolsLookup([
      buildOwnerRow({ id: GENERALIST_AGENT_ID, slug: 'generalist', allowed_channels: ['web_widget'] }),
      buildOwnerRow({ id: AVAILABILITY_AGENT_ID, slug: 'availability_specialist', allowed_channels: ['voice'] }),
    ])
    const decision = await resolveSpecialistForTool(baseParams({ channel: 'voice' }))
    expect(decision).toEqual({
      matched: true,
      agentId: AVAILABILITY_AGENT_ID,
      agentSlug: 'availability_specialist',
    })
  })

  it('denies with ambiguous when more than one channel-allowed agent owns the same tool', async () => {
    mockAgentToolsLookup([
      buildOwnerRow({ id: AVAILABILITY_AGENT_ID, slug: 'availability_specialist', allowed_channels: ['voice'] }),
      buildOwnerRow({ id: GENERALIST_AGENT_ID, slug: 'generalist', allowed_channels: ['voice'] }),
    ])
    const decision = await resolveSpecialistForTool(baseParams({ channel: 'voice' }))
    expect(decision).toEqual({ matched: false, reason: 'ambiguous' })
  })

  it('respects a per-tool channel override on the agent_tools junction row', async () => {
    mockAgentToolsLookup([buildOwnerRow({}, ['web_widget'])])
    const decision = await resolveSpecialistForTool(baseParams({ channel: 'voice' }))
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('defense-in-depth: ignores a row whose agent organization_id does not match the query org', async () => {
    mockAgentToolsLookup([buildOwnerRow({ organization_id: OTHER_ORG_ID })])
    const decision = await resolveSpecialistForTool(baseParams())
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('allows the workflow channel regardless of the agent allowed_channels list', async () => {
    mockAgentToolsLookup([buildOwnerRow({ allowed_channels: ['web_widget'] })])
    const decision = await resolveSpecialistForTool(baseParams({ channel: 'workflow' }))
    expect(decision.matched).toBe(true)
  })

  it('is channel-neutral: the same tool name resolves for voice and web_widget without any hardcoded tenant tool name', async () => {
    mockAgentToolsLookup([buildOwnerRow({ allowed_channels: ['voice', 'web_widget'] })])
    const voiceDecision = await resolveSpecialistForTool(
      baseParams({ channel: 'voice', toolName: 'anything_a_tenant_calls_it' })
    )
    mockAgentToolsLookup([buildOwnerRow({ allowed_channels: ['voice', 'web_widget'] })])
    const webDecision = await resolveSpecialistForTool(
      baseParams({ channel: 'web_widget', toolName: 'anything_a_tenant_calls_it' })
    )
    expect(voiceDecision.matched).toBe(true)
    expect(webDecision.matched).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Part 2: the route — gating, dispatch, and every Phase 133 guarantee
// ---------------------------------------------------------------------------

const READ_TOOL_CONFIG = {
  id: 'tc-availability',
  workflow_id: 'wf-availability',
  organization_id: 'org-1',
  integration_id: 'int-availability',
  tool_name: 'check_availability',
  action_type: 'knowledge_base' as const,
  config: {},
  fallback_message: 'Sorry, please try again.',
  is_active: true,
  integrations: null,
}

const WRITE_TOOL_CONFIG = {
  id: 'tc-booking',
  workflow_id: 'wf-booking',
  organization_id: 'org-1',
  integration_id: 'int-booking',
  tool_name: 'book_appointment',
  action_type: 'create_appointment' as const,
  config: {},
  fallback_message: 'Sorry, please try again.',
  is_active: true,
  integrations: null,
}

function buildRequest(toolCalls: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>) {
  return new Request('https://xphere.app/api/vapi/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        type: 'tool-calls',
        call: { id: 'call-abc', assistantId: 'assistant-1' },
        toolCallList: toolCalls,
      },
    }),
  })
}

function successfulSpecialistResult(text = 'You have 3pm and 4pm available.') {
  return {
    result: {
      text,
      usage: { tokensIn: 10, tokensOut: 5 },
      invocationId: 'invocation-1',
      traceId: 'trace-1',
      status: 'success' as const,
    },
    traceId: 'trace-1',
    idempotencyKey: 'idem-1',
    externalInteractionId: 'voice:call-abc:tc-1',
  }
}

/**
 * A single dispatching Supabase mock covering both real reads the route now
 * makes inside 'specialist' mode: resolveChannelRoutingMode()'s
 * agent_channel_routing_modes row, and resolveSpecialistForTool()'s
 * agent_tools/workflows/agents join. Neither module is mocked directly —
 * Part 1 above already imports resolveSpecialistForTool as the real
 * implementation, so this file cannot also replace that module with a mock
 * without the two concerns colliding. route.ts's OWN top-level `supabase`
 * client (passed to resolveOrgForCall/resolveTool/executeAction/logToolRun,
 * all mocked) never actually calls `.from()` on the object this returns.
 */
function buildDispatchingSupabaseClient(options: {
  routingMode?: string | null
  routingModeError?: unknown
  throwOnRoutingModeLookup?: boolean
  agentToolsRows?: unknown[] | null
  agentToolsError?: unknown
}) {
  const from = vi.fn((table: string) => {
    if (table === 'agent_channel_routing_modes') {
      if (options.throwOnRoutingModeLookup) {
        throw new Error('routing table unavailable')
      }
      const maybeSingle = vi.fn().mockResolvedValue({
        data: options.routingMode ? { mode: options.routingMode } : null,
        error: options.routingModeError ?? null,
      })
      const eqB = vi.fn(() => ({ maybeSingle }))
      const eqA = vi.fn(() => ({ eq: eqB }))
      const select = vi.fn(() => ({ eq: eqA }))
      return { select }
    }
    if (table === 'agent_tools') {
      const eqE = vi.fn(() => ({ data: options.agentToolsRows ?? [], error: options.agentToolsError ?? null }))
      const eqD = vi.fn(() => ({ eq: eqE }))
      const eqC = vi.fn(() => ({ eq: eqD }))
      const eqB = vi.fn(() => ({ eq: eqC }))
      const eqA = vi.fn(() => ({ eq: eqB }))
      const select = vi.fn(() => ({ eq: eqA }))
      return { select }
    }
    // Unused by any mocked dependency in these tests.
    return { select: vi.fn(() => ({})) }
  })
  return { from }
}

function specialistOwnerRow(agentId: string, agentSlug: string) {
  return {
    agent_id: agentId,
    allowed_channels: null,
    agents: {
      id: agentId,
      organization_id: 'org-1',
      slug: agentSlug,
      is_active: true,
      allowed_channels: ['voice'],
    },
  }
}

describe('vapi tools webhook — specialist mesh dispatch (MESH-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendingAfterCallbacks.length = 0
    verifyVapiSecretMock.mockReturnValue(true)
    resolveOrgForCallMock.mockResolvedValue({ organizationId: 'org-1' })
    checkIdempotencyMock.mockResolvedValue({ status: 'fresh' })
    executeActionMock.mockResolvedValue('direct-action-engine-result')
    // Default: no routing-mode row -> legacy (fail closed), no agent_tools rows.
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({ routingMode: null, agentToolsRows: [] }) as never
    )
  })

  it('legacy mode: never resolves a specialist and never calls the gateway — byte-for-byte the existing direct path', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({ routingMode: 'legacy' }) as never
    )

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'check_availability' }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'direct-action-engine-result' })
    expect(invokeInternalSpecialistMock).not.toHaveBeenCalled()
    expect(executeActionMock).toHaveBeenCalledTimes(1)
  })

  it('legacy mode holds even when the routing-mode lookup itself throws (fails closed)', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({ throwOnRoutingModeLookup: true }) as never
    )

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'check_availability' }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'direct-action-engine-result' })
    expect(invokeInternalSpecialistMock).not.toHaveBeenCalled()
  })

  it('an unrecognised routing-mode value also fails closed to legacy', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({ routingMode: 'not-a-real-mode' }) as never
    )

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'check_availability' }]))
    await flushAfter()

    expect(res.status).toBe(200)
    expect(invokeInternalSpecialistMock).not.toHaveBeenCalled()
    expect(executeActionMock).toHaveBeenCalledTimes(1)
  })

  it('specialist mode + matched read tool: dispatches through the trusted gateway exactly once and skips the direct path', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({
        routingMode: 'specialist',
        agentToolsRows: [specialistOwnerRow('agent-availability-1', 'availability_specialist')],
      }) as never
    )
    invokeInternalSpecialistMock.mockResolvedValue(successfulSpecialistResult('You have 3pm and 4pm available.'))

    const res = await POST(
      buildRequest([{ id: 'tc-1', name: 'check_availability', arguments: { date: '2026-09-10' } }])
    )
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'You have 3pm and 4pm available.' })
    expect(invokeInternalSpecialistMock).toHaveBeenCalledTimes(1)
    const [envelope] = invokeInternalSpecialistMock.mock.calls[0] as [{ route: { agentId: string; channel: string } }]
    expect(envelope.route.agentId).toBe('agent-availability-1')
    expect(envelope.route.channel).toBe('voice')
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  it('specialist mode + a write tool (idempotency required): never dispatches to a specialist, even when one matches', async () => {
    resolveToolMock.mockResolvedValue(WRITE_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({
        routingMode: 'specialist',
        agentToolsRows: [specialistOwnerRow('agent-booking-1', 'booking_specialist')],
      }) as never
    )

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'direct-action-engine-result' })
    // The idempotency-required gate short-circuits BEFORE the specialist
    // lookup even runs — the ingress-scoped guard below stays the sole path
    // for every side-effecting call.
    expect(invokeInternalSpecialistMock).not.toHaveBeenCalled()
    expect(executeActionMock).toHaveBeenCalledTimes(1)
    expect(recordIdempotencyMock).toHaveBeenCalledTimes(1)
  })

  it('specialist mode + no specialist owns the tool: falls back to the direct Action Engine path rather than failing', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({ routingMode: 'specialist', agentToolsRows: [] }) as never
    )

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'check_availability' }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'direct-action-engine-result' })
    expect(invokeInternalSpecialistMock).not.toHaveBeenCalled()
    expect(executeActionMock).toHaveBeenCalledTimes(1)
  })

  it('specialist mode + a denied/non-success specialist invocation: falls back to the direct path instead of failing the call', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({
        routingMode: 'specialist',
        agentToolsRows: [specialistOwnerRow('agent-availability-1', 'availability_specialist')],
      }) as never
    )
    invokeInternalSpecialistMock.mockResolvedValue({
      result: {
        text: 'Reached the specialist lookup limit for this turn.',
        usage: { tokensIn: 0, tokensOut: 0 },
        invocationId: '',
        traceId: 'trace-1',
        status: 'skipped',
        errorDetail: 'channel_specialist_invocation_ceiling',
      },
      traceId: 'trace-1',
      idempotencyKey: 'idem-1',
      externalInteractionId: 'voice:call-abc:tc-1',
    })

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'check_availability' }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'direct-action-engine-result' })
    expect(executeActionMock).toHaveBeenCalledTimes(1)
  })

  it('specialist mode + the gateway itself throws: falls back to the direct path and still returns 200', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({
        routingMode: 'specialist',
        agentToolsRows: [specialistOwnerRow('agent-availability-1', 'availability_specialist')],
      }) as never
    )
    invokeInternalSpecialistMock.mockRejectedValue(new Error('model provider exploded'))

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'check_availability' }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'direct-action-engine-result' })
  })

  it('per-call isolation: a multi-call payload can route one call to a specialist and another directly', async () => {
    resolveToolMock.mockImplementation(async (_orgId: string, name: string) =>
      name === 'check_availability' ? READ_TOOL_CONFIG : WRITE_TOOL_CONFIG
    )
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({
        routingMode: 'specialist',
        agentToolsRows: [specialistOwnerRow('agent-availability-1', 'availability_specialist')],
      }) as never
    )
    invokeInternalSpecialistMock.mockResolvedValue(successfulSpecialistResult('3pm works.'))

    const res = await POST(
      buildRequest([
        { id: 'tc-1', name: 'check_availability', arguments: { date: '2026-09-10' } },
        { id: 'tc-2', name: 'book_appointment', arguments: { time: '3pm' } },
      ])
    )
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.results.find((r) => r.toolCallId === 'tc-1')).toEqual({ toolCallId: 'tc-1', result: '3pm works.' })
    expect(body.results.find((r) => r.toolCallId === 'tc-2')).toEqual({
      toolCallId: 'tc-2',
      result: 'direct-action-engine-result',
    })
    expect(invokeInternalSpecialistMock).toHaveBeenCalledTimes(1)
    expect(executeActionMock).toHaveBeenCalledTimes(1)
  })

  it('specialist mode + timeout on the direct fallback for a write still records abandoned ownership', async () => {
    resolveToolMock.mockResolvedValue(WRITE_TOOL_CONFIG)
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildDispatchingSupabaseClient({ routingMode: 'specialist', agentToolsRows: [] }) as never
    )
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    executeActionMock.mockRejectedValue(abortErr)

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe(WRITE_TOOL_CONFIG.fallback_message)
    expect(recordAbandonedIdempotencyMock).toHaveBeenCalledTimes(1)
  })
})
