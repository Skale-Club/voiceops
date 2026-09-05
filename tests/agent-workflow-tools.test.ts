// tests/agent-workflow-tools.test.ts
// Phase 132 Plan 03 (AUTHZ-01/AUTHZ-02): buildWorkflowTools() authorization.
//
// Replaces the Phase 38 "every ancestor must own this workflow" intersection
// model with resolveEffectiveToolAuthority()'s ancestor-free composition:
//   effective delegated authority
//     = specialist's own direct grant (resolveAgentTool)
//     ∩ current partner edge's delegated workflow allow-list (resolvePartnerEdge)
// Exercises the REAL buildWorkflowTools() dynamicTool.execute() path, with
// resolveAgentTool and executeWorkflowTool mocked at the module boundary so
// the authorization composition itself (resolveEffectiveToolAuthority) runs
// for real.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../src/types/database'
import type { PartnerEdgeAllow } from '../src/lib/agent-runtime/resolve-partner-edge'
import type { ResolvedToolConfig } from '../src/lib/agent-runtime/types'

vi.mock('@/lib/agent-runtime/resolve-agent-tool', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-runtime/resolve-agent-tool')>(
    '@/lib/agent-runtime/resolve-agent-tool',
  )
  return { ...actual, resolveAgentTool: vi.fn() }
})
vi.mock('@/lib/agent-runtime/execute-workflow-tool', () => ({
  executeWorkflowTool: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))
// Phase 138 Plan 02: every existing test in this file builds a
// book_appointment tool (TOOL_NAME below). Mocking the resolver to the safe
// default at the module boundary keeps every pre-existing test passing
// unchanged — no new `organizations` branch needed in makeServiceClient.
vi.mock('@/lib/agent-runtime/resolve-service-location-mode', () => ({
  resolveServiceLocationMode: vi.fn().mockResolvedValue('on_premises'),
}))
// Spy on the real implementation so tests can assert on the definition
// object it was called with, without duplicating derive-input-schema.ts's
// own extraction logic here.
vi.mock('@/lib/workflows/derive-input-schema', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/workflows/derive-input-schema')>(
      '@/lib/workflows/derive-input-schema',
    )
  return { ...actual, deriveWorkflowInputSchema: vi.fn(actual.deriveWorkflowInputSchema) }
})

import { buildWorkflowTools, buildWorkflowSystemPromptSuffix, type WorkflowToolSummary } from '../src/lib/agent-runtime/build-workflow-tools'
import { resolveAgentTool } from '../src/lib/agent-runtime/resolve-agent-tool'
import { executeWorkflowTool } from '../src/lib/agent-runtime/execute-workflow-tool'
import { resolveServiceLocationMode } from '../src/lib/agent-runtime/resolve-service-location-mode'
import { renderServiceLocationBlock } from '../src/lib/agent-runtime/service-location-prompt'
import { deriveWorkflowInputSchema } from '../src/lib/workflows/derive-input-schema'

const AGENT_ID = 'agent-wf-tools-0000-0000-000000000001'
const ORG_ID = 'org-wf-tools-0000-0000-000000000001'
const WORKFLOW_ID = 'wf-0000-0000-0000-000000000001'
const TOOL_NAME = 'book_appointment'

function chainable(result: unknown) {
  const obj: Record<string, unknown> = {}
  const self = () => obj
  obj.select = vi.fn(self)
  obj.eq = vi.fn(self)
  obj.not = vi.fn(self)
  obj.single = vi.fn(() => Promise.resolve(result))
  obj.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return obj
}

function workflowRow(
  overrides: { allowed_channels?: unknown; workflows?: Record<string, unknown> } = {},
) {
  const { workflows: workflowOverrides, ...rest } = overrides
  return {
    allowed_channels: null,
    workflow_id: WORKFLOW_ID,
    workflows: {
      id: WORKFLOW_ID,
      name: 'Book Appointment',
      tool_name: TOOL_NAME,
      description: 'Books an appointment.',
      kind: 'tool' as const,
      is_active: true,
      health_blocked: false,
      current_version_id: 'version-1',
      ...workflowOverrides,
    },
    ...rest,
  }
}

