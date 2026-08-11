import { describe, expect, it, vi } from 'vitest'
import { markMetaAudiencesDirty } from '@/lib/meta/audience-dirty'

type QueryResult = { data: unknown; error: unknown }

function builder(awaited: QueryResult) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'update', 'in']) query[method] = vi.fn(() => query)
  query.then = (resolve: (result: QueryResult) => unknown) => resolve(awaited)
  return query as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResult>
}

describe('markMetaAudiencesDirty', () => {
  it('updates only enabled scopes in the same org that match the changed entity/source', async () => {
    const discovery = builder({
      data: [
        { id: 'master-xcraper', audience_kind: 'xcraper_master', source_definition: {} },
        { id: 'master-other', audience_kind: 'xcraper_master', source_definition: { sourceType: 'apollo' } },
        {
          id: 'segment-match',
          audience_kind: 'prospect_segment',
          source_definition: { entityKeys: ['account:account-1'] },
        },
        {
          id: 'segment-other',
          audience_kind: 'prospect_segment',
          source_definition: { entityKeys: ['account:account-2'] },
        },
      ],
      error: null,
    })
    const update = builder({ data: null, error: null })
    let calls = 0
    const supabase = { from: vi.fn(() => calls++ === 0 ? discovery : update) }

    const result = await markMetaAudiencesDirty(supabase as never, {
      orgId: 'org-skale',
      reason: 'prospect_ingestion',
      sourceType: 'xcraper',
      entityType: 'account',
      entityId: 'account-1',
    })

    expect(result).toEqual({ marked: 2 })
    expect(discovery.eq).toHaveBeenCalledWith('org_id', 'org-skale')
    expect(discovery.eq).toHaveBeenCalledWith('sync_enabled', true)
    expect(update.eq).toHaveBeenCalledWith('org_id', 'org-skale')
    expect(update.in).toHaveBeenCalledWith('id', ['master-xcraper', 'segment-match'])
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({
      operational_status: 'dirty',
      dirty_reason: 'prospect_ingestion',
      sync_claim_id: null,
      sync_claimed_at: null,
    }))
  })

  it('throws a safe error when durable dirty marking fails', async () => {
    const discovery = builder({
      data: [{ id: 'master-xcraper', audience_kind: 'xcraper_master', source_definition: {} }],
      error: null,
    })
    const update = builder({ data: null, error: { message: 'database details' } })
    let calls = 0
    const supabase = { from: vi.fn(() => calls++ === 0 ? discovery : update) }

    await expect(markMetaAudiencesDirty(supabase as never, {
      orgId: 'org-skale', reason: 'prospect_ingestion', sourceType: 'xcraper',
    })).rejects.toThrow('Could not schedule Meta audience reconciliation')
  })
})
