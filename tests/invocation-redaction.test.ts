// tests/invocation-redaction.test.ts
// Phase 134 Plan 03 (OBS-02) — Task 2.
//
// Redaction happens BEFORE an observability row is written, never as a
// display-time filter: invocations.ts calls redact.ts inside
// insertInvocationStart() (user_message) and updateInvocationEnd()
// (assistant_reply, tool_calls, partner_calls) — never in a read path.
// This does not touch src/lib/crypto.ts or any encryption format.

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Json } from '@/types/database'
import { redactText, redactJson } from '@/lib/agent-runtime/redact'

// ---------------------------------------------------------------------------
// Part A: redact.ts — pure unit tests against realistic payloads
// ---------------------------------------------------------------------------

describe('redactText — free-text fields (user_message, assistant_reply)', () => {
  it('redacts an xph_ public API key embedded in natural language', () => {
    const text = `Here is my key: xph_${'a'.repeat(64)} please use it.`
    const out = redactText(text)
    expect(out).not.toContain('xph_')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts a Bearer token copy-pasted by a user into a chat message', () => {
    const text = 'my Authorization header is Bearer sk-live-abcdef1234567890 can you check it'
    const out = redactText(text)
    expect(out).not.toMatch(/Bearer\s+sk-live-abcdef1234567890/)
  })

  it('redacts an email address (personal data)', () => {
    const text = 'You can reach me at jane.doe@example.com for follow-up.'
    const out = redactText(text)
    expect(out).not.toContain('jane.doe@example.com')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts a payment card number typed into the chat', () => {
    const text = 'My card is 4111 1111 1111 1111, please charge it.'
    const out = redactText(text)
    expect(out).not.toContain('4111 1111 1111 1111')
  })

  it('leaves ordinary business text completely untouched', () => {
    const text = 'I would like to book an appointment for tomorrow at 3pm, order #A1029.'
    expect(redactText(text)).toBe(text)
  })

  it('does not mangle a UUID-shaped trace/invocation id', () => {
    const text = 'trace-inv-00000000-0000-0000-0000-000000000001'
    expect(redactText(text)).toBe(text)
  })

  it('does not mangle an ISO timestamp', () => {
    const text = 'started_at=2026-09-03T12:34:56.789Z'
    expect(redactText(text)).toBe(text)
  })
})

describe('redactJson — structured fields (tool_calls, partner_calls), including nested structures', () => {
  it('redacts a sensitive-named key regardless of nesting depth', () => {
    const payload = {
      name: 'custom_webhook',
      args: {
        headers: { Authorization: 'Bearer real-secret-value-here' },
        body: { nested: { api_key: 'super-secret' } },
      },
      denied: false,
    } as unknown as Json

    const out = redactJson(payload) as unknown as Record<string, unknown>
    const args = out.args as Record<string, unknown>
    const headers = args.headers as Record<string, unknown>
    const body = args.body as Record<string, unknown>
    const nested = body.nested as Record<string, unknown>

    expect(headers.Authorization).toBe('[REDACTED]')
    expect(nested.api_key).toBe('[REDACTED]')
    // Structural fields are untouched.
    expect(out.name).toBe('custom_webhook')
    expect(out.denied).toBe(false)
  })

  it('redacts a sensitive-named "credentials" object nested inside an array of objects', () => {
    // The key "credentials" is itself sensitive, so the WHOLE value at that
    // key is replaced (broader — never partially redacted down to just the
    // nested password field, which would risk missing sibling secrets).
    const payload = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'sure', credentials: { password: 'hunter2' } },
    ] as unknown as Json

    const out = redactJson(payload) as unknown as Array<Record<string, unknown>>
    expect(out[1].credentials).toBe('[REDACTED]')
    expect(out[0].content).toBe('hello')
  })

  it('redacts a password field nested two levels deep under a non-sensitive parent key', () => {
    const payload = {
      name: 'create_contact',
      args: { auth: { password: 'hunter2' } },
    } as unknown as Json

    const out = redactJson(payload) as unknown as Record<string, unknown>
    // "auth" is itself sensitive too — whole value redacted.
    expect(out.args as unknown).toEqual({ auth: '[REDACTED]' })
  })

  it('redacts credential-shaped VALUES even under an innocuous key name', () => {
    const payload = {
      name: 'lookup_faq',
      result: 'here is your token: xph_' + 'b'.repeat(64) + ' — save it',
    } as unknown as Json

    const out = redactJson(payload) as unknown as Record<string, unknown>
    expect(out.result).not.toContain('xph_')
    expect(out.result).toContain('[REDACTED]')
  })

  it('redacts extracted_params PII inside a partner_calls-shaped handoff payload', () => {
    const payload = {
      partner_agent_id: 'p1',
      partner_slug: 'booking-specialist',
      denied: false,
      handoff: {
        extracted_params: { email: 'customer@example.com', preferred_time: 'morning' },
      },
    } as unknown as Json

    const out = redactJson(payload) as unknown as Record<string, unknown>
    const handoff = out.handoff as Record<string, unknown>
    const params = handoff.extracted_params as Record<string, unknown>
    expect(params.email).toBe('[REDACTED]')
    expect(params.preferred_time).toBe('morning')
  })

  it('leaves ids, timestamps, statuses, and denial reasons completely untouched', () => {
    const payload = {
      partner_agent_id: 'partner-agent-1',
      partner_slug: 'booking-specialist',
      edge_id: 'edge-1',
      denied: true,
      denied_reason: 'delegation_cycle',
      child_invocation_id: 'invocation-abc-123',
      started_at: '2026-09-03T12:00:00.000Z',
      depth: 1,
    } as unknown as Json

    expect(redactJson(payload)).toEqual(payload)
  })

  it('is idempotent — redacting an already-redacted value is a no-op', () => {
    const payload = { api_key: 'sk-should-be-gone-1234567890' } as unknown as Json
    const once = redactJson(payload)
    const twice = redactJson(once)
    expect(twice).toEqual(once)
  })
})

