// tests/xmail-source-runs.test.ts
//
// Unit coverage for the batch source-run lookup
// (src/lib/xmail/source-runs.ts) that powers customFields.source_run_id on
// leads pushed to Xmail. The linkage is prospect_engagement_events rows
// written by /api/v1/prospects's recordImport() (event_type: 'imported',
// payload: { source_run_id }) — this reads that back, then resolves the
// referenced prospect_sources.id through to its external_run_id (the value
// Xmail actually keys the run under), in one additional batched query.

import { describe, it, expect } from 'vitest'
import { loadSourceRunIdsForEntities } from '@/lib/xmail/source-runs'

type EventRow = { entity_id: string; payload: unknown; created_at: string }
type SourceRow = { id: string; external_run_id: string | null }

function makeClient(eventRows: EventRow[], sourceRows: SourceRow[]) {
  const calls = { events: 0, sources: 0 }
  return {
    calls,
    from: (table: string) => {
      if (table === 'prospect_engagement_events') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          // .order(...) is the terminal call the implementation awaits.
          order: () => {
            calls.events += 1
            return { data: eventRows, error: null }
          },
        }
        return builder
      }
      if (table === 'prospect_sources') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          // .in(...) is the terminal call the implementation awaits here.
          in: () => {
            calls.sources += 1
            return { data: sourceRows, error: null }
          },
        }
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

describe('loadSourceRunIdsForEntities', () => {
  it('returns the external_run_id, not the internal prospect_sources.id', async () => {
    const client = makeClient(
      [{ entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' }],
      [{ id: 'source-uuid-1', external_run_id: 'xcraper-search-abc' }],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1'])
    expect(result.get('contact-1')).toBe('xcraper-search-abc')
    expect(result.get('contact-1')).not.toBe('source-uuid-1')
  })

  it('picks the most recent imported event per entity when several exist', async () => {
    const client = makeClient(
      [
        // Rows are returned most-recent-first (order: created_at desc), same as
        // the real query.
        { entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-2' }, created_at: '2026-08-10T00:00:00Z' },
        { entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' },
      ],
      [
        { id: 'source-uuid-2', external_run_id: 'run-2' },
        { id: 'source-uuid-1', external_run_id: 'run-1' },
      ],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1'])
    expect(result.get('contact-1')).toBe('run-2')
  })

  it('omits entities with no imported event', async () => {
    const client = makeClient(
      [{ entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' }],
      [{ id: 'source-uuid-1', external_run_id: 'run-1' }],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1', 'contact-2'])
    expect(result.has('contact-1')).toBe(true)
    expect(result.has('contact-2')).toBe(false)
    expect(result.size).toBe(1)
  })

  it('omits an entity whose most recent event has no source_run_id in its payload', async () => {
    const client = makeClient([{ entity_id: 'account-1', payload: {}, created_at: '2026-08-01T00:00:00Z' }], [])
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['account-1'])
    expect(result.has('account-1')).toBe(false)
  })

  it('omits an entity whose resolved prospect_sources row has a null external_run_id', async () => {
    const client = makeClient(
      [{ entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' }],
      [{ id: 'source-uuid-1', external_run_id: null }],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1'])
    expect(result.has('contact-1')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('omits an entity whose resolved prospect_sources row has an empty-string external_run_id', async () => {
    const client = makeClient(
      [{ entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' }],
      [{ id: 'source-uuid-1', external_run_id: '   ' }],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1'])
    expect(result.has('contact-1')).toBe(false)
  })

  it('never falls back to the internal source id when external_run_id is missing', async () => {
    const client = makeClient(
      [
        { entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' },
        { entity_id: 'contact-2', payload: { source_run_id: 'source-uuid-2' }, created_at: '2026-08-01T00:00:00Z' },
      ],
      [
        { id: 'source-uuid-1', external_run_id: null },
        { id: 'source-uuid-2', external_run_id: 'run-2' },
      ],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1', 'contact-2'])
    expect(result.has('contact-1')).toBe(false)
    expect([...result.values()]).not.toContain('source-uuid-1')
    expect(result.get('contact-2')).toBe('run-2')
  })

  it('resolves source ids in one batched query, not one per entity', async () => {
    const client = makeClient(
      [
        { entity_id: 'contact-1', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' },
        { entity_id: 'contact-2', payload: { source_run_id: 'source-uuid-1' }, created_at: '2026-08-01T00:00:00Z' },
        { entity_id: 'contact-3', payload: { source_run_id: 'source-uuid-2' }, created_at: '2026-08-01T00:00:00Z' },
      ],
      [
        { id: 'source-uuid-1', external_run_id: 'run-1' },
        { id: 'source-uuid-2', external_run_id: 'run-2' },
      ],
    )
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['contact-1', 'contact-2', 'contact-3'])
    expect(client.calls.events).toBe(1)
    expect(client.calls.sources).toBe(1)
    expect(result.get('contact-1')).toBe('run-1')
    expect(result.get('contact-2')).toBe('run-1')
    expect(result.get('contact-3')).toBe('run-2')
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

  it('does not query prospect_sources when no entity has a resolved source id', async () => {
    const client = makeClient([{ entity_id: 'account-1', payload: {}, created_at: '2026-08-01T00:00:00Z' }], [])
    const result = await loadSourceRunIdsForEntities(client, 'org-1', ['account-1'])
    expect(result.size).toBe(0)
    expect(client.calls.events).toBe(1)
    expect(client.calls.sources).toBe(0)
  })
})