function makeServiceClient(agentToolsRows: unknown[], definition: unknown = {}) {
  const from = vi.fn((table: string) => {
    if (table === 'agent_tools') return chainable({ data: agentToolsRows, error: null })
    if (table === 'workflow_versions') return chainable({ data: { definition } })
    throw new Error(`unexpected table: ${table}`)
  })
  return { from } as unknown as SupabaseClient<Database>
}

function resolvedWorkflowTool(workflowId: string = WORKFLOW_ID): ResolvedToolConfig {
  return {
    toolConfigId: workflowId,
    toolName: TOOL_NAME,
    actionType: 'run_flow',
    config: {},
    integrationId: null,
    integrationProvider: null,
    credentialsEncrypted: null,
    workflowId,
    workflowKind: 'tool',
  }
}

function allowedEdge(grantedWorkflowIds: string[]): PartnerEdgeAllow {
  return {
    allow: true,
    edgeId: 'edge-1',
    partnerAgentId: AGENT_ID,
    maxCallsPerTurn: 3,
    maxDepth: 2,
    timeoutMs: 30000,
    grantedWorkflowIds,
  }
}

function baseParams(overrides: Partial<Parameters<typeof buildWorkflowTools>[0]> = {}) {
  return {
    agentId: AGENT_ID,
    orgId: ORG_ID,
    channel: 'web_widget' as const,
    currentChain: [AGENT_ID],
    getInvocationId: () => 'invocation-1',
    traceId: 'trace-1',
    conversationId: undefined,
    serviceClient: makeServiceClient([workflowRow()]),
    toolCallsLog: [] as Json[],
    getNextToolCallIndex: (() => {
      let i = 0
      return () => i++
    })(),
    ...overrides,
  }
}

describe('buildWorkflowTools: listing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists a workflow tool attached to the agent', async () => {
    const result = await buildWorkflowTools(baseParams())
    expect(result.summaries).toEqual([{ toolName: TOOL_NAME, description: 'Books an appointment.', kind: 'tool' }])
    expect(Object.keys(result.toolSet)).toEqual([TOOL_NAME])
  })

  it('skips a row whose allowed_channels excludes the current channel', async () => {
    const params = baseParams({
      serviceClient: makeServiceClient([workflowRow({ allowed_channels: ['voice'] })]),
    })
    const result = await buildWorkflowTools(params)
    expect(result.summaries).toEqual([])
  })

  it('includes a row when allowed_channels is null (every channel)', async () => {
    const params = baseParams({
      channel: 'voice',
      serviceClient: makeServiceClient([workflowRow({ allowed_channels: null })]),
    })
    const result = await buildWorkflowTools(params)
    expect(result.summaries).toHaveLength(1)
  })

  it('skips a row with no tool_name or no current_version_id', async () => {
    const params = baseParams({
      serviceClient: makeServiceClient([
        workflowRow({ workflows: { tool_name: null } }),
      ]),
    })
    const result = await buildWorkflowTools(params)
    expect(result.summaries).toEqual([])
  })

  it('returns an empty result when the query errors or finds no rows', async () => {
    const params = baseParams({ serviceClient: makeServiceClient([]) })
    const result = await buildWorkflowTools(params)
    expect(result.toolSet).toEqual({})
    expect(result.summaries).toEqual([])
  })
})

