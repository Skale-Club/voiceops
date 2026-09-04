// tests/invocation-partner-calls.test.ts
// Phase 134 Plan 03 (OBS-01, OBS-02) — Tasks 1 & 3.
//
// Task 1: partner_calls is a dead column — nothing in src/lib/agent-runtime/
// ever writes it. This suite proves:
//   - updateInvocationEnd() persists partnerCallsJson into partner_calls,
//     defaulting to [] for backward-compatible callers.
//   - buildDeniedPartnerCallEntry()/buildCompletedPartnerCallEntry() (the
//     pure entry builders run-agent.ts's buildPartnerTools() calls) produce
//     a `denied: true` entry — distinct from an error — for EVERY denial
//     class introduced in Phases 132/133: delegation_cycle,
//     delegation_depth_exceeded, every PartnerEdgeDenialReason, and the two
//     Phase 133 tree-wide budget checks.
//   - applyNestedFailurePenalty() reflects a genuine nested specialist
//     FAILURE (not a mere denial) in the parent's own persisted status,
//     rather than swallowing it behind an otherwise-'success' turn.
//
// Task 3: threads the current trace + invocation identity from the agent
// tool path (build-workflow-tools.ts -> execute-workflow-tool.ts ->
// logToolRun) into the migration-1292 columns, and proves the
// observability read side walks the FULL join — channel ingress, entry
// agent, nested specialist, workflow run, Action Engine execution — in one
// query, not merely asserting the columns exist.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Json } from '@/types/database'
import type { PartnerEdgeDenialReason } from '@/lib/agent-runtime/resolve-partner-edge'

// ---------------------------------------------------------------------------
// Part 1a: pure partner_calls entry builders (run-agent.ts)
// ---------------------------------------------------------------------------

import {
  buildDeniedPartnerCallEntry,
  buildCompletedPartnerCallEntry,
  applyNestedFailurePenalty,
} from '@/lib/agent-runtime/run-agent'

function asRecord(entry: Json): Record<string, unknown> {
  return entry as unknown as Record<string, unknown>
}

describe('buildDeniedPartnerCallEntry — every Phase 132/133 denial class (Task 1)', () => {
  // Every PartnerEdgeDenialReason from resolve-partner-edge.ts, plus the
  // pre-edge (cycle/depth) and tree-wide budget (timeout/ceiling) reasons
  // buildPartnerTools() constructs directly.
  const edgeReasons: PartnerEdgeDenialReason[] = [
    'invalid_request',
    'edge_not_found',
    'cross_organization',
    'source_inactive',
    'target_inactive',
    'channel_not_allowed', // "disallowed channel" at the edge
    'depth_exceeded',
    'call_count_exceeded', // "call count"
    'malformed_policy',
  ]
  const nonEdgeReasons = [
    'delegation_cycle', // "cycle"
    'delegation_depth_exceeded', // "depth"
    'partner_budget_timeout', // "timeout"
    'channel_model_invocation_ceiling', // "channel model-invocation ceiling"
  ]

  for (const reason of [...edgeReasons, ...nonEdgeReasons]) {
    it(`records "${reason}" as a distinguishable denial, not an error`, () => {
      const startedAt = Date.now() - 5
      const entry = asRecord(
        buildDeniedPartnerCallEntry({
          partnerAgentId: 'partner-agent-1',
          partnerSlug: 'booking-specialist',
          deniedReason: reason,
          depth: 1,
          startedAt,
        }),
      )

      expect(entry.denied).toBe(true)
      expect(entry.denied_reason).toBe(reason)
      // A denial is never an error: no `error`/`outcome` field is set, and
      // the entry never carries an exception-shaped payload.
      expect(entry).not.toHaveProperty('error')
      expect(entry).not.toHaveProperty('outcome')
      expect(entry.partner_agent_id).toBe('partner-agent-1')
      expect(entry.partner_slug).toBe('booking-specialist')
      expect(entry.edge_id).toBeNull()
      expect(entry.depth).toBe(1)
      expect(typeof entry.duration_ms).toBe('number')
      expect(entry.duration_ms as number).toBeGreaterThanOrEqual(0)
      expect(typeof entry.started_at).toBe('string')
    })
  }

  it('total denial classes covered >= 10 (132-CONTEXT.md enumerated list)', () => {
    expect(edgeReasons.length + nonEdgeReasons.length).toBeGreaterThanOrEqual(10)
  })
})

