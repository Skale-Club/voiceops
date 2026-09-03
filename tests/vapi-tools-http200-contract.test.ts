// tests/vapi-tools-http200-contract.test.ts
// Phase 133 Plan 03 (PERF-02, PERF-03) — regression lock on the single
// non-negotiable contract of this route: HTTP 200 on every path, a lean
// body, the Node.js runtime declaration, and deferred logging via after().
//
// Also covers PERF-03: a timeout on a side-effecting action must record
// traceable "abandoned" ownership before the fallback message goes out, so a
// retry cannot treat the slot as free.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

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
vi.mock('@/lib/vapi/verify-signature', () => ({ verifyVapiSecret: (...args: unknown[]) => verifyVapiSecretMock(...args) }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))

const resolveOrgForCallMock = vi.fn(async () => ({ organizationId: 'org-1' }))
vi.mock('@/lib/vapi/end-of-call', () => ({ resolveOrgForCall: (...args: unknown[]) => resolveOrgForCallMock(...args) }))

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn(async (v: string) => v) }))
const logToolRunMock = vi.fn(async () => null)
vi.mock('@/lib/workflows/log-tool-run', () => ({ logToolRun: (...args: unknown[]) => logToolRunMock(...args) }))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
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

import * as routeModule from '@/app/api/vapi/tools/route'
const { POST } = routeModule

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

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://xphere.app/api/vapi/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function validPayload(toolCalls: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>) {
  return {
    message: {
      type: 'tool-calls',
      call: { id: 'call-abc', assistantId: 'assistant-1' },
      toolCallList: toolCalls,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  pendingAfterCallbacks.length = 0
  verifyVapiSecretMock.mockReturnValue(true)
  resolveOrgForCallMock.mockResolvedValue({ organizationId: 'org-1' })
  checkIdempotencyMock.mockResolvedValue({ status: 'fresh' })
})

describe('vapi tools webhook — static contract (PERF-02)', () => {
  it('declares the Node.js runtime', () => {
    expect(routeModule.runtime).toBe('nodejs')
  })

  it('does not gate the response on the logToolRun write completing (deferred via after())', async () => {
    resolveToolMock.mockResolvedValue({ ...SIDE_EFFECTING_TOOL_CONFIG, action_type: 'knowledge_base' })
    executeActionMock.mockResolvedValue('ok')

    let resolveLog: (() => void) | undefined
    logToolRunMock.mockImplementation(
      () => new Promise<null>((resolve) => { resolveLog = () => resolve(null) })
    )

    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'lookup' }])))

    // The response already came back even though the log write's own promise
    // has not been resolved yet — proving the write is not on the response's
    // critical path.
    expect(res.status).toBe(200)
    expect(afterMock).toHaveBeenCalled()
    expect(logToolRunMock).toHaveBeenCalledTimes(1)
    expect(resolveLog).toBeDefined()

    resolveLog?.()
    await flushAfter()
  })

  it('does not hardcode a non-canonical first-party origin anywhere in the route source', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/vapi/tools/route.ts'), 'utf8')
    const hardcodedHosts = source.match(/https?:\/\/[a-zA-Z0-9.-]+/g) ?? []
    for (const host of hardcodedHosts) {
      expect(host.startsWith('https://xphere.app')).toBe(true)
    }
  })
})

describe('vapi tools webhook — HTTP 200 on every path (PERF-02)', () => {
  it('rejected secret', async () => {
    verifyVapiSecretMock.mockReturnValue(false)
    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'x' }])))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBeTruthy()
  })

  it('malformed JSON', async () => {
    const res = await POST(buildRequest('{not-json'))
    expect(res.status).toBe(200)
  })

  it('schema-parse failure', async () => {
    const res = await POST(buildRequest({ message: { type: 'tool-calls' } }))
    expect(res.status).toBe(200)
  })

  it('unresolvable org', async () => {
    resolveOrgForCallMock.mockResolvedValue({ organizationId: null })
    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'x' }])))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    expect(body.results[0].toolCallId).toBe('tc-1')
  })

  it('unconfigured tool', async () => {
    resolveToolMock.mockResolvedValue(null)
    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'x' }])))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    expect(body.results[0].result).toBe('Tool not configured.')
  })

  it('executor throw (non-timeout)', async () => {
    resolveToolMock.mockResolvedValue({ ...SIDE_EFFECTING_TOOL_CONFIG, action_type: 'knowledge_base' })
    executeActionMock.mockRejectedValue(new Error('provider exploded'))
    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'x' }])))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    expect(body.results[0].result).toBe(SIDE_EFFECTING_TOOL_CONFIG.fallback_message)
  })

  it('timeout on a side-effecting action still returns 200 AND records abandoned ownership before the fallback goes out', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    executeActionMock.mockRejectedValue(abortErr)

    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'book_appointment', arguments: { time: '3pm' } }])))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    expect(body.results[0].result).toBe(SIDE_EFFECTING_TOOL_CONFIG.fallback_message)

    expect(recordAbandonedIdempotencyMock).toHaveBeenCalledTimes(1)
    // recordIdempotency (success path) must never also fire for the same call.
    expect(recordIdempotencyMock).not.toHaveBeenCalled()
  })

  it('timeout on a read (no idempotency needed) does not attempt to record abandoned ownership', async () => {
    resolveToolMock.mockResolvedValue({ ...SIDE_EFFECTING_TOOL_CONFIG, action_type: 'knowledge_base' })
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    executeActionMock.mockRejectedValue(abortErr)

    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'x' }])))
    expect(res.status).toBe(200)
    expect(recordAbandonedIdempotencyMock).not.toHaveBeenCalled()
  })

  it('idempotency conflict', async () => {
    resolveToolMock.mockResolvedValue(SIDE_EFFECTING_TOOL_CONFIG)
    checkIdempotencyMock.mockResolvedValue({ status: 'conflict' })
    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'book_appointment', arguments: {} }])))
    expect(res.status).toBe(200)
    expect(executeActionMock).not.toHaveBeenCalled()
  })

  it('unexpected outer error', async () => {
    resolveOrgForCallMock.mockRejectedValue(new Error('db is on fire'))
    const res = await POST(buildRequest(validPayload([{ id: 'tc-1', name: 'x' }])))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ toolCallId: string; result: string }> }
    expect(body.results).toHaveLength(1)
  })
})