describe('buildWorkflowTools: execute() authorization (AUTHZ-01/AUTHZ-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(executeWorkflowTool).mockResolvedValue({ ok: true, result: 'Booked.' })
  })

  it('allows execution at the top level (no incoming edge) when the agent directly owns the workflow', async () => {
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool())
    const params = baseParams({ incomingEdge: null })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toBe('Booked.')
    expect(executeWorkflowTool).toHaveBeenCalledTimes(1)
  })

  it('denies execution when the agent does not directly own the workflow (not attached)', async () => {
    vi.mocked(resolveAgentTool).mockResolvedValue(null)
    const params = baseParams({ incomingEdge: null, toolCallsLog: [] })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toBe('Workflow not available to this agent on this channel.')
    expect(executeWorkflowTool).not.toHaveBeenCalled()
    expect(params.toolCallsLog[0]).toMatchObject({ denied: true, denied_reason: 'workflow_not_attached_to_agent' })
  })

  it('denies execution when resolveAgentTool resolves a DIFFERENT workflow than the one attached (stale tool_name)', async () => {
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool('wf-some-other-id'))
    const params = baseParams({ incomingEdge: null })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toBe('Workflow not available to this agent on this channel.')
    expect(executeWorkflowTool).not.toHaveBeenCalled()
  })

  it('allows execution when reached through delegation AND the current edge delegates this workflow', async () => {
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool())
    const params = baseParams({ incomingEdge: allowedEdge([WORKFLOW_ID]) })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toBe('Booked.')
    expect(executeWorkflowTool).toHaveBeenCalledTimes(1)
  })

  it('denies execution when reached through delegation but the current edge does NOT delegate this workflow — even though the specialist owns it directly', async () => {
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool())
    const toolCallsLog: Json[] = []
    const params = baseParams({ incomingEdge: allowedEdge(['some-other-workflow']), toolCallsLog })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toBe(`Tool execution denied: ${TOOL_NAME} is not authorized for this delegation.`)
    expect(executeWorkflowTool).not.toHaveBeenCalled()
    expect(toolCallsLog[0]).toMatchObject({ denied: true, denied_reason: 'edge_does_not_delegate_workflow' })
  })

  it('denies execution when reached through delegation with a legacy edge that grants no workflows at all', async () => {
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool())
    const params = baseParams({ incomingEdge: allowedEdge([]) })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toContain('not authorized for this delegation')
    expect(executeWorkflowTool).not.toHaveBeenCalled()
  })

  it('never re-checks or requires ownership from any ancestor in currentChain — the authorization call takes no chain-membership argument', async () => {
    // Regression guard for the removed Phase 38 model: a long chain of
    // agents that do NOT own the workflow must not matter at all once the
    // specialist itself owns it and the edge delegates it.
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool())
    const params = baseParams({
      currentChain: ['orchestrator-without-the-tool', 'router-without-the-tool', AGENT_ID],
      incomingEdge: allowedEdge([WORKFLOW_ID]),
    })
    const { toolSet } = await buildWorkflowTools(params)
    const output = await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(output).toBe('Booked.')
    // resolveAgentTool is called exactly once — for the specialist itself,
    // never for any ancestor in currentChain.
    expect(resolveAgentTool).toHaveBeenCalledTimes(1)
    expect(resolveAgentTool).toHaveBeenCalledWith(AGENT_ID, TOOL_NAME, 'web_widget')
  })
})

// ---------------------------------------------------------------------------
// Perf (2026-09-05 re-analysis, FINDINGS-OUTSIDE-SCOPE.md item 9):
// getInvocationId() must be read live, at execute() time — never captured
// once when buildWorkflowTools() is called — because run-agent.ts now runs
// the invocation INSERT concurrently with buildWorkflowTools() instead of
// awaiting it first. A plain `invocationId: string` param would freeze
// whatever optimistic id was current at construction time into every
// closure below, permanently — even after the INSERT settles (or fails) a
// moment later.
// ---------------------------------------------------------------------------