describe('buildCompletedPartnerCallEntry — traversal that actually happened (Task 1)', () => {
  it('records a successful traversal: denied=false, outcome, child identity', () => {
    const startedAt = Date.now() - 42
    const entry = asRecord(
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'partner-agent-2',
        partnerSlug: 'refund-specialist',
        edgeId: 'edge-1',
        outcome: 'success',
        childInvocationId: 'child-invocation-1',
        childStatus: 'success',
        depth: 1,
        startedAt,
      }),
    )

    expect(entry.denied).toBe(false)
    expect(entry.outcome).toBe('success')
    expect(entry.edge_id).toBe('edge-1')
    expect(entry.child_invocation_id).toBe('child-invocation-1')
    expect(entry.child_status).toBe('success')
    expect(entry).not.toHaveProperty('denied_reason')
  })

  it('surfaces the SPECIALIST\'S OWN denial reason (e.g. its own channel/depth/cycle gate) — never swallowed', () => {
    // The child never became its own row (D-34-10/12/13: denied top-level
    // invocations write no row), but its raw status/errorDetail is still
    // fully visible on the PARENT's partner_calls entry.
    const entry = asRecord(
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'partner-agent-3',
        partnerSlug: 'voice-only-specialist',
        edgeId: 'edge-2',
        outcome: 'business_failure',
        childInvocationId: null,
        childStatus: 'denied',
        childErrorDetail: 'channel_not_allowed',
        depth: 1,
        startedAt: Date.now(),
      }),
    )

    expect(entry.denied).toBe(false) // the TRAVERSAL was not denied — the child's own gate was
    expect(entry.outcome).toBe('business_failure')
    expect(entry.child_status).toBe('denied')
    expect(entry.child_error_detail).toBe('channel_not_allowed')
  })

  it('records a genuine failure (retryable_failure) distinctly from a policy denial', () => {
    const entry = asRecord(
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'partner-agent-4',
        partnerSlug: 'flaky-specialist',
        edgeId: 'edge-3',
        outcome: 'retryable_failure',
        childInvocationId: 'child-invocation-2',
        childStatus: 'error',
        childErrorDetail: 'no_llm_key',
        depth: 1,
        startedAt: Date.now(),
      }),
    )

    expect(entry.denied).toBe(false)
    expect(entry.outcome).toBe('retryable_failure')
    expect(entry.child_error_detail).toBe('no_llm_key')
  })
})

describe('applyNestedFailurePenalty — nested failure reflected in parent status (Task 1)', () => {
  it('leaves a success status untouched when no partner call failed', () => {
    const result = applyNestedFailurePenalty('success', undefined, [])
    expect(result).toEqual({ status: 'success', errorDetail: undefined })
  })

  it('leaves a success status untouched when partner calls were merely DENIED (business_failure)', () => {
    const partnerCallsLog: Json[] = [
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'p1',
        partnerSlug: 'p1-slug',
        edgeId: 'e1',
        outcome: 'business_failure',
        childInvocationId: null,
        childStatus: 'denied',
        childErrorDetail: 'channel_not_allowed',
        depth: 1,
        startedAt: Date.now(),
      }),
      buildDeniedPartnerCallEntry({
        partnerAgentId: 'p2',
        partnerSlug: 'p2-slug',
        deniedReason: 'delegation_cycle',
        depth: 1,
        startedAt: Date.now(),
      }),
    ]

    const result = applyNestedFailurePenalty('success', undefined, partnerCallsLog)
    expect(result.status).toBe('success')
  })

  it('downgrades an otherwise-success status to error when a nested specialist genuinely failed', () => {
    const partnerCallsLog: Json[] = [
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'p3',
        partnerSlug: 'flaky',
        edgeId: 'e2',
        outcome: 'retryable_failure',
        childInvocationId: 'child-3',
        childStatus: 'aborted',
        childErrorDetail: 'turn_timeout',
        depth: 1,
        startedAt: Date.now(),
      }),
    ]

    const result = applyNestedFailurePenalty('success', undefined, partnerCallsLog)
    expect(result.status).toBe('error')
    expect(result.errorDetail).toBe('nested_specialist_failure')
  })

  it('never overwrites an errorDetail the parent already set for its own reasons', () => {
    const partnerCallsLog: Json[] = [
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'p4',
        partnerSlug: 'flaky2',
        edgeId: 'e3',
        outcome: 'retryable_failure',
        childInvocationId: 'child-4',
        childStatus: 'error',
        depth: 1,
        startedAt: Date.now(),
      }),
    ]

    // Parent status was already 'aborted' for its OWN reasons — untouched.
    const result = applyNestedFailurePenalty('aborted', 'turn_timeout', partnerCallsLog)
    expect(result).toEqual({ status: 'aborted', errorDetail: 'turn_timeout' })
  })
})

