import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the redis singleton BEFORE importing session helpers
const { mockGet, mockSetEx, mockRedis } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockSetEx = vi.fn()
  const mockRedis = { isReady: true, get: mockGet, setEx: mockSetEx }
  return { mockGet, mockSetEx, mockRedis }
})
vi.mock('@/lib/redis', () => ({ default: mockRedis }))

import { getSession, setSession } from '@/lib/chat/session'
import type { ChatSessionContext } from '@/lib/chat/session'

const mockCtx: ChatSessionContext = {
  orgId: 'org-1',
  sessionId: 'sess-1',
  dbSessionId: 'db-sess-1',
  messages: [],
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
}

describe('getSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed session when Redis has the key', async () => {
    mockGet.mockResolvedValue(JSON.stringify(mockCtx))
    const result = await getSession('sess-1')
    expect(mockGet).toHaveBeenCalledWith('chat:session:sess-1')
    expect(result).toEqual(mockCtx)
  })

  it('returns null when key is missing', async () => {
    mockGet.mockResolvedValue(null)
    expect(await getSession('sess-1')).toBeNull()
  })

  it('returns null without calling Redis when isReady is false', async () => {
    mockRedis.isReady = false
    expect(await getSession('sess-1')).toBeNull()
    expect(mockGet).not.toHaveBeenCalled()
    mockRedis.isReady = true
  })
})

describe('setSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls setEx with correct key, TTL 3600, and serialized JSON', async () => {
    await setSession('sess-1', mockCtx)
    expect(mockSetEx).toHaveBeenCalledWith('chat:session:sess-1', 3600, JSON.stringify(mockCtx))
  })

  it('is a no-op when isReady is false', async () => {
    mockRedis.isReady = false
    await setSession('sess-1', mockCtx)
    expect(mockSetEx).not.toHaveBeenCalled()
    mockRedis.isReady = true
  })
})
