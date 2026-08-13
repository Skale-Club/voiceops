// tests/xmail-source-runs.test.ts
//
// Unit coverage for the batch source-run lookup
// (src/lib/xmail/source-runs.ts) that powers customFields.source_run_id on
// leads pushed to Xmail. The linkage is prospect_engagement_events rows
// written by /api/v1/prospects's recordImport() (event_type: 'imported',
// payload: { source_run_id }) — this reads that back in one query.

import { describe, it, expect } from 'vitest'
import { loadSourceRunIdsForEntities } from '@/lib/xmail/source-runs'

type Row = { entity_id: string; payload: unknown; created_at: string }

function makeClient(rows: Row[]) {
  return {
    from: (table: string) => {
      if (table !== 'prospect_engagement_events') throw new Error(`unexpected table: ${table}`)
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        // .order(...) is the terminal call the implementation awaits.
        order: () => ({ data: rows, error: null }),
      }
      return builder
    },
  }
}

describe('loadSourceRunIdsForEntities', () => {
  it('picks the most recent imported event per entity when several exist', async () => {
    const client = makeClient([
      // Rows are returned most-recent-first (order: created_at desc), same as
      // the real query.
      { entity_id: 'contact-1', payload: { source_run_id: 'run-2' }, created_at: '2026-08-10T00:00:00Z' },
      { entity_id: 'contact-1', payload: { source_run_id: 'run-1' }, created_at: '2026-08-01T00:00:00Z' },
    ])
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1'])
    expect(result.get('contact-1')).toBe('run-2')
  })

  it('omits entities with no imported event', async () => {
    const client = makeClient([{ entity_id: 'contact-1', payload: { source_run_id: 'run-1' }, created_at: '2026-08-01T00:00:00Z' }])
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1', 'contact-2'])
    expect(result.has('contact-1')).toBe(true)
    expect(result.has('contact-2')).toBe(false)
    expect(result.size).toBe(1)
  })

  it('omits an entity whose most recent event has no source_run_id in its payload', async () => {
    const client = makeClient([{ entity_id: 'account-1', payload: {}, created_at: '2026-08-01T00:00:00Z' }])
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['account-1'])
    expect(result.has('account-1')).toBe(false)
  })

  it('returns an empty map without querying when given no ids', async () => {
    let called = false
    const client = {
      from: () => {
        called = true
        throw new Error('should not be called')
      },
    }
    const result = await loadSourceRunIdsForEntities(client, 'org-1', [])
    expect(result.size).toBe(0)
    expect(called).toBe(false)
  })
})
