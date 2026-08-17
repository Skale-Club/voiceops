import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { enrollCampaignRecipients } from '@/lib/campaigns/enroll-recipients'

type QueryResult = { data: unknown; error: { message: string } | null }

function queryChain(result: QueryResult) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<QueryResult>['then']
  } = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'gt', 'contains', 'not', 'neq', 'or', 'in']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result)
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function buildDb(options: {
  channel: 'email' | 'whatsapp'
  audienceFilter?: Record<string, unknown>
  contacts: Array<{ id: string }>
  tagRows?: Array<{ id: string; slug: string; name: string }>
  contactTagRows?: Array<{ contact_id: string }>
}) {
  const campaignQuery = queryChain({
    data: {
      id: 'campaign-1',
      organization_id: 'org-1',
      channel: options.channel,
      audience_filter: options.audienceFilter ?? {},
    },
    error: null,
  })
  const contactsQuery = queryChain({ data: options.contacts, error: null })
  const tagsQuery = queryChain({ data: options.tagRows ?? [], error: null })
  const contactTagsQuery = queryChain({ data: options.contactTagRows ?? [], error: null })
  const recipientSelect = vi.fn(async () => ({
    data: options.contacts.map((contact) => ({ id: `recipient-${contact.id}` })),
    error: null,
  }))
  const recipientUpsert = vi.fn(() => ({ select: recipientSelect }))

  const from = vi.fn((table: string) => {
    if (table === 'campaigns') return campaignQuery
    if (table === 'contacts') return contactsQuery
    if (table === 'tags') return tagsQuery
    if (table === 'contact_tags') return contactTagsQuery
    if (table === 'campaign_recipients') return { upsert: recipientUpsert }
    throw new Error(`Unexpected table ${table}`)
  })

  return {
    client: { from },
    contactsQuery,
    contactTagsQuery,
    recipientUpsert,
  }
}

describe('campaign recipient enrollment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enrolls all email contacts with a usable email filter and idempotent conflict target', async () => {
    const db = buildDb({
      channel: 'email',
      contacts: [{ id: 'contact-1' }, { id: 'contact-2' }],
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client as never)

    const result = await enrollCampaignRecipients('campaign-1')

    expect(result).toEqual({ ok: true, enrolled: 2 })
    expect(db.contactsQuery.not).toHaveBeenCalledWith('email', 'is', null)
    expect(db.contactsQuery.neq).toHaveBeenCalledWith('email', '')
    expect(db.recipientUpsert).toHaveBeenCalledWith(
      [
        { campaign_id: 'campaign-1', contact_id: 'contact-1', status: 'pending' },
        { campaign_id: 'campaign-1', contact_id: 'contact-2', status: 'pending' },
      ],
      { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true },
    )
  })

  it('enrolls WhatsApp audiences only from contacts with a phone field', async () => {
    const db = buildDb({ channel: 'whatsapp', contacts: [{ id: 'contact-1' }] })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client as never)

    const result = await enrollCampaignRecipients('campaign-1')

    expect(result).toEqual({ ok: true, enrolled: 1 })
    expect(db.contactsQuery.or).toHaveBeenCalledWith(
      'phone_e164.not.is.null,phone.not.is.null',
    )
  })

  it('resolves a named tag through contact_tags before enrolling', async () => {
    const db = buildDb({
      channel: 'email',
      audienceFilter: { tag: 'Customers' },
      tagRows: [{ id: 'tag-1', slug: 'customers', name: 'Customers' }],
      contactTagRows: [{ contact_id: 'contact-9' }],
      contacts: [{ id: 'contact-9' }],
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client as never)

    const result = await enrollCampaignRecipients('campaign-1')

    expect(result).toEqual({ ok: true, enrolled: 1 })
    expect(db.contactTagsQuery.eq).toHaveBeenCalledWith('tag_id', 'tag-1')
    expect(db.contactsQuery.in).toHaveBeenCalledWith('id', ['contact-9'])
  })
})