describe('buildWorkflowTools: getInvocationId is read live at execute() time (perf item 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveAgentTool).mockResolvedValue(resolvedWorkflowTool())
    vi.mocked(executeWorkflowTool).mockResolvedValue({ ok: true, result: 'Booked.' })
  })

  function contextFromLastCall(): { agentInvocationId?: string } {
    const call = vi.mocked(executeWorkflowTool).mock.calls.at(-1)
    return (call?.[0] as { context: { agentInvocationId?: string } }).context
  }

  it('threads the getter value current AT EXECUTE TIME, not at buildWorkflowTools() construction time', async () => {
    let currentInvocationId = 'optimistic-client-generated-id'
    const params = baseParams({ incomingEdge: null, getInvocationId: () => currentInvocationId })
    const { toolSet } = await buildWorkflowTools(params)

    // The INSERT (run concurrently with the construction above, per
    // run-agent.ts's Promise.all) settles to a real id AFTER construction —
    // simulated here by mutating the value the getter closes over.
    currentInvocationId = 'settled-real-invocation-id'
    await toolSet[TOOL_NAME].execute!({}, {} as never)

    expect(contextFromLastCall().agentInvocationId).toBe('settled-real-invocation-id')
  })

  it('sees the insert-failed sentinel if the INSERT fails after construction — never the stale optimistic id', async () => {
    let currentInvocationId = 'optimistic-client-generated-id'
    const params = baseParams({ incomingEdge: null, getInvocationId: () => currentInvocationId })
    const { toolSet } = await buildWorkflowTools(params)

    // The INSERT failed — run-agent.ts's `.then()` corrects the outer
    // variable to the sentinel before any tool actually executes.
    currentInvocationId = 'insert-failed'
    await toolSet[TOOL_NAME].execute!({}, {} as never)

    // agentInvocationId must be undefined, not the sentinel string itself
    // and not the stale optimistic id — see the 'insert-failed' guard in
    // build-workflow-tools.ts.
    expect(contextFromLastCall().agentInvocationId).toBeUndefined()
  })

  it('a settled real id is threaded through as agentInvocationId (control case)', async () => {
    const params = baseParams({ incomingEdge: null, getInvocationId: () => 'already-settled-id' })
    const { toolSet } = await buildWorkflowTools(params)
    await toolSet[TOOL_NAME].execute!({}, {} as never)
    expect(contextFromLastCall().agentInvocationId).toBe('already-settled-id')
  })
})

// ---------------------------------------------------------------------------
// Phase 138 Plan 02 (MODAL-02/MODAL-03): service location modality
// ---------------------------------------------------------------------------

function bookAppointmentDefinition() {
  return {
    trigger: {
      type: 'tool_call',
      config: {
        tool_name: TOOL_NAME,
        input_schema: {
          service_id: { type: 'string', required: true },
          date: { type: 'string', required: true },
          time: { type: 'string', required: true },
          customer_name: { type: 'string', required: true },
          customer_phone: { type: 'string', required: true },
          customerAddress: {
            type: 'string',
            description: "Customer's service address.",
            required: false,
          },
          notes: { type: 'string', required: false },
        },
      },
    },
  }
}

function bookAppointmentClient() {
  return makeServiceClient([workflowRow()], bookAppointmentDefinition())
}

/** The definition object passed to deriveWorkflowInputSchema() for a given call index. */
function derivedInputSchemaArg(callIndex = 0): Record<string, unknown> {
  const call = vi.mocked(deriveWorkflowInputSchema).mock.calls[callIndex]
  const definition = call[0] as { trigger: { config: { input_schema: Record<string, unknown> } } }
  return definition.trigger.config.input_schema
}

