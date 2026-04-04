import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before dynamic import of the route
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/chat/session', () => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
}))
vi.mock('@/lib/chat/persist', () => ({
  ensureDbSession: vi.fn(),
  persistMessage: vi.fn(),
}))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => void) => fn() }
})
vi.mock('@/lib/knowledge/query-knowledge', () => ({
  queryKnowledge: vi.fn(),
}))
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn(),
}))
vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getSession, setSession } from '@/lib/chat/session'
import { ensureDbSession, persistMessage } from '@/lib/chat/persist'
import { readSseLines } from './helpers/stream'
import { queryKnowledge } from '@/lib/knowledge/query-knowledge'
import { executeAction } from '@/lib/action-engine/execute-action'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
}

function makeRequest(body: object, token = 'valid-token') {
  return new Request(`http://localhost/api/chat/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/chat/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase)
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(ensureDbSession as ReturnType<typeof vi.fn>).mockResolvedValue('db-sess-uuid')
    ;(setSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(persistMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(queryKnowledge as ReturnType<typeof vi.fn>).mockResolvedValue("I don't have information about that in my knowledge base.")
    ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(executeAction as ReturnType<typeof vi.fn>).mockResolvedValue('Action completed')
  })

  it('returns 401 for invalid token', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'hi' }, 'bad-token'), {
      params: Promise.resolve({ token: 'bad-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for inactive org', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: false }, error: null })
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'hi' }), {
      params: Promise.resolve({ token: 'valid-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 with sessionId for valid token + new session', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValue(null) // no keys → degradation path
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'Hello' }), {
      params: Promise.resolve({ token: 'valid-token' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const lines = await readSseLines(res)
    expect(lines[0]).toMatchObject({ event: 'session' })
    expect(typeof (lines[0] as { sessionId?: string }).sessionId).toBe('string')
  })

  it('reuses sessionId when provided in request body', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    const existingCtx = {
      orgId: 'org-1', sessionId: 'existing-sess', dbSessionId: 'db-existing',
      messages: [], createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
    }
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(existingCtx)
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'Follow-up', sessionId: 'existing-sess' }), {
      params: Promise.resolve({ token: 'valid-token' }),
    })
    const body = await res.json()
    expect(body.sessionId).toBe('existing-sess')
    expect(ensureDbSession).not.toHaveBeenCalled()
  })

  it('returns 400 for missing message field', async () => {
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({}), { params: Promise.resolve({ token: 'valid-token' }) })
    expect(res.status).toBe(400)
  })

  describe('streaming AI responses', () => {
    beforeEach(() => {
      mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
      // mock tool_configs query to return empty array
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tool_configs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return mockSupabase
      })
    })

    it('CHAT-01: response is text/event-stream with session, token, and done events', async () => {
      // Will pass after Phase 3 implementation — RED before
      ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce('openrouter-key')
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Hello' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')
      const lines = await readSseLines(res)
      expect(lines[0]).toMatchObject({ event: 'session' })
      const tokenEvents = lines.filter(l => l.event === 'token')
      expect(tokenEvents.length).toBeGreaterThan(0)
      expect(lines[lines.length - 1]).toMatchObject({ event: 'done' })
    })

    it('CHAT-02: queryKnowledge is called before the LLM when org has a key', async () => {
      // Will pass after Phase 3 implementation — RED before
      ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValue('test-key')
      ;(queryKnowledge as ReturnType<typeof vi.fn>).mockResolvedValue('KB answer here')
      const { POST } = await import('@/app/api/chat/[token]/route')
      await POST(makeRequest({ message: 'What is your return policy?' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(queryKnowledge).toHaveBeenCalledWith(
        'What is your return policy?',
        'org-1',
        expect.anything()
      )
    })

    it('CHAT-03: tool_call SSE event emitted and executeAction called when model uses a tool', async () => {
      // Will pass after Phase 3 implementation — RED before
      ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValue('test-key')
      // Simulate tool_configs returning one tool
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tool_configs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: vi.fn().mockResolvedValue({
              data: [{
                id: 'tc-1',
                tool_name: 'get_availability',
                action_type: 'get_availability',
                config: {},
                fallback_message: 'Sorry',
                integration_id: 'int-1',
              }],
              error: null,
            }),
          }
        }
        return mockSupabase
      })
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Check availability for tomorrow' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      const lines = await readSseLines(res)
      const toolCallEvent = lines.find(l => l.event === 'tool_call')
      expect(toolCallEvent).toBeDefined()
      expect(executeAction).toHaveBeenCalled()
    })

    it('D-12: no API keys → stream degradation message then done (no HTTP error)', async () => {
      ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Hello' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(200)
      const lines = await readSseLines(res)
      expect(lines[0]).toMatchObject({ event: 'session' })
      const tokenEvent = lines.find(l => l.event === 'token') as { event: string; text?: string } | undefined
      expect(tokenEvent).toBeDefined()
      expect(tokenEvent?.text).toContain('not yet configured')
      expect(lines[lines.length - 1]).toMatchObject({ event: 'done' })
    })

    it('CHAT-01: Cache-Control header is no-cache on streaming response', async () => {
      ;(getProviderKey as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Hi' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.headers.get('Cache-Control')).toBe('no-cache')
    })
  })
})
