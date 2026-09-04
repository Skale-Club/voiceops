// Phase 139 Plan 03 (TMPL-04): server actions for the Phase 134
// legacy/specialist routing-mode switch, finally reachable from Settings
// instead of a raw SQL UPDATE.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { getChannelRoutingModes, setChannelRoutingMode } from '@/app/(dashboard)/agents/actions'

interface FakeQueryResult {
  data?: unknown
  error?: { message: string } | null
}

function buildFakeSupabaseClient(responses: {
  rpc?: FakeQueryResult
  routingModesSelect?: FakeQueryResult
  routingModesUpsert?: FakeQueryResult
}) {
  const upsertCalls: unknown[] = []

  const make = (result: FakeQueryResult | undefined): any => {
    const proxy: any = {}
    const methods = ['select', 'upsert', 'eq', 'in']
    for (const m of methods) proxy[m] = vi.fn(() => proxy)
    proxy.then = (resolve: (v: FakeQueryResult) => void) =>
      Promise.resolve(result ?? { data: null, error: null }).then(resolve)
    return proxy
  }

  return {
    upsertCalls,
    client: {
      rpc: vi.fn(async () => responses.rpc ?? { data: 'test-org-id', error: null }),
      from: vi.fn((table: string) => {
        if (table === 'agent_channel_routing_modes') {
          return {
            select: () => make(responses.routingModesSelect),
            upsert: (payload: unknown, opts: unknown) => {
              upsertCalls.push({ payload, opts })
              return make(responses.routingModesUpsert)
            },
          }
        }
        return make({ data: null, error: null })
      }),
    },
  }
}

describe('TMPL-04: getChannelRoutingModes / setChannelRoutingMode', () => {
  beforeEach(() => {
    vi.mocked(getUser).mockReset()
    vi.mocked(createClient).mockReset()
  })

  it('defaults every channel without a row to "legacy", overwriting only the rows that exist', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as any)
    const { client } = buildFakeSupabaseClient({
      routingModesSelect: { data: [{ channel: 'voice', mode: 'specialist' }], error: null },
    })
    vi.mocked(createClient).mockResolvedValue(client as any)

    const modes = await getChannelRoutingModes()
    expect(modes.voice).toBe('specialist')
    expect(modes.web_widget).toBe('legacy')
    expect(modes.sms).toBe('legacy')
  })

  it('setChannelRoutingMode upserts on (organization_id, channel) and revalidates', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as any)
    const { client, upsertCalls } = buildFakeSupabaseClient({})
    vi.mocked(createClient).mockResolvedValue(client as any)

    const result = await setChannelRoutingMode('voice', 'specialist')
    expect(result).toBeUndefined()
    expect(upsertCalls).toHaveLength(1)
    const call = upsertCalls[0] as { payload: Record<string, unknown>; opts: Record<string, unknown> }
    expect(call.payload).toEqual({ organization_id: 'test-org-id', channel: 'voice', mode: 'specialist' })
    expect(call.opts).toEqual({ onConflict: 'organization_id,channel' })
  })

  it('setChannelRoutingMode("voice", "legacy") succeeds via upsert even when no row previously existed', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as any)
    const { client } = buildFakeSupabaseClient({})
    vi.mocked(createClient).mockResolvedValue(client as any)

    const result = await setChannelRoutingMode('voice', 'legacy')
    expect(result).toBeUndefined()
  })

  it('an unauthenticated caller gets an error from setChannelRoutingMode and all-legacy from getChannelRoutingModes', async () => {
    vi.mocked(getUser).mockResolvedValue(null as any)

    const setResult = await setChannelRoutingMode('voice', 'specialist')
    expect(setResult).toEqual({ error: 'Not authenticated.' })

    const modes = await getChannelRoutingModes()
    expect(modes.voice).toBe('legacy')
    expect(modes.web_widget).toBe('legacy')
  })
})
