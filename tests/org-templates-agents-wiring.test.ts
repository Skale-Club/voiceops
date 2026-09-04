// Phase 139 Plan 07 (TMPL-01): asserts that the Organization Templates list
// reports an `agents` figure alongside the other asset-group counts —
// snapshotCounts() itself cannot be imported directly because
// settings/organization-templates/actions.ts carries a top-level
// 'use server' directive, which requires every export to be an async
// function. listOrgTemplates() is the exported, awaitable surface that
// exercises the same snapshotCounts() body, so it is what this suite drives.

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getUser, createClient } from '@/lib/supabase/server'
import { listOrgTemplates } from '../src/app/(dashboard)/settings/organization-templates/actions'

const mockUser = { id: 'user-1', email: 'test@test.com' }

interface FakeQuery {
  select: (cols?: string) => FakeQuery
  order: (col?: string) => FakeQuery
  then: <TResult1 = { data: unknown[]; error: null }>(
    resolve: (v: { data: unknown[]; error: null }) => TResult1
  ) => Promise<TResult1>
}

function buildFakeSupabase(rows: unknown[]) {
  const query = {} as FakeQuery
  const methods: (keyof Pick<FakeQuery, 'select' | 'order'>)[] = ['select', 'order']
  for (const m of methods) query[m] = vi.fn(() => query)
  query.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve) as never

  return {
    from: vi.fn(() => query),
  }
}

describe('TMPL-01: agent counts on Organization Templates list', () => {
  it('reports agents count from a snapshot carrying two agents', async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser as never)
    vi.mocked(createClient).mockResolvedValue(
      buildFakeSupabase([
        {
          id: 'tmpl-1',
          name: 'With agents',
          industry: null,
          description: null,
          status: 'draft',
          asset_groups: ['agents'],
          snapshot: { agents: [{ slug: 'a' }, { slug: 'b' }] },
          snapshot_at: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]) as never
    )

    const templates = await listOrgTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0].counts.agents).toBe(2)
  })

  it('defaults agents to zero for a snapshot with no agents field, matching every other field', async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser as never)
    vi.mocked(createClient).mockResolvedValue(
      buildFakeSupabase([
        {
          id: 'tmpl-2',
          name: 'Empty snapshot',
          industry: null,
          description: null,
          status: 'draft',
          asset_groups: [],
          snapshot: {},
          snapshot_at: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]) as never
    )

    const templates = await listOrgTemplates()
    expect(templates[0].counts).toEqual({
      pipelines: 0,
      custom_fields: 0,
      tags: 0,
      message_templates: 0,
      workflows: 0,
      agents: 0,
    })
  })
})
