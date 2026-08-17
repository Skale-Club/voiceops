import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/dnd', () => ({
  checkDnd: vi.fn(),
  dndBlockedMessage: vi.fn(() => 'Message blocked — DND active for Email'),
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(async () => {}) }))
vi.mock('@/lib/action-engine/executors/send-tenant-email', () => ({
  executeSendTenantEmail: vi.fn(async () => 'tenant email sent'),
}))
vi.mock('@/lib/action-engine/executors/send-email-template', () => ({
  executeSendEmailTemplate: vi.fn(async () => 'template email sent'),
}))

import { executeAction } from '@/lib/action-engine/execute-action'
import { checkDnd } from '@/lib/dnd'
import { executeSendTenantEmail } from '@/lib/action-engine/executors/send-tenant-email'
import { executeSendEmailTemplate } from '@/lib/action-engine/executors/send-email-template'

function makeContext() {
  const insert = vi.fn(async () => ({ error: null }))
  return {
    context: {
      organizationId: 'org-1',
      contactId: 'contact-1',
      conversationId: 'conversation-1',
      supabase: { from: vi.fn(() => ({ insert })) },
    },
    insert,
  }
}

describe('Action Engine email DND gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('blocks send_tenant_email before the provider executor and writes a timeline event', async () => {
    vi.mocked(checkDnd).mockResolvedValue({
      blocked: true,
      reason: 'dnd_blocked',
      channels: ['email'],
    })
    const { context, insert } = makeContext()

    const result = await executeAction(
      'send_tenant_email',
      { to: 'person@example.com', subject: 'Hello', html: '<p>Hello</p>' },
      {} as never,
      context as never,
    )
    await Promise.resolve()

    expect(JSON.parse(result)).toEqual({
      ok: false,
      reason: 'dnd_blocked',
      channel: 'email',
    })
    expect(executeSendTenantEmail).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-1',
        org_id: 'org-1',
        role: 'system',
        metadata: expect.objectContaining({ type: 'dnd_blocked', channel: 'email' }),
      }),
    )
  })

  it('lets send_email_template proceed when email DND is not active', async () => {
    vi.mocked(checkDnd).mockResolvedValue({ blocked: false })
    const { context } = makeContext()

    const result = await executeAction(
      'send_email_template' as never,
      { template_id: 'template-1', to: 'person@example.com' },
      {} as never,
      context as never,
    )

    expect(result).toBe('template email sent')
    expect(executeSendEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ template_id: 'template-1' }),
      'org-1',
      context.supabase,
    )
  })
})
