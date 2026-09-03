// tests/vapi-tools-idempotency.test.ts
// Phase 133 Plan 03 (SAFE-02) — the Vapi tool webhook must guard
// side-effecting executions with the ingress-scoped idempotency key from
// Wave 1 (src/lib/agent-runtime/idempotency.ts), keyed on the ALREADY
// VERIFIED call.id + toolCall.id — never on tool arguments or model output.
//
// Reads (e.g. knowledge_base) must not pay for the guard at all: no
// checkIdempotency call, no extra latency, no chance of being blocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- next/server after() — capture + flush like the other webhook suites ----
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
vi.mock('@/lib/workflows/log-tool-run', () => ({ logToolRun: vi.fn(async () => null) }))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

const resolveToolMock = vi.fn()
vi.mock('@/lib/action-engine/resolve-tool', () => ({
  resolveTool: (...args: unknown[]) => resolveToolMock(...args),
}))

const executeActionMock = vi.fn()
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: (...args: unknown[]) => executeActionMock(...args),
}))

// Keep the REAL requiresIdempotency / deriveIngressIdempotencyKey / hashToolArgs
// (already covered by tests/idempotency-ingress-key.test.ts) — only stub the
// DB-touching functions so we control fresh/replay/conflict/abandoned outcomes.
const checkIdempotencyMock = vi.fn()
const recordIdempotencyMock = vi.fn()
const recordAbandonedIdempotencyMock = vi.fn()
vi.mock('@/lib/agent-runtime/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()
  return {
    ...actual,
    checkIdempotency: (...args: unknown[]) => checkIdempotencyMock(...args),
    recordIdempotency: (...args: unknown[]) => recordIdempotencyMock(...args),
    recordAbandonedIdempotency: (...args: unknown[]) => recordAbandonedIdempotencyMock(...args),
  }
})

import { POST } from '@/app/api/vapi/tools/route'

const SIDE_EFFECTING_TOOL_CONFIG = {
  id: 'tc-1',
  workflow_id: 'wf-1',
  organization_id: 'org-1',
  integration_id: 'int-1',
  tool_name: 'book_appointment',
  action_type: 'create_appointment' as const,
  config: {},
  fallback_message: 'Sorry, please try again.',
  is_active: true,
  integrations: null,
}

const READ_TOOL_CONFIG = {
  id: 'tc-2',
  workflow_id: 'wf-2',
  organization_id: 'org-1',
  integration_id: 'int-2',
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
  checkIdempotencyMock.mockReset()
  recordIdempotencyMock.mockReset()
  recordAbandonedIdempotencyMock.mockReset()
})

describe('vapi tools webhook — idempotency guard (SAFE-02)', () => {
  it('checks idempotency on a fresh key, executes once, and records the result', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    checkIdempotencyMock.mockResolvedValue({ status: 'fresh' })
    executeActionMock.mockResolvedValue('Booked for 3pm.')

    const res = await POST(buildRequest([{ id: 'tool-call-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([{ toolCallId: 'tool-call-1', result: 'Booked for 3pm.' }])
    expect(executeActionMock).toHaveBeenCalledTimes(1)
    expect(checkIdempotencyMock).toHaveBeenCalledTimes(1)

    // Keyed on the trusted call.id + toolCall.id — never on tool arguments.
    const [orgId, key] = checkIdempotencyMock.mock.calls[0] as [string, string, string]
    expect(orgId).toBe('org-1')
    expect(typeof key).toBe('string')
    expect(key).not.toContain('3pm')

    expect(recordIdempotencyMock).toHaveBeenCalledTimes(1)
    const recordArgs = recordIdempotencyMock.mock.calls[0][0] as { idempotencyKey: string; response: string }
    expect(recordArgs.idempotencyKey).toBe(key)
    expect(recordArgs.response).toBe('Booked for 3pm.')
  })

  it('derives the same idempotency key for the same call.id + toolCall.id regardless of arguments', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    checkIdempotencyMock.mockResolvedValue({ status: 'fresh' })
    executeActionMock.mockResolvedValue('ok')

    await POST(buildRequest([{ id: 'tool-call-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const key1 = checkIdempotencyMock.mock.calls[0][1] as string
    checkIdempotencyMock.mockClear()

    await POST(buildRequest([{ id: 'tool-call-1', name: 'book_appointment', arguments: { time: '4pm' } }]))
    const key2 = checkIdempotencyMock.mock.calls[0][1] as string

    expect(key1).toBe(key2)
  })

  it('replay: returns the originally recorded result WITHOUT re-executing', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    checkIdempotencyMock.mockResolvedValue({ status: 'replay', response: 'Booked for 3pm. (original)' })

    const res = await POST(buildRequest([{ id: 'tool-call-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([{ toolCallId: 'tool-call-1', result: 'Booked for 3pm. (original)' }])
    expect(executeActionMock).not.toHaveBeenCalled()
    expect(recordIdempotencyMock).not.toHaveBeenCalled()
  })

  it('conflict: returns a distinct channel-safe result, never the original response', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    checkIdempotencyMock.mockResolvedValue({ status: 'conflict' })

    const res = await POST(buildRequest([{ id: 'tool-call-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].toolCallId).toBe('tool-call-1')
    expect(body.results[0].result).not.toBe('Booked for 3pm.')
    expect(body.results[0].result.toLowerCase()).toContain('conflict')
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  it('abandoned: is neither a free slot (re-executed) nor treated as success', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    checkIdempotencyMock.mockResolvedValue({ status: 'abandoned' })

    const res = await POST(buildRequest([{ id: 'tool-call-1', name: 'book_appointment', arguments: { time: '3pm' } }]))
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }

    expect(res.status).toBe(200)
    expect(executeActionMock).not.toHaveBeenCalled()
    expect(body.results[0].result).not.toBe('Booked for 3pm.')
    // Must be distinguishable from the conflict message.
    expect(body.results[0].result.toLowerCase()).not.toContain('conflict')
  })

  it('reads (requiresIdempotency = false) never call checkIdempotency and are never blocked', async () => {
    resolveToolMock.mockResolvedValue(READ_TOOL_CONFIG)
    executeActionMock.mockResolvedValue('Our hours are 9-5.')

    const res = await POST(buildRequest([{ id: 'tool-call-1', name: 'lookup_faq', arguments: { q: 'hours' } }]))
    const body = await res.json() as { results: Array<{ toolCallId: string; result: string }> }
    await flushAfter()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([{ toolCallId: 'tool-call-1', result: 'Our hours are 9-5.' }])
    expect(checkIdempotencyMock).not.toHaveBeenCalled()
    expect(recordIdempotencyMock).not.toHaveBeenCalled()
    expect(executeActionMock).toHaveBeenCalledTimes(1)
  })
})