// ---------------------------------------------------------------------------
// Part B: invocations.ts applies redaction BEFORE the row is written
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  insertInvocationStart,
  updateInvocationEnd,
  type InvocationStartParams,
  type InvocationEndParams,
} from '@/lib/agent-runtime/invocations'

function buildInsertMock() {
  const capturedInserts: Record<string, unknown>[] = []
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'agent_invocations') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            capturedInserts.push(payload)
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null }),
              }),
            }
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createServiceRoleClient).mockReturnValue(mockSupabase as never)
  return { capturedInserts }
}

function buildUpdateMock() {
  const capturedUpdates: Record<string, unknown>[] = []
  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'agent_model_pricing') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
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

describe('insertInvocationStart — redacts user_message before the INSERT', () => {
  afterEach(() => vi.clearAllMocks())

  const BASE_START_PARAMS: InvocationStartParams = {
    organizationId: 'org-1',
    agentId: 'agent-1',
    traceId: 'trace-redaction-test',
    channel: 'web_widget',
    depth: 0,
    mode: 'production',
    userMessage: 'placeholder',
    model: 'anthropic/claude-sonnet-4-6',
  }

  it('strips a credential/PII-shaped substring from user_message', async () => {
    const { capturedInserts } = buildInsertMock()

    await insertInvocationStart({
      ...BASE_START_PARAMS,
      userMessage: `Contact me at jane@example.com, here is my key xph_${'c'.repeat(64)}`,
    })

    const stored = capturedInserts[0].user_message as string
    expect(stored).not.toContain('jane@example.com')
    expect(stored).not.toContain('xph_')
  })

  it('leaves an ordinary message unchanged', async () => {
    const { capturedInserts } = buildInsertMock()
    await insertInvocationStart({ ...BASE_START_PARAMS, userMessage: 'What are your hours?' })
    expect(capturedInserts[0].user_message).toBe('What are your hours?')
  })
})

describe('updateInvocationEnd — redacts assistant_reply, tool_calls, and partner_calls before the UPDATE', () => {
  afterEach(() => vi.clearAllMocks())

  const BASE_END_PARAMS: InvocationEndParams = {
    invocationId: 'row-1',
    agentId: 'agent-1',
    model: 'anthropic/claude-sonnet-4-6',
    status: 'success',
    assistantReply: 'placeholder',
    tokensIn: 1,
    tokensOut: 1,
    toolCallsJson: [],
    startedAt: Date.now() - 5,
  }

  it('strips a credential-shaped substring from assistant_reply', async () => {
    const { capturedUpdates } = buildUpdateMock()

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      assistantReply: `Sure — your API key is xph_${'d'.repeat(64)}.`,
    })

    expect(capturedUpdates[0].assistant_reply as string).not.toContain('xph_')
  })

  it('redacts a credential nested inside a tool_calls result before persistence', async () => {
    const { capturedUpdates } = buildUpdateMock()
    const toolCalls: Json[] = [
      {
        name: 'custom_webhook',
        args: { headers: { authorization: 'Bearer super-secret-token-value' } },
        result: 'ok',
        denied: false,
      } as unknown as Json,
    ]

    await updateInvocationEnd({ ...BASE_END_PARAMS, toolCallsJson: toolCalls })

    const stored = capturedUpdates[0].tool_calls as Array<Record<string, unknown>>
    const args = stored[0].args as Record<string, unknown>
    const headers = args.headers as Record<string, unknown>
    expect(headers.authorization).toBe('[REDACTED]')
    // Structural fields survive.
    expect(stored[0].name).toBe('custom_webhook')
  })

  it('redacts PII nested inside a partner_calls handoff before persistence', async () => {
    const { capturedUpdates } = buildUpdateMock()
    const partnerCalls: Json[] = [
      {
        partner_agent_id: 'p1',
        partner_slug: 'booking-specialist',
        denied: false,
        handoff_summary: 'Customer email: someone@example.com',
      } as unknown as Json,
    ]

    await updateInvocationEnd({ ...BASE_END_PARAMS, partnerCallsJson: partnerCalls })

    const stored = capturedUpdates[0].partner_calls as Array<Record<string, unknown>>
    expect(stored[0].handoff_summary as string).not.toContain('someone@example.com')
    expect(stored[0].partner_slug).toBe('booking-specialist')
  })

  it('leaves a clean assistant_reply and tool_calls array untouched', async () => {
    const { capturedUpdates } = buildUpdateMock()
    const toolCalls: Json[] = [{ name: 'get_availability', args: {}, result: 'ok', denied: false } as unknown as Json]

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      assistantReply: 'Your appointment is confirmed for 3pm.',
      toolCallsJson: toolCalls,
    })

    expect(capturedUpdates[0].assistant_reply).toBe('Your appointment is confirmed for 3pm.')
    expect(capturedUpdates[0].tool_calls).toEqual(toolCalls)
  })
})
