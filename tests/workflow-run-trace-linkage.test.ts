// tests/workflow-run-trace-linkage.test.ts
// Phase 134 Plan 01 (OBS-01) — workflow_runs has no way to join back to the
// agent_invocations row (and its trace_id) that caused it. Migration 1292
// adds nullable trace_id + agent_invocation_id columns; logToolRun() and the
// Vapi tools webhook carry the identity through.
//
// Migration 1292 is authored but MUST NOT be applied (134-CONTEXT.md
// "Human/Production Boundary") — these tests validate the SQL text
// structurally rather than against a live database.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/1292_workflow_run_trace_linkage.sql',
)

describe('migration 1292 — workflow_runs trace linkage (structural)', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')

  it('adds trace_id and agent_invocation_id as nullable columns (no NOT NULL, no backfill)', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS trace_id\s+UUID\s*[,;]?\s*$/m)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS agent_invocation_id\s+UUID\s*[,;]?\s*$/m)

    // Neither new column line carries a NOT NULL modifier.
    const traceLine = sql.match(/^.*trace_id\s+UUID.*$/m)?.[0] ?? ''
    const invocationLine = sql.match(/^.*agent_invocation_id\s+UUID.*$/m)?.[0] ?? ''
    expect(traceLine.toUpperCase()).not.toContain('NOT NULL')
    expect(invocationLine.toUpperCase()).not.toContain('NOT NULL')

    // No UPDATE statement backfilling either column from existing rows.
    expect(sql).not.toMatch(/UPDATE\s+public\.workflow_runs/i)
  })

  it('constrains agent_invocation_id to the SAME organization via a composite FK', () => {
    expect(sql).toContain(
      'FOREIGN KEY (org_id, agent_invocation_id)',
    )
    expect(sql).toContain(
      'REFERENCES public.agent_invocations(organization_id, id)',
    )
  })

  it('behaves safely if the invocation row is removed (ON DELETE SET NULL, not CASCADE/RESTRICT)', () => {
    const fkBlock = sql.slice(
      sql.indexOf('FOREIGN KEY (org_id, agent_invocation_id)'),
      sql.indexOf('FOREIGN KEY (org_id, agent_invocation_id)') + 300,
    )
    expect(fkBlock).toContain('ON DELETE SET NULL')
    expect(fkBlock).not.toContain('ON DELETE CASCADE')
  })

  it('indexes both columns for the joins they exist to serve', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \w+\s+ON public\.workflow_runs \(trace_id\)/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \w+\s+ON public\.workflow_runs \(agent_invocation_id\)/)
  })

  it('is idempotent: every ALTER/CREATE INDEX/ADD CONSTRAINT is guarded', () => {
    // Every ALTER TABLE ... ADD COLUMN uses IF NOT EXISTS.
    const addColumnLines = sql.match(/ALTER TABLE .*\n(\s*ADD COLUMN[^\n]*\n?)+/gi) ?? []
    for (const block of addColumnLines) {
      const columnAdds = block.match(/ADD COLUMN\s+(IF NOT EXISTS)?/gi) ?? []
      for (const clause of columnAdds) {
        expect(clause.toUpperCase()).toContain('IF NOT EXISTS')
      }
    }

    // Every CREATE INDEX uses IF NOT EXISTS.
    const createIndexes = sql.match(/CREATE INDEX\s+(IF NOT EXISTS)?/gi) ?? []
    expect(createIndexes.length).toBeGreaterThan(0)
    for (const clause of createIndexes) {
      expect(clause.toUpperCase()).toContain('IF NOT EXISTS')
    }

    // New constraints are wrapped in a pg_constraint existence guard, not a
    // bare ADD CONSTRAINT that would fail on re-run.
    expect(sql).toMatch(/FROM pg_constraint/)
  })

  it('must not be applied — no db push / apply_migration invocation anywhere in the repo tooling for this file', () => {
    // Sanity: the migration file itself contains no self-executing directive.
    expect(sql).not.toMatch(/\\i\s/)
  })
})

// ---------------------------------------------------------------------------
// logToolRun — widened, backward-compatible input
// ---------------------------------------------------------------------------

function buildSupabaseMock(insertResult: { data: unknown; error: unknown }) {
  const insertMock = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => insertResult),
    })),
  }))
  const fromMock = vi.fn(() => ({ insert: insertMock }))
  return { from: fromMock, insertMock }
}

