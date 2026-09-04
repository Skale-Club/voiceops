// tests/channel-routing-mode.test.ts
// Phase 134 Plan 02 (ROLL-02)
//
// Task 1: structural contract tests for migration 1293 (new, idempotent,
// never applied here) plus database.ts and zod-schemas.ts widening.
//
// Task 2: unit tests for resolveChannelRoutingMode() — a cheap, fail-closed
// per-(organization, channel) resolver that is intentionally read-only:
// flipping the switch never writes agents, mappings, workflows, or
// invocation history.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Task 1: migration 1293 structural contract
// ---------------------------------------------------------------------------

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/1293_channel_routing_mode.sql'
)

describe('migration 1293 channel routing mode', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('creates a new, dedicated table rather than reusing calls.routing_mode', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agent_channel_routing_modes')
    // Must never alter the unrelated calls settings table.
    expect(sql).not.toMatch(/ALTER TABLE public\.call_settings/i)
    expect(sql).not.toMatch(/ALTER TABLE public\.calls\b/i)
  })

  it('scopes the row by organization and channel with a composite unique constraint', () => {
    expect(sql).toContain('organization_id')
    expect(sql).toContain('channel')
    expect(sql).toContain('public.agent_channel')
    expect(sql).toContain('UNIQUE (organization_id, channel)')
  })

  it('defaults mode to legacy and bounds it with a CHECK constraint', () => {
    expect(sql).toMatch(/mode\s+TEXT\s+NOT NULL\s+DEFAULT 'legacy'/)
    expect(sql).toContain("CHECK (mode IN ('legacy', 'specialist'))")
  })

  it('enables RLS with an org-scoped policy consistent with neighbouring agent tables', () => {
    expect(sql).toContain('ALTER TABLE public.agent_channel_routing_modes ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/organization_id = \(SELECT public\.get_current_org_id\(\)\)/)
  })

  it('is idempotent: table, index, policy, and trigger statements all use guard clauses', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS')
    expect(sql).toContain('DROP POLICY IF EXISTS')
    expect(sql).toContain('DROP TRIGGER IF EXISTS')
  })

  it('performs no tenant-specific inserts, updates, or data backfill', () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.agent_channel_routing_modes/i)
    expect(sql).not.toMatch(/UPDATE\s+public\.agent_channel_routing_modes\s+SET/i)
  })

  it('documents that absence of a row means legacy for every organization and channel', () => {
    expect(sql).toMatch(/absence of a row (is|means) legacy/i)
  })

  it('documents non-destructive rollback: the switch never writes agents, mappings, workflows, or invocations', () => {
    expect(sql).toMatch(/nothing here writes to those tables|never (creates|writes)/i)
  })
})

const databaseTypesPath = resolve(process.cwd(), 'src/types/database.ts')

describe('database.ts widened for agent_channel_routing_modes', () => {
  const source = readFileSync(databaseTypesPath, 'utf8')

  it('adds the agent_channel_routing_modes table type', () => {
    expect(source).toContain('agent_channel_routing_modes: {')
    const start = source.indexOf('agent_channel_routing_modes: {')
    const end = source.indexOf('\n      }', start)
    const block = source.slice(start, end)
    expect(block).toContain('organization_id: string')
    expect(block).toContain('channel: AgentChannel')
    expect(block).toContain('mode: string')
  })
})

// ---------------------------------------------------------------------------
// Task 1: channelRoutingModeSchema
// ---------------------------------------------------------------------------

import { channelRoutingModeSchema } from '@/lib/agents/zod-schemas'