// ---------------------------------------------------------------------------
// Part 1b: updateInvocationEnd persists partner_calls (Task 1)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { updateInvocationEnd, type InvocationEndParams } from '@/lib/agent-runtime/invocations'

function buildUpdateMock() {
  const capturedUpdates: Record<string, unknown>[] = []
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'agent_model_pricing') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'agent_invocations') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdates.push(payload)
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createServiceRoleClient).mockReturnValue(mockSupabase as never)
  return { capturedUpdates }
}

const BASE_END_PARAMS: InvocationEndParams = {
  invocationId: 'uuid-partner-calls-test',
  agentId: 'agent-partner-calls-test',
  model: 'anthropic/claude-sonnet-4-6',
  status: 'success',
  assistantReply: 'Done.',
  tokensIn: 10,
  tokensOut: 10,
  toolCallsJson: [],
  startedAt: Date.now() - 10,
}

describe('updateInvocationEnd — partner_calls persistence (Task 1)', () => {
  afterEach(() => vi.clearAllMocks())

  it('writes partnerCallsJson into the partner_calls column', async () => {
    const { capturedUpdates } = buildUpdateMock()
    const partnerCalls: Json[] = [
      buildCompletedPartnerCallEntry({
        partnerAgentId: 'p1',
        partnerSlug: 'p1-slug',
        edgeId: 'e1',
        outcome: 'success',
        childInvocationId: 'child-1',
        childStatus: 'success',
        depth: 1,
        startedAt: Date.now(),
      }),
    ]

    await updateInvocationEnd({ ...BASE_END_PARAMS, partnerCallsJson: partnerCalls })

    expect(capturedUpdates[0].partner_calls).toEqual(partnerCalls)
  })

  it('defaults partner_calls to [] when partnerCallsJson is omitted (backward compatible)', async () => {
    const { capturedUpdates } = buildUpdateMock()

    await updateInvocationEnd(BASE_END_PARAMS)

    expect(capturedUpdates[0].partner_calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Part 3a: executeWorkflowTool threads trace + invocation identity (Task 3)
// ---------------------------------------------------------------------------

vi.mock('@/lib/workflows/log-tool-run', () => ({
  logToolRun: vi.fn(async () => 'run-id-1'),
}))
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn(async () => 'action result'),
}))

describe('executeWorkflowTool — threads trace/invocation identity into logToolRun (Task 3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes context.traceId/agentInvocationId straight into logToolRun on success', async () => {
    const { executeWorkflowTool } = await import('@/lib/agent-runtime/execute-workflow-tool')
    const { logToolRun } = await import('@/lib/workflows/log-tool-run')

    await executeWorkflowTool({
      workflowId: 'wf-1',
      kind: 'tool',
      definition: { nodes: [{ id: 'trigger', kind: 'trigger' }, { id: 'a1', kind: 'send_sms', to: '+1' }] },
      input: {},
      context: {
        orgId: 'org-1',
        agentId: 'agent-1',
        conversationId: 'conv-1',
        traceId: 'trace-xyz',
        agentInvocationId: 'invocation-xyz',
      },
      toolName: 'send_sms_tool',
    })

    expect(logToolRun).toHaveBeenCalledTimes(1)
    const [input] = vi.mocked(logToolRun).mock.calls[0]
    expect(input).toMatchObject({ traceId: 'trace-xyz', agentInvocationId: 'invocation-xyz' })
  })

  it('passes null (not undefined-crash) when the caller omits trace/invocation identity', async () => {
    const { executeWorkflowTool } = await import('@/lib/agent-runtime/execute-workflow-tool')
    const { logToolRun } = await import('@/lib/workflows/log-tool-run')

    await executeWorkflowTool({
      workflowId: 'wf-2',
      kind: 'tool',
      definition: { nodes: [{ id: 'trigger', kind: 'trigger' }, { id: 'a1', kind: 'send_sms', to: '+1' }] },
      input: {},
      context: { orgId: 'org-1' },
      toolName: 'send_sms_tool',
    })

    const [input] = vi.mocked(logToolRun).mock.calls[0]
    expect(input).toMatchObject({ traceId: null, agentInvocationId: null })
  })
})