describe('buildWorkflowTools: service location modality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveServiceLocationMode).mockResolvedValue('on_premises')
  })

  it('omits customerAddress from the derived schema for the default-mocked on_premises mode', async () => {
    const params = baseParams({ serviceClient: bookAppointmentClient() })
    await buildWorkflowTools(params)
    expect(derivedInputSchemaArg()).not.toHaveProperty('customerAddress')
  })

  it('requires customerAddress when the org resolves to at_customer', async () => {
    vi.mocked(resolveServiceLocationMode).mockResolvedValue('at_customer')
    const params = baseParams({ serviceClient: bookAppointmentClient() })
    await buildWorkflowTools(params)
    expect(derivedInputSchemaArg().customerAddress).toMatchObject({ required: true })
  })

  it('keeps customerAddress optional when the org resolves to either', async () => {
    vi.mocked(resolveServiceLocationMode).mockResolvedValue('either')
    const params = baseParams({ serviceClient: bookAppointmentClient() })
    await buildWorkflowTools(params)
    expect(derivedInputSchemaArg().customerAddress).toMatchObject({ required: false })
  })

  it('never resolves or renders a modality block for an agent whose tools do not include book_appointment', async () => {
    const params = baseParams({
      serviceClient: makeServiceClient(
        [workflowRow({ workflows: { tool_name: 'list_services' } })],
        { trigger: { config: { input_schema: { query: { type: 'string', required: false } } } } },
      ),
    })
    const result = await buildWorkflowTools(params)
    expect(resolveServiceLocationMode).not.toHaveBeenCalled()
    expect(result.modalityBlock).toBe('')
  })

  it('sets modalityBlock to the exact renderServiceLocationBlock() text for the resolved mode', async () => {
    vi.mocked(resolveServiceLocationMode).mockResolvedValue('at_customer')
    const params = baseParams({ serviceClient: bookAppointmentClient() })
    const result = await buildWorkflowTools(params)
    expect(result.modalityBlock).toBe(renderServiceLocationBlock('at_customer'))
  })

  it('resolves the mode at most once per build', async () => {
    const params = baseParams({ serviceClient: bookAppointmentClient() })
    await buildWorkflowTools(params)
    expect(resolveServiceLocationMode).toHaveBeenCalledTimes(1)
  })

  it('leaves every other workflow definition untouched (no book_appointment attached)', async () => {
    const otherDefinition = { trigger: { config: { input_schema: { foo: { type: 'string', required: true } } } } }
    const params = baseParams({
      serviceClient: makeServiceClient(
        [workflowRow({ workflows: { tool_name: 'reschedule_appointment' } })],
        otherDefinition,
      ),
    })
    await buildWorkflowTools(params)
    expect(derivedInputSchemaArg()).toEqual({ foo: { type: 'string', required: true } })
  })
})

describe('buildWorkflowSystemPromptSuffix', () => {
  const summaries: WorkflowToolSummary[] = [
    { toolName: TOOL_NAME, description: 'Books an appointment.', kind: 'tool' },
  ]

  it('produces byte-identical output whether modalityBlock is omitted or explicitly empty', () => {
    const omitted = buildWorkflowSystemPromptSuffix(summaries)
    const explicit = buildWorkflowSystemPromptSuffix(summaries, '')
    expect(omitted).toBe(explicit)
    expect(omitted).not.toContain('## Service Location')
  })

  it('appends the modality block under its own heading after Available Workflows, without altering that section', () => {
    const base = buildWorkflowSystemPromptSuffix(summaries)
    const withBlock = buildWorkflowSystemPromptSuffix(summaries, 'MODALITY TEXT HERE')
    expect(withBlock.startsWith(base)).toBe(true)
    expect(withBlock).toContain('## Service Location')
    expect(withBlock).toContain('MODALITY TEXT HERE')
  })

  it('produces no suffix at all for an empty summaries list, regardless of modalityBlock', () => {
    expect(buildWorkflowSystemPromptSuffix([], 'unused')).toBe('')
  })
})

describe('run-agent.ts: modality block threading (structural)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/agent-runtime/run-agent.ts'), 'utf8')

  it('has exactly two call sites of buildWorkflowSystemPromptSuffix(, each passing a modalityBlock second argument', () => {
    const matches = source.match(/buildWorkflowSystemPromptSuffix\(/g) ?? []
    expect(matches).toHaveLength(2)
    expect(source).toContain('workflowToolsResult.modalityBlock')
    expect(source).toContain('workflowToolsStream.modalityBlock')
  })
})
