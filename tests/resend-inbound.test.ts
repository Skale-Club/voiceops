// tests/resend-inbound.test.ts
// Inbound email (Resend) webhook → conversation + message normalization.
// Signature validation is bypassed in non-production when no secret is set.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/email/webhook-secrets', () => ({
  validateResendWebhookSignature: vi.fn(async () => ({ platform: true, tenantOrgIds: [] })),
  canResendWebhookSignerAccessOrg: vi.fn(() => true),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { canResendWebhookSignerAccessOrg } from '@/lib/email/webhook-secrets'

interface MockOpts {
  route?: { org_id: string } | null
  existingContact?: { id: string } | null
  existingConversation?: { id: string } | null
}

function buildMockSupabase(opts: MockOpts = {}) {
  const route = opts.route === undefined ? { org_id: 'org-1' } : opts.route

  const insertContactSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'contact-new' }, error: null }),
  })
  const insertConversationSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
  })
  const updateConversationSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  const insertMessageSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null }),
  })

  const fromMock = vi.fn((table: string) => {
    if (table === 'inbound_email_routes') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: route, error: null }),
      }
    }
    if (table === 'contacts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: opts.existingContact ?? null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: insertContactSpy,
      }
    }
    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: opts.existingConversation ?? null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingConversation ?? null, error: null }),
        insert: insertConversationSpy,
        update: updateConversationSpy,
      }
    }
    if (table === 'conversation_messages') {
      return { insert: insertMessageSpy }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from: fromMock, insertContactSpy, insertConversationSpy, updateConversationSpy, insertMessageSpy }
}

function makeRequest(data: Record<string, unknown>) {
  return new Request('http://localhost/api/resend/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}

const EMAIL = {
  from: 'Alice <alice@example.com>',
  to: 'support@org.com',
  subject: 'Need help',
  html: '<p>Hello there</p>',
  email_id: 'em-001',
}

describe('Resend inbound email webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(canResendWebhookSignerAccessOrg).mockReturnValue(true)
  })

  it('creates contact + conversation + message for a fresh sender', async () => {
    const db = buildMockSupabase({ existingContact: null, existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { POST } = await import('@/app/api/resend/inbound/route')
    const res = await POST(makeRequest(EMAIL))
    expect(res.status).toBe(200)

    expect(db.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        channel: 'email',
        contact_id: 'contact-new',
        visitor_email: 'alice@example.com',
        status: 'open',
      }),
    )
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-new',
        role: 'user',
        channel: 'email',
        message_type: 'email',
        email_subject: 'Need help',
        email_from: 'Alice <alice@example.com>',
      }),
    )
  })

  it('appends to an existing open email thread (no new conversation)', async () => {
    const db = buildMockSupabase({
      existingContact: { id: 'contact-1' },
      existingConversation: { id: 'conv-existing' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { POST } = await import('@/app/api/resend/inbound/route')
    const res = await POST(makeRequest(EMAIL))
    expect(res.status).toBe(200)

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-existing', role: 'user' }),
    )
    expect(db.updateConversationSpy).toHaveBeenCalled()
  })

  it('ignores emails with no registered inbound route', async () => {
    const db = buildMockSupabase({ route: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { POST } = await import('@/app/api/resend/inbound/route')
    const res = await POST(makeRequest(EMAIL))
    expect(res.status).toBe(200)
    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('rejects a valid tenant signature that is not authorized for the resolved route org', async () => {
    const db = buildMockSupabase({ route: { org_id: 'org-2' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    vi.mocked(canResendWebhookSignerAccessOrg).mockReturnValue(false)

    const { POST } = await import('@/app/api/resend/inbound/route')
    const res = await POST(makeRequest(EMAIL))

    expect(res.status).toBe(200)
    expect(db.insertContactSpy).not.toHaveBeenCalled()
    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('returns 200 and skips when from/to are missing', async () => {
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { POST } = await import('@/app/api/resend/inbound/route')
    const res = await POST(makeRequest({ subject: 'x' }))
    expect(res.status).toBe(200)
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })
})