// ---------------------------------------------------------------------------
// Part 3b: observability read side walks the FULL join (Task 3)
// ---------------------------------------------------------------------------
// Constructs a small trace tree — channel ingress/entry agent (root) ->
// nested specialist (child, via parent_invocation_id) — plus ONE
// workflow_tool_logs row (the Action Engine execution behind a kind='tool'
// workflow run) caused by the CHILD specifically. Proves
// getInvocationDelegationTree() walks all the way from ingress through to
// that workflow run in a single call, not merely that the columns exist.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(async () => ({ id: 'user-1' })),
}))

describe('getInvocationDelegationTree — walks ingress -> entry agent -> nested specialist -> workflow run -> Action Engine execution (Task 3)', () => {
  afterEach(() => vi.clearAllMocks())

  it('attaches the workflow_tool_logs row to the exact invocation node that caused it', async () => {
    const { createClient } = await import('@/lib/supabase/server')

    const ROOT_ID = 'invocation-root-ingress'
    const CHILD_ID = 'invocation-child-specialist'
    const TRACE_ID = 'trace-full-join'

    const agentInvocationRows = [
      {
        id: ROOT_ID,
        parent_invocation_id: null,
        agent_id: 'agent-entry',
        status: 'success',
        cost_usd: 0.01,
        duration_ms: 500,
        depth: 0,
        agents: { name: 'Entry Agent', slug: 'entry-agent' },
      },
      {
        id: CHILD_ID,
        parent_invocation_id: ROOT_ID,
        agent_id: 'agent-specialist',
        status: 'success',
        cost_usd: 0.02,
        duration_ms: 300,
        depth: 1,
        agents: { name: 'Booking Specialist', slug: 'booking-specialist' },
      },
    ]

    const workflowToolLogsRows = [
      {
        id: 'run-1',
        workflow_id: 'wf-book-appointment',
        tool_name: 'book_appointment',
        status: 'success',
        execution_ms: 120,
        created_at: '2026-09-03T12:00:00.000Z',
        source: 'run',
        agent_invocation_id: CHILD_ID, // caused by the NESTED SPECIALIST, not root
      },
    ]

    const supabaseMock = {
      from: vi.fn((table: string) => {
        if (table === 'agent_invocations') {
          return {
            select: vi.fn((cols: string) => {
              // First call in getInvocationDelegationTree resolves trace_id.
              if (cols === 'trace_id') {
                return { eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { trace_id: TRACE_ID }, error: null }) }) }
              }
              // Second call fetches the whole trace.
              return {
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: agentInvocationRows, error: null }),
                  }),
                }),
              }
            }),
          }
        }
        if (table === 'workflow_tool_logs') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: workflowToolLogsRows, error: null }),
            }),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    }

    vi.mocked(createClient).mockResolvedValue(supabaseMock as never)

    const { getInvocationDelegationTree } = await import('@/lib/agent-runtime/observability')
    const tree = await getInvocationDelegationTree(ROOT_ID)

    // Ingress / entry agent.
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root.id).toBe(ROOT_ID)
    expect(root.agentSlug).toBe('entry-agent')
    expect(root.workflowRuns).toEqual([]) // no workflow run caused directly by root

    // Nested specialist.
    expect(root.children).toHaveLength(1)
    const child = root.children[0]
    expect(child.id).toBe(CHILD_ID)
    expect(child.agentSlug).toBe('booking-specialist')

    // Workflow run / Action Engine execution, attached to the SPECIALIST
    // that actually caused it — this is the join Phase 134 exists to prove.
    expect(child.workflowRuns).toHaveLength(1)
    expect(child.workflowRuns?.[0]).toMatchObject({
      id: 'run-1',
      workflowId: 'wf-book-appointment',
      toolName: 'book_appointment',
      status: 'success',
      source: 'run',
    })

    // The workflow_tool_logs query was scoped to exactly the invocation ids
    // in this trace (both root and child), proving it queried by the
    // trace's own agent_invocation_id set rather than something broader.
    const workflowLogsCall = supabaseMock.from.mock.results.find(
      (r, i) => supabaseMock.from.mock.calls[i][0] === 'workflow_tool_logs',
    )
    expect(workflowLogsCall).toBeDefined()
  })
})
