// tests/calendar-tick-opportunity-episode.test.ts
//
// Time-based opportunity triggers (no_activity, aged_in_stage, stale,
// close_date_passed) must fire ONCE per episode, not once per day. Before this
// guard, "no activity for 7 days" was re-evaluated true on day 8, 9, 10, ...
// and the nightly tick re-dispatched the same nudge to the same lead for 61
// consecutive nights (each one a failed run, since Twilio rejected the number).
//
// The route is exercised end-to-end through a table-aware Supabase mock that
// records writes and honours the `fired_at >= episode start` filter, so the
// three cases below (first crossing, same episode, new episode) are decided by
// the same query shape production runs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// route.ts reads these at module load; without them GET() 500s before any scan.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key-for-tests'
})

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/calendar/transition', () => ({
  emitCalendarEvent: vi.fn().mockResolvedValue({ dispatched: 0, dispatch_id: null }),
}))
vi.mock('@/lib/pipeline/events', () => ({
  emitOpportunityEvent: vi.fn().mockResolvedValue({ dispatched: 1, dispatch_id: 'd1' }),
}))
vi.mock('@/lib/flows/wait', () => ({
  findExpiredWaits: vi.fn().mockResolvedValue([]),
  satisfyWait: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/flows/engine', () => ({ resumeRun: vi.fn() }))

import { createClient } from '@supabase/supabase-js'
import { emitOpportunityEvent } from '@/lib/pipeline/events'
import { GET } from '@/app/api/cron/calendar-tick/route'

const SECRET = 'episode-test-secret'
const NOW = new Date('2026-09-02T00:00:10.000Z')

interface Fixture {
  workflowEvent: string
  triggerConfig: Record<string, unknown>
  opportunity: Record<string, unknown>
  /** latest opportunity_activities row for the opp (null = none) */
  lastActivityAt: string | null
  /** previously FIRED ticks for (workflow, opp, event) */
  firedTicks: Array<{ id: string; fired_at: string }>
}

interface Recorded {
  tickInserts: Array<Record<string, unknown>>
  guardQueries: Array<{ gteFiredAt: string | null }>
}

function makeSupabase(fx: Fixture): { client: { from: (t: string) => unknown }; rec: Recorded } {
  const rec: Recorded = { tickInserts: [], guardQueries: [] }

  const from = (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
      payload: null as Record<string, unknown> | null,
      contains: null as Record<string, unknown> | null,
      gte: null as { col: string; val: string } | null,
      eqFired: null as boolean | null,
    }
    const resolve = (): { data: unknown; error: unknown } => {
      if (st.op !== 'select') {
        if (table === 'scheduled_opportunity_ticks' && st.op === 'insert') {
          rec.tickInserts.push(st.payload ?? {})
          return { data: { id: `tick-${rec.tickInserts.length}` }, error: null }
        }
        return { data: null, error: null }
      }
      switch (table) {
        case 'calendar_tick_watermark':
          return {
            data: [
              { event_type: 'meeting.starts_in', scanned_to: NOW.toISOString() },
              { event_type: 'meeting.ended', scanned_to: NOW.toISOString() },
            ],
            error: null,
          }
        case 'workflows': {
          const wanted = (st.contains as { event?: string } | null)?.event
          if (wanted === fx.workflowEvent) {
            return { data: [{ id: 'wf-1', org_id: 'org-1', trigger_config: fx.triggerConfig }], error: null }
          }
          return { data: [], error: null }
        }
        case 'opportunities':
          return { data: [fx.opportunity], error: null }
        case 'opportunity_activities':
          return { data: fx.lastActivityAt ? { created_at: fx.lastActivityAt } : null, error: null }
        case 'scheduled_opportunity_ticks': {
          rec.guardQueries.push({ gteFiredAt: st.gte?.col === 'fired_at' ? st.gte.val : null })
          const gte = st.gte?.val
          const hit = fx.firedTicks.find((t) => (st.eqFired ?? true) && (!gte || t.fired_at >= gte))
          return { data: hit ? { id: hit.id } : null, error: null }
        }
        default:
          return { data: [], error: null }
      }
    }
    const api: Record<string, unknown> = {}
    const chain = () => api
    Object.assign(api, {
      select: chain,
      in: chain,
      gt: chain,
      lt: chain,
      lte: chain,
      order: chain,
      limit: chain,
      eq: (col: string, val: unknown) => {
        if (col === 'fired') st.eqFired = Boolean(val)
        return api
      },
      gte: (col: string, val: string) => {
        st.gte = { col, val }
        return api
      },
      contains: (_col: string, val: Record<string, unknown>) => {
        st.contains = val
        return api
      },
      insert: (payload: Record<string, unknown>) => {
        st.op = 'insert'
        st.payload = payload
        return api
      },
      update: (payload: Record<string, unknown>) => {
        st.op = 'update'
        st.payload = payload
        return api
      },
      upsert: (payload: Record<string, unknown>) => {
        st.op = 'upsert'
        st.payload = payload
        return api
      },
      delete: () => {
        st.op = 'delete'
        return api
      },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled),
    })
    return api
  }

  return { client: { from }, rec }
}

function request(): Request {
  return new Request('http://localhost/api/cron/calendar-tick', {
    headers: { Authorization: `Bearer ${SECRET}` },
  })
}

const OPP = {
  id: 'opp-1',
  org_id: 'org-1',
  stage_id: 'stage-lead',
  status: 'open',
  expected_close_date: null,
  updated_at: '2026-06-08T15:19:13.000Z',
  created_at: '2026-06-08T15:19:13.000Z',
}

describe('calendar-tick: time-based opportunity triggers fire once per episode', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = SECRET
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('first crossing: no prior fired tick → claims a tick and dispatches no_activity', async () => {
    const { client, rec } = makeSupabase({
      workflowEvent: 'opportunity.no_activity',
      triggerConfig: { event: 'opportunity.no_activity', days: 7 },
      opportunity: OPP,
      lastActivityAt: '2026-08-20T10:00:00.000Z', // 12+ days ago
      firedTicks: [],
    })
    vi.mocked(createClient).mockReturnValue(client as never)

    const res = await GET(request())
    const body = await res.json()

    expect(rec.tickInserts).toHaveLength(1)
    expect(rec.tickInserts[0]).toMatchObject({ workflow_id: 'wf-1', opportunity_id: 'opp-1', event_type: 'opportunity.no_activity' })
    expect(emitOpportunityEvent).toHaveBeenCalledTimes(1)
    expect(body.dispatched).toBe(1)
    // The guard asked "fired since the last activity?", i.e. the episode start.
    expect(rec.guardQueries[0]?.gteFiredAt).toBe(new Date('2026-08-20T10:00:00.000Z').toISOString())
  })

  it('same episode: a tick already fired AFTER the last activity → skipped, nothing dispatched (the 61-nights bug)', async () => {
    const { client, rec } = makeSupabase({
      workflowEvent: 'opportunity.no_activity',
      triggerConfig: { event: 'opportunity.no_activity', days: 7 },
      opportunity: OPP,
      lastActivityAt: '2026-06-08T15:19:13.000Z',
      firedTicks: [{ id: 'tick-yesterday', fired_at: '2026-09-01T00:00:15.000Z' }],
    })
    vi.mocked(createClient).mockReturnValue(client as never)

    const res = await GET(request())
    const body = await res.json()

    expect(rec.tickInserts).toHaveLength(0)
    expect(emitOpportunityEvent).not.toHaveBeenCalled()
    expect(body.dispatched).toBe(0)
    expect(body.skipped_already_dispatched).toBe(1)
  })

  it('new episode: the prior fired tick predates a newer activity → the clock reset, so it fires again', async () => {
    const { client, rec } = makeSupabase({
      workflowEvent: 'opportunity.no_activity',
      triggerConfig: { event: 'opportunity.no_activity', days: 7 },
      opportunity: OPP,
      lastActivityAt: '2026-08-20T10:00:00.000Z', // activity AFTER the July nudge, then 12 quiet days
      firedTicks: [{ id: 'tick-july', fired_at: '2026-07-04T00:00:15.000Z' }],
    })
    vi.mocked(createClient).mockReturnValue(client as never)

    await GET(request())

    expect(rec.tickInserts).toHaveLength(1)
    expect(emitOpportunityEvent).toHaveBeenCalledTimes(1)
  })

  it('aged_in_stage uses the last stage change as the episode start', async () => {
    const { client, rec } = makeSupabase({
      workflowEvent: 'opportunity.aged_in_stage',
      triggerConfig: { event: 'opportunity.aged_in_stage', days: 2, stage_id: 'stage-lead' },
      opportunity: OPP,
      lastActivityAt: null, // no stage_change rows → falls back to created_at
      firedTicks: [{ id: 'tick-yesterday', fired_at: '2026-09-01T00:00:15.000Z' }],
    })
    vi.mocked(createClient).mockReturnValue(client as never)

    await GET(request())

    expect(rec.guardQueries[0]?.gteFiredAt).toBe(new Date(OPP.created_at).toISOString())
    expect(rec.tickInserts).toHaveLength(0)
    expect(emitOpportunityEvent).not.toHaveBeenCalled()
  })

  it('below the threshold nothing is claimed and the guard is never consulted', async () => {
    const { client, rec } = makeSupabase({
      workflowEvent: 'opportunity.no_activity',
      triggerConfig: { event: 'opportunity.no_activity', days: 7 },
      opportunity: OPP,
      lastActivityAt: '2026-09-01T10:00:00.000Z', // yesterday
      firedTicks: [],
    })
    vi.mocked(createClient).mockReturnValue(client as never)

    await GET(request())

    expect(rec.guardQueries).toHaveLength(0)
    expect(rec.tickInserts).toHaveLength(0)
    expect(emitOpportunityEvent).not.toHaveBeenCalled()
  })
})