describe('logToolRun — trace + agent invocation linkage (OBS-01)', () => {
  let logToolRun: typeof import('@/lib/workflows/log-tool-run').logToolRun

  beforeEach(async () => {
    // The module is mocked further below (for the route tests in this same
    // file) — vi.mock is hoisted and file-scoped, so a plain dynamic import
    // here would resolve to that mock. Bypass it to exercise the REAL
    // implementation.
    const actual = await vi.importActual<typeof import('@/lib/workflows/log-tool-run')>(
      '@/lib/workflows/log-tool-run',
    )
    logToolRun = actual.logToolRun
  })

  it('existing callers (no traceId/agentInvocationId) keep compiling and behave identically: both columns null', async () => {
    const { from, insertMock } = buildSupabaseMock({ data: { id: 'run-1' }, error: null })

    const id = await logToolRun(
      {
        orgId: 'org-1',
        workflowId: 'wf-1',
        toolName: 'lookup_faq',
        triggerType: 'manychat',
        vapiCallId: 'manychat:evt-1',
        status: 'success',
        executionMs: 42,
        requestPayload: {},
        responsePayload: { result: 'ok' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { from } as any,
    )

    expect(id).toBe('run-1')
    const insertedRow = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(insertedRow.trace_id).toBeNull()
    expect(insertedRow.agent_invocation_id).toBeNull()
  })

  it('persists a provided traceId and agentInvocationId into the correct columns', async () => {
    const { from, insertMock } = buildSupabaseMock({ data: { id: 'run-2' }, error: null })

    await logToolRun(
      {
        orgId: 'org-1',
        workflowId: 'wf-1',
        toolName: 'book_appointment',
        triggerType: 'agent',
        vapiCallId: null,
        status: 'success',
        executionMs: 10,
        requestPayload: {},
        responsePayload: { result: 'ok' },
        traceId: 'trace-abc-123',
        agentInvocationId: 'invocation-xyz-789',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { from } as any,
    )

    const insertedRow = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(insertedRow.trace_id).toBe('trace-abc-123')
    expect(insertedRow.agent_invocation_id).toBe('invocation-xyz-789')
  })

  it('remains best-effort: a DB error still returns null rather than throwing', async () => {
    const { from } = buildSupabaseMock({ data: null, error: new Error('boom') })

    const id = await logToolRun(
      {
        orgId: 'org-1',
        workflowId: 'wf-1',
        toolName: null,
        triggerType: 'vapi',
        vapiCallId: 'call-1',
        status: 'error',
        executionMs: 5,
        requestPayload: {},
        responsePayload: {},
        traceId: 'trace-1',
        agentInvocationId: null,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { from } as any,
    )

    expect(id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// /api/vapi/tools — carries the identity through without disturbing the
// Phase 133 HTTP 200 / idempotency / per-call isolation contract.
// ---------------------------------------------------------------------------

const pendingAfterCallbacks: Array<Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    const result = fn()
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      pendingAfterCallbacks.push(result as Promise<unknown>)
    }
  }),
}))
async function flushAfter(): Promise<void> {
  while (pendingAfterCallbacks.length > 0) {
    const next = pendingAfterCallbacks.shift()
    if (next) await next
  }
}

vi.mock('@/lib/vapi/verify-signature', () => ({ verifyVapiSecret: vi.fn(() => true) }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/vapi/end-of-call', () => ({
  resolveOrgForCall: vi.fn(async () => ({ organizationId: 'org-1' })),
}))
vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn(async (v: string) => v) }))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

const logToolRunMock = vi.fn(async () => 'run-id')
vi.mock('@/lib/workflows/log-tool-run', () => ({
  logToolRun: (...args: unknown[]) => logToolRunMock(...args),
}))

const resolveToolMock = vi.fn()
vi.mock('@/lib/action-engine/resolve-tool', () => ({
  resolveTool: (...args: unknown[]) => resolveToolMock(...args),
}))

const executeActionMock = vi.fn()
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: (...args: unknown[]) => executeActionMock(...args),
}))

vi.mock('@/lib/agent-runtime/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()
  return {
    ...actual,
    checkIdempotency: vi.fn(async () => ({ status: 'fresh' })),
    recordIdempotency: vi.fn(async () => undefined),
    recordAbandonedIdempotency: vi.fn(async () => undefined),
  }
})

import { POST } from '@/app/api/vapi/tools/route'

const READ_TOOL_CONFIG = {
  id: 'tc-1',
  workflow_id: 'wf-1',
  organization_id: 'org-1',
  integration_id: 'int-1',
  tool_name: 'lookup_faq',
  action_type: 'knowledge_base' as const,
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

beforeEach(() => {
  vi.clearAllMocks()
  pendingAfterCallbacks.length = 0
  resolveToolMock.mockReset()
  executeActionMock.mockReset()
  logToolRunMock.mockClear()
})

describe('vapi tools webhook — trace linkage (OBS-01)', () => {
  it('keeps returning HTTP 200 and the same result shape', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    executeActionMock.mockResolvedValue('Our hours are 9-5.')

    const res = await POST(buildRequest([{ id: 'tool-call-1', name: 'lookup_faq' }]))
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([{ toolCallId: 'tool-call-1', result: 'Our hours are 9-5.' }])
  })

  it('calls logToolRun with explicit null trace/invocation identity — this route never creates an agent invocation', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    executeActionMock.mockResolvedValue('Our hours are 9-5.')

    await POST(buildRequest([{ id: 'tool-call-1', name: 'lookup_faq' }]))
    await flushAfter()

    expect(logToolRunMock).toHaveBeenCalledTimes(1)
    const [input] = logToolRunMock.mock.calls[0] as [Record<string, unknown>]
    expect(input).toHaveProperty('traceId', null)
    expect(input).toHaveProperty('agentInvocationId', null)
    // Existing fields untouched.
    expect(input.orgId).toBe('org-1')
    expect(input.vapiCallId).toBe('call-abc')
  })

  it('per-call isolation: one call still gets its own result independent of the others', async () => {
    resolveToolMock.mockImplementation(async (_orgId: string, name: string) =>
      name === 'lookup_faq' ? READ_TOOL_CONFIG : null,
    )
    executeActionMock.mockResolvedValue('Our hours are 9-5.')

    const res = await POST(
      buildRequest([
        { id: 'tool-call-1', name: 'lookup_faq' },
        { id: 'tool-call-2', name: 'unknown_tool' },
      ]),
    )
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.results.find((r) => r.toolCallId === 'tool-call-1')?.result).toBe('Our hours are 9-5.')
    expect(body.results.find((r) => r.toolCallId === 'tool-call-2')?.result).toBe('Tool not configured.')
  })
})
