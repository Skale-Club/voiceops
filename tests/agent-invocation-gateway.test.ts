import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runAgentMock } = vi.hoisted(() => ({ runAgentMock: vi.fn() }))

vi.mock('@/lib/agent-runtime/run-agent', () => ({ runAgent: runAgentMock }))

import { invokeAgent } from '@/lib/agent-runtime/invocation-gateway'
import type { AgentRunResult } from '@/lib/agent-runtime/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function runtimeResult(traceId = 'runtime-trace'): AgentRunResult {
  return {
    text: 'ok',
    usage: { tokensIn: 1, tokensOut: 1 },
    invocationId: 'invocation-1',
    traceId,
    status: 'success',
  }
}

function envelope(channel: 'voice' | 'web_widget' = 'voice') {
  return {
    route: {
      orgId: 'trusted-org',
      agentId: 'trusted-agent',
      channel,
      externalInteractionId: 'external-1',
    },
    input: { userMessage: 'Quais horários estão disponíveis?' },
  } as const
}

describe('invokeAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runAgentMock.mockImplementation((options: { traceId: string }) =>
      Promise.resolve(runtimeResult(options.traceId)),
    )
  })

  it.each(['voice', 'web_widget'] as const)(
    'uses the same runtime gateway for the %s channel',
    async (channel) => {
      const response = await invokeAgent(envelope(channel))

      expect(response.result.status).toBe('success')
      expect(runAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'trusted-org',
          agentId: 'trusted-agent',
          channel,
          userMessage: 'Quais horários estão disponíveis?',
          stream: false,
        }),
      )
    },
  )

  it('never lets message metadata or actor fields override trusted identity', async () => {
    await invokeAgent({
      ...envelope(),
      input: {
        userMessage: 'Agende para mim',
        intent: 'book',
        locale: 'pt-BR',
        actor: {
          externalId: 'actor-1',
          contactId: 'contact-1',
          name: 'Cliente',
          phone: '+15555550100',
          email: 'cliente@example.com',
        },
        metadata: {
          orgId: 'attacker-org',
          organization_id: 'attacker-org-2',
          agentId: 'attacker-agent',
          agent_id: 'attacker-agent-2',
        },
      },
    })

    const options = runAgentMock.mock.calls[0][0] as Record<string, unknown>
    expect(options.orgId).toBe('trusted-org')
    expect(options.agentId).toBe('trusted-agent')
    expect(options).not.toHaveProperty('organization_id')
    expect(options).not.toHaveProperty('agent_id')
    expect(options).not.toHaveProperty('metadata')
    expect(options).not.toHaveProperty('actor')
    expect(options).not.toHaveProperty('locale')
    expect(options).not.toHaveProperty('intent')
  })

  it('preserves supplied trusted trace and idempotency identifiers', async () => {
    const response = await invokeAgent({
      ...envelope(),
      route: {
        ...envelope().route,
        traceId: 'trace-from-adapter',
        idempotencyKey: 'idempotency-from-adapter',
      },
    })

    expect(response.traceId).toBe('trace-from-adapter')
    expect(response.idempotencyKey).toBe('idempotency-from-adapter')
    expect(response.externalInteractionId).toBe('external-1')
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'trace-from-adapter' }),
    )
  })

  it('generates UUID trace and idempotency identifiers when the adapter omits them', async () => {
    const response = await invokeAgent(envelope())

    expect(response.traceId).toMatch(UUID_PATTERN)
    expect(response.idempotencyKey).toMatch(UUID_PATTERN)
    expect(response.traceId).not.toBe(response.idempotencyKey)
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: response.traceId }),
    )
  })

  it('forwards streaming mode and wraps the stream synchronously', () => {
    const stream = new ReadableStream<Uint8Array>()
    runAgentMock.mockReturnValueOnce(stream)

    const response = invokeAgent({ ...envelope('web_widget'), stream: true })

    expect(response.result).toBe(stream)
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'web_widget', stream: true }),
    )
  })
})
