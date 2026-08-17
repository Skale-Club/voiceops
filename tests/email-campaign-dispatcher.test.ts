import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/email/resend', () => ({ sendTenantEmail: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { sendTenantEmail } from '@/lib/email/resend'
import { startEmailCampaign } from '@/lib/campaigns/email-dispatcher'

function chain(result: unknown) {
  const value: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<unknown>['then']
  } = {}
  for (const method of ['select', 'eq', 'in', 'limit', 'not', 'update']) {
    value[method] = vi.fn(() => value)
  }
  value.maybeSingle = vi.fn(async () => result)
  value.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return value
}

function buildDb() {
  let recipientBatchCalls = 0
  const recipientUpdates: Array<Record<string, unknown>> = []
  const campaignUpdates: Array<Record<string, unknown>> = []

  const from = vi.fn((table: string) => {
    if (table === 'campaigns') {
      return {
        select: (columns: string) => {
          if (columns === 'status') {
            return chain({ data: { status: 'running' }, error: null })
          }
          return chain({
            data: {
              id: 'campaign-1',
              organization_id: 'org-1',
              channel: 'email',
              template_config: { email_template_id: 'template-1' },
              status: 'running',
            },
            error: null,
          })
        },
        update: (payload: Record<string, unknown>) => {
          campaignUpdates.push(payload)
          return chain({ data: null, error: null })
        },
      }
    }
    if (table === 'email_templates') {
      return {
        select: () =>
          chain({
            data: {
              id: 'template-1',
              subject_line: 'Hello {{contact.first_name}}',
              html_snapshot: '<p>Hi {{contact.first_name}}</p>',
              plain_text_snapshot: 'Hi {{contact.first_name}}',
              status: 'published',
            },
            error: null,
          }),
      }
    }
    if (table === 'campaign_recipients') {
      return {
        select: (_columns: string, options?: { head?: boolean }) => {
          if (options?.head) return chain({ data: null, count: 0, error: null })
          recipientBatchCalls += 1
          return chain({
            data:
              recipientBatchCalls === 1
                ? [{ id: 'recipient-1', contact_id: 'contact-1', status: 'pending' }]
                : [],
            error: null,
          })
        },
        update: (payload: Record<string, unknown>) => {
          recipientUpdates.push(payload)
          return chain({ data: null, error: null })
        },
      }
    }
    if (table === 'contacts') {
      return {
        select: () =>
          chain({
            data: [
              {
                id: 'contact-1',
                first_name: 'Ana',
                last_name: 'Silva',
                name: 'Ana Silva',
                email: 'ana@example.com',
                phone: null,
                company: 'Acme',
                notes: null,
                source: 'manual',
                dnd_enabled: false,
                dnd_channels: [],
              },
            ],
            error: null,
          }),
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  return { client: { from }, recipientUpdates, campaignUpdates }
}

describe('email campaign dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTenantEmail).mockResolvedValue({ id: 'resend-message-1' })
  })

  it('renders a personalized marketing email and completes the recipient and campaign', async () => {
    const db = buildDb()
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client as never)

    const result = await startEmailCampaign('campaign-1')

    expect(result).toEqual({
      ok: true,
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      unsubscribed: 0,
    })
    expect(sendTenantEmail).toHaveBeenCalledWith(
      'org-1',
      'ana@example.com',
      'Hello Ana',
      '<p>Hi Ana</p>',
      undefined,
      { kind: 'marketing', source: 'campaign', text: 'Hi Ana' },
    )
    expect(db.recipientUpdates).toContainEqual(
      expect.objectContaining({
        status: 'sent',
        result: { message_id: 'resend-message-1' },
      }),
    )
    expect(db.campaignUpdates).toContainEqual(
      expect.objectContaining({ status: 'completed' }),
    )
  })
})
