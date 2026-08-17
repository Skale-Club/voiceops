import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/email/webhook-secrets', () => ({
  validateResendWebhookSignature: vi.fn(async () => ({
    platform: false,
    tenantOrgIds: ['org-1'],
  })),
  canResendWebhookSignerAccessOrg: vi.fn(
    (_signer: unknown, orgId: string | null) => orgId === 'org-1',
  ),
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/admin'

function thenableChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<unknown>['then']
  } = {}
  for (const method of ['select', 'eq', 'in', 'not']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function buildDb() {
  const messageSelect = thenableChain({
    data: [
      { id: 'message-1', conversation_id: 'conversation-1' },
      { id: 'message-2', conversation_id: 'conversation-2' },
    ],
    error: null,
  })
  const messageUpdate = thenableChain({ data: null, error: null })
  const conversationSelect = thenableChain({
    data: [
      { id: 'conversation-1', org_id: 'org-1' },
      { id: 'conversation-2', org_id: 'org-2' },
    ],
    error: null,
  })
  const sendSelect = thenableChain({
    data: [
      { id: 'send-1', org_id: 'org-1' },
      { id: 'send-2', org_id: 'org-2' },
    ],
    error: null,
  })
  const sendUpdate = thenableChain({ data: null, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'conversation_messages') {
      return {
        select: messageSelect.select,
        update: vi.fn(() => messageUpdate),
      }
    }
    if (table === 'conversations') return { select: conversationSelect.select }
    if (table === 'email_sends') {
      return {
        select: sendSelect.select,
        update: vi.fn(() => sendUpdate),
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  return { from, messageUpdate, sendUpdate }
}

function makeRequest(type: string) {
  return new Request('http://localhost/api/resend/events', {
    method: 'POST',
    body: JSON.stringify({ type, data: { email_id: 'email-1' } }),
  })
}

describe('Resend delivery events tenant scoping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates only rows owned by the tenant whose secret signed the event', async () => {
    const db = buildDb()
    vi.mocked(createServiceRoleClient).mockReturnValue(db as never)

    const { POST } = await import('@/app/api/resend/events/route')
    const response = await POST(makeRequest('email.delivered'))

    expect(response.status).toBe(200)
    expect(db.messageUpdate.in).toHaveBeenCalledWith('id', ['message-1'])
    expect(db.sendUpdate.in).toHaveBeenCalledWith('id', ['send-1'])
    expect(db.sendUpdate.in).toHaveBeenCalledWith('status', ['sent', 'delivered'])
  })

  it('does not let an opened event downgrade an already clicked row', async () => {
    const db = buildDb()
    vi.mocked(createServiceRoleClient).mockReturnValue(db as never)

    const { POST } = await import('@/app/api/resend/events/route')
    await POST(makeRequest('email.opened'))

    expect(db.sendUpdate.in).toHaveBeenCalledWith('status', ['sent', 'delivered', 'opened'])
    expect(db.sendUpdate.in).not.toHaveBeenCalledWith(
      'status',
      expect.arrayContaining(['clicked']),
    )
  })
})
