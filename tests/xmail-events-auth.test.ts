import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyApiKey, createServiceRoleClient } = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/api-keys/verify', () => ({ verifyApiKey }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/events', () => ({ resolveProspectEntity: vi.fn() }))

import { POST } from '@/app/api/integrations/xmail/events/route'

describe('Xmail event receiver authentication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires the dedicated xmail:events scope', async () => {
    verifyApiKey.mockResolvedValue({
      ok: true,
      key: { keyId: 'key-1', orgId: 'org-1', scopes: ['xmail:events'] },
    })
    const request = new Request('https://xphere.app/api/integrations/xmail/events', {
      method: 'POST',
      headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'future.event' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(verifyApiKey).toHaveBeenCalledWith(request, expect.anything(), 'xmail:events')
  })

  it('returns 403 when a valid key lacks the event scope', async () => {
    verifyApiKey.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'API key is missing the xmail:events scope',
      code: 'insufficient_scope',
    })
    const response = await POST(new Request('https://xphere.app/api/integrations/xmail/events', {
      method: 'POST',
      headers: { authorization: 'Bearer xph_other', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'sent' }),
    }))

    expect(response.status).toBe(403)
  })
})
