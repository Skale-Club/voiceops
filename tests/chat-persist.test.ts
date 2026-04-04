import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: mockFrom,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Default chain: .from().insert().select().single()
  mockSingle.mockResolvedValue({ data: { id: 'db-sess-uuid' }, error: null })
  mockSelect.mockReturnValue({ single: mockSingle })
  mockInsert.mockReturnValue({ select: mockSelect, error: null })
  mockFrom.mockReturnValue({ insert: mockInsert })
})

import { ensureDbSession, persistMessage } from '@/lib/chat/persist'

describe('ensureDbSession', () => {
  it('inserts a chat_sessions row and returns the id', async () => {
    const id = await ensureDbSession({ orgId: 'org-1', sessionId: 'sess-1', widgetToken: 'tok' })
    expect(mockFrom).toHaveBeenCalledWith('chat_sessions')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 'org-1', widget_token: 'tok' })
    )
    expect(id).toBe('db-sess-uuid')
  })

  it('throws when Supabase returns an error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: new Error('db error') })
    await expect(ensureDbSession({ orgId: 'org-1', sessionId: 'sess-1', widgetToken: 'tok' }))
      .rejects.toThrow()
  })
})

describe('persistMessage', () => {
  it('inserts a chat_messages row with correct fields', async () => {
    mockInsert.mockReturnValue({ error: null })
    await persistMessage({ dbSessionId: 'db-sess-uuid', orgId: 'org-1', role: 'user', content: 'Hello' })
    expect(mockFrom).toHaveBeenCalledWith('chat_messages')
    expect(mockInsert).toHaveBeenCalledWith({
      session_id: 'db-sess-uuid',
      organization_id: 'org-1',
      role: 'user',
      content: 'Hello',
    })
  })

  it('throws when Supabase returns an error', async () => {
    mockInsert.mockReturnValue({ error: new Error('db error') })
    await expect(persistMessage({ dbSessionId: 'x', orgId: 'y', role: 'user', content: 'z' }))
      .rejects.toThrow()
  })
})
