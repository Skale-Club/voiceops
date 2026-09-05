// tests/vapi-tools-multicall.test.ts
// Phase 133 Plan 03 (OBS-03) — a multi-call Vapi payload must never silently
// truncate to the first call. Every supported call gets one matching result,
// and one call's failure must not suppress the others.

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const logToolRunMock = vi.fn(async () => null)
vi.mock('@/lib/workflows/log-tool-run', () => ({ logToolRun: (...args: unknown[]) => logToolRunMock(...args) }))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

vi.mock('@/lib/agent-runtime/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()
  return {
    ...actual,
    checkIdempotency: vi.fn(async () => ({ status: 'fresh' as const })),
    recordIdempotency: vi.fn(async () => undefined),
    recordAbandonedIdempotency: vi.fn(async () => undefined),
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

import { POST } from '@/app/api/vapi/tools/route'

function toolConfigFor(name: string, actionType: string) {
  return {
    id: `tc-${name}`,
    workflow_id: `wf-${name}`,
    organization_id: 'org-1',
    integration_id: `int-${name}`,
    tool_name: name,
    action_type: actionType,
    config: {},
    fallback_message: 'Sorry, please try again.',
    is_active: true,
    integrations: null,
  }
}

function buildRequest(toolCalls: unknown[]) {
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
})

describe('vapi tools webhook — multi-call payload (OBS-03)', () => {
  it('executes every call and returns one result per call with matching ids', async () => {
    resolveToolMock.mockImplementation(async (_orgId: string, name: string) => toolConfigFor(name, 'knowledge_base'))
    executeActionMock.mockImplementation(async (actionType: string) => `result-for-${actionType}`)

    const res = await POST(
      buildRequest([
        { id: 'tc-1', name: 'lookup_hours' },
        { id: 'tc-2', name: 'lookup_pricing' },
        { id: 'tc-3', name: 'lookup_location' },
      ])
    )
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(3)
    expect(body.results.map((r) => r.toolCallId)).toEqual(['tc-1', 'tc-2', 'tc-3'])
    expect(executeActionMock).toHaveBeenCalledTimes(3)
    // Every call gets logged, not just the first.
    expect(logToolRunMock).toHaveBeenCalledTimes(3)
  })

  it('isolates a per-call failure: one throwing call does not suppress the others', async () => {
    resolveToolMock.mockImplementation(async (_orgId: string, name: string) => toolConfigFor(name, 'create_appointment'))
    executeActionMock.mockImplementation(async (_actionType: string, args: Record<string, unknown>) => {
      if (args.fail) throw new Error('boom')
      return 'ok-result'
    })

    const res = await POST(
      buildRequest([
        { id: 'tc-1', name: 'book_a', arguments: { fail: true } },
        { id: 'tc-2', name: 'book_b', arguments: {} },
      ])
    )
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.results[0].toolCallId).toBe('tc-1')
    expect(body.results[1]).toEqual({ toolCallId: 'tc-2', result: 'ok-result' })
    // The failing call got its own fallback, not an empty/dropped result.
    expect(body.results[0].result.length).toBeGreaterThan(0)
  })

  it('an unconfigured tool in a multi-call payload gets its own result; siblings still execute', async () => {
    resolveToolMock.mockImplementation(async (_orgId: string, name: string) => {
      if (name === 'missing_tool') return null
      return toolConfigFor(name, 'knowledge_base')
    })
    executeActionMock.mockResolvedValue('ok')

    const res = await POST(
      buildRequest([
        { id: 'tc-1', name: 'missing_tool' },
        { id: 'tc-2', name: 'lookup_hours' },
      ])
    )
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.results[0]).toEqual({ toolCallId: 'tc-1', result: 'Tool not configured.' })
    expect(body.results[1]).toEqual({ toolCallId: 'tc-2', result: 'ok' })
  })

  it('single-call payloads (the common case) still return exactly one result', async () => {
    resolveToolMock.mockResolvedValue(toolConfigFor('lookup_hours', 'knowledge_base'))
    executeActionMock.mockResolvedValue('9-5')

    const res = await POST(buildRequest([{ id: 'tc-1', name: 'lookup_hours' }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }

    expect(body.results).toEqual([{ toolCallId: 'tc-1', result: '9-5' }])
  })

  it('executes the nested OpenAI-style shape and returns the matching toolCallId', async () => {
    resolveToolMock.mockResolvedValue(toolConfigFor('check_availability', 'xkedule_check_availability'))
    executeActionMock.mockResolvedValue('09:00, 10:30, or 14:15')

    const res = await POST(buildRequest([{
      id: 'toolu-live-shape',
      type: 'function',
      function: {
        name: 'check_availability',
        arguments: JSON.stringify({ serviceIds: [333], startDate: '2026-09-05' }),
      },
    }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }

    expect(body.results).toEqual([{
      toolCallId: 'toolu-live-shape',
      result: '09:00, 10:30, or 14:15',
    }])
    expect(executeActionMock).toHaveBeenCalledWith(
      'xkedule_check_availability',
      { serviceIds: [333], startDate: '2026-09-05' },
      expect.any(Object),
      expect.objectContaining({ organizationId: 'org-1' }),
    )
  })

  it('returns a correlated error and does not execute when nested arguments are malformed', async () => {
    const res = await POST(buildRequest([{
      id: 'toolu-bad-args',
      type: 'function',
      function: { name: 'book_appointment', arguments: '{not-json' },
    }]))
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }

    expect(body.results).toHaveLength(1)
    expect(body.results[0].toolCallId).toBe('toolu-bad-args')
    expect(body.results[0].result).toMatch(/could not read/i)
    expect(resolveToolMock).not.toHaveBeenCalled()
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  it('passes conversation evidence only from the verified envelope, not tool arguments', async () => {
    resolveToolMock.mockResolvedValue(toolConfigFor('book_appointment', 'xkedule_create_booking'))
    executeActionMock.mockResolvedValue('NOT BOOKED YET')
    const artifact = { messages: [{ role: 'bot', message: 'Still Test Caller?' }, { role: 'user', message: 'yes' }] }
    await POST(new Request('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      message: { type: 'tool-calls', call: { id: 'call-evidence', assistantId: 'assistant-1' }, artifact,
        toolCallList: [{ id: 'tc-evidence', name: 'book_appointment', arguments: { voiceBooking: { callId: 'forged' } } }] },
    }) }))
    expect(executeActionMock.mock.calls[0][3].voiceBooking).toEqual({ callId: 'call-evidence', messages: [
      { role: 'assistant', content: 'Still Test Caller?' }, { role: 'user', content: 'yes' },
    ] })
  })
})