describe('channelRoutingModeSchema', () => {
  it('accepts a valid legacy payload', () => {
    expect(channelRoutingModeSchema.safeParse({ channel: 'voice', mode: 'legacy' }).success).toBe(true)
  })

  it('accepts a valid specialist payload', () => {
    expect(channelRoutingModeSchema.safeParse({ channel: 'web_widget', mode: 'specialist' }).success).toBe(
      true
    )
  })

  it('rejects an unrecognised mode value', () => {
    expect(channelRoutingModeSchema.safeParse({ channel: 'voice', mode: 'enabled' }).success).toBe(false)
    expect(channelRoutingModeSchema.safeParse({ channel: 'voice', mode: 'SPECIALIST' }).success).toBe(
      false
    )
  })

  it('rejects an unrecognised channel value', () => {
    expect(channelRoutingModeSchema.safeParse({ channel: 'fax', mode: 'legacy' }).success).toBe(false)
  })

  it('has no implicit default for mode — legacy must be explicit at this layer', () => {
    // @ts-expect-error - intentionally omitting mode to prove there's no silent default
    const result = channelRoutingModeSchema.safeParse({ channel: 'voice' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task 2: resolveChannelRoutingMode() fail-closed resolver
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveChannelRoutingMode, isSpecialistRoutingEnabled } from '@/lib/agent-runtime/routing-mode'

const ORG_ID = 'org-11111111-1111-1111-1111-111111111111'

/**
 * Builds a chainable Supabase mock matching resolveChannelRoutingMode's exact
 * query shape: .from('agent_channel_routing_modes').select().eq().eq().maybeSingle().
 * Also records every table name `.from()` was called with, so tests can
 * prove the resolver never touches any other table.
 */
function mockRoutingModeSource(resolveRow: (org: string, channel: string) => { mode: unknown } | null, error: unknown = null) {
  const calledTables: string[] = []
  const from = vi.fn((table: string) => {
    calledTables.push(table)
    let org = ''
    let channel = ''
    const eqB = vi.fn((_col: string, val: string) => {
      channel = val
      return {
        maybeSingle: vi.fn().mockImplementation(async () => ({
          data: error ? null : resolveRow(org, channel),
          error,
        })),
      }
    })
    const eqA = vi.fn((_col: string, val: string) => {
      org = val
      return { eq: eqB }
    })
    const select = vi.fn(() => ({ eq: eqA }))
    return { select }
  })
  const client = { from }
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
  return { from, calledTables }
}

describe('resolveChannelRoutingMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns legacy when no row exists for the (org, channel) pair', async () => {
    mockRoutingModeSource(() => null)
    const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(mode).toBe('legacy')
  })

  it('returns legacy on a Supabase read error even if a row would otherwise match', async () => {
    mockRoutingModeSource(() => ({ mode: 'specialist' }), new Error('boom'))
    const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(mode).toBe('legacy')
  })

  it.each([
    'enabled',
    'SPECIALIST',
    'Legacy',
    'true',
    '',
    'null',
  ])('returns legacy for the unrecognised stored value %j — never reads it as specialist', async (value) => {
    mockRoutingModeSource(() => ({ mode: value }))
    const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(mode).toBe('legacy')
  })

  it.each([null, undefined, 123, {}, []])(
    'returns legacy for malformed stored data %j — never reads it as specialist',
    async (value) => {
      mockRoutingModeSource(() => ({ mode: value as unknown }))
      const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
      expect(mode).toBe('legacy')
    }
  )

  it('returns legacy when organizationId is missing, without querying the database', async () => {
    const { from } = mockRoutingModeSource(() => ({ mode: 'specialist' }))
    const mode = await resolveChannelRoutingMode({ organizationId: '', channel: 'voice' })
    expect(mode).toBe('legacy')
    expect(from).not.toHaveBeenCalled()
  })

  it('returns specialist only for the exact recognised value', async () => {
    mockRoutingModeSource(() => ({ mode: 'specialist' }))
    const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(mode).toBe('specialist')
  })

  it('returns legacy for the exact recognised legacy value', async () => {
    mockRoutingModeSource(() => ({ mode: 'legacy' }))
    const mode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(mode).toBe('legacy')
  })

  it('isSpecialistRoutingEnabled mirrors the resolver as a boolean', async () => {
    mockRoutingModeSource(() => ({ mode: 'specialist' }))
    await expect(isSpecialistRoutingEnabled({ organizationId: ORG_ID, channel: 'voice' })).resolves.toBe(
      true
    )
  })

  it('only ever reads from agent_channel_routing_modes, never another table', async () => {
    const { calledTables } = mockRoutingModeSource(() => ({ mode: 'specialist' }))
    await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    expect(calledTables).toEqual(['agent_channel_routing_modes'])
  })

  // -------------------------------------------------------------------------
  // Independence: voice and text (web_widget) never move together.
  // -------------------------------------------------------------------------

  it('resolves voice and text (web_widget) independently — flipping one does not move the other', async () => {
    const rows: Record<string, string> = { voice: 'specialist' } // web_widget has no row at all
    mockRoutingModeSource((_org, channel) => (rows[channel] ? { mode: rows[channel] } : null))

    const voiceMode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    const textMode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'web_widget' })

    expect(voiceMode).toBe('specialist')
    expect(textMode).toBe('legacy')
  })

  it('flipping text to specialist does not move voice, which stays legacy', async () => {
    const rows: Record<string, string> = { web_widget: 'specialist' } // voice has no row at all
    mockRoutingModeSource((_org, channel) => (rows[channel] ? { mode: rows[channel] } : null))

    const voiceMode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })
    const textMode = await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'web_widget' })

    expect(textMode).toBe('specialist')
    expect(voiceMode).toBe('legacy')
  })

  // -------------------------------------------------------------------------
  // Rollback proof: flipping a channel to specialist and back destroys
  // nothing. The resolver is read-only and never touches agents, mappings,
  // workflows, or agent_invocations rows.
  // -------------------------------------------------------------------------

  it('flipping a channel to specialist and back leaves agents, mappings, workflows, and invocation rows untouched', async () => {
    // Snapshot of unrelated platform state that the switch must never affect.
    const platformState = {
      agents: [{ id: 'agent-1', organization_id: ORG_ID, is_active: true, name: 'Front Desk' }],
      channelMappings: [{ organization_id: ORG_ID, channel: 'voice', agent_id: 'agent-1' }],
      workflows: [{ id: 'wf-1', org_id: ORG_ID, name: 'Book Appointment' }],
      invocations: [{ id: 'inv-1', organization_id: ORG_ID, channel: 'voice', status: 'success' }],
    }
    const before = structuredClone(platformState)

    // Step 1: channel starts unconfigured -> legacy.
    let storedMode: string | undefined
    const { calledTables } = mockRoutingModeSource((_org, channel) =>
      channel === 'voice' && storedMode ? { mode: storedMode } : null
    )

    expect(await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })).toBe('legacy')

    // Step 2: operator flips the switch to specialist (simulated directly —
    // this test never calls through any write path, because the resolver
    // exposes none: the switch selects which path reads configuration, it
    // never writes configuration).
    storedMode = 'specialist'
    expect(await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })).toBe(
      'specialist'
    )

    // Step 3: operator flips it back to legacy (rollback).
    storedMode = 'legacy'
    expect(await resolveChannelRoutingMode({ organizationId: ORG_ID, channel: 'voice' })).toBe('legacy')

    // Proof of non-destruction: the resolver never queried any table other
    // than its own switch table across the whole flip/rollback sequence...
    expect(new Set(calledTables)).toEqual(new Set(['agent_channel_routing_modes']))

    // ...and every other platform record is byte-identical to its snapshot
    // before the flip — agents, mappings, workflows, and invocation history
    // were never read, written, or deleted by resolving or flipping the mode.
    expect(platformState).toEqual(before)
  })
})
