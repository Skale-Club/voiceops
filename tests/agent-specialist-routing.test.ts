// tests/agent-specialist-routing.test.ts
// Phase 132 Plan 04 (ROUT-02): trusted explicit intent/function-name ->
// same-org specialist agent resolution, with NO router/orchestrator model
// call. Ambiguous input (no intent, no match, inactive specialist, or a
// channel the specialist doesn't allow) routes to the caller's configured
// entry agent.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  resolveSpecialistRoute,
  type ResolveSpecialistRouteParams,
} from '@/lib/agent-runtime/resolve-specialist-route'
import { resolveTrustedAgentRoute } from '@/lib/agent-runtime/invocation-gateway'

const ORG_ID = 'org-11111111-1111-1111-1111-111111111111'
const OTHER_ORG_ID = 'org-22222222-2222-2222-2222-222222222222'
const ENTRY_AGENT_ID = 'agent-entry-000-0000-0000-000000000001'
const SPECIALIST_AGENT_ID = 'agent-specialist-0-0000-000000000002'

type AgentRowOverrides = Partial<{
  id: string
  organization_id: string
  slug: string
  is_active: boolean | null
  allowed_channels: string[] | null
}>

function buildAgentRow(overrides: AgentRowOverrides = {}) {
  return {
    id: SPECIALIST_AGENT_ID,
    organization_id: ORG_ID,
    slug: 'booking_specialist',
    is_active: true,
    allowed_channels: ['voice', 'web_widget'],
    ...overrides,
  }
}

/**
 * Builds a chainable Supabase mock matching resolveSpecialistRoute's exact
 * query shape: .from('agents').select(...).eq().eq().maybeSingle().
 */
function mockAgentLookup(row: ReturnType<typeof buildAgentRow> | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const eqB = vi.fn(() => ({ maybeSingle }))
  const eqA = vi.fn(() => ({ eq: eqB }))
  const select = vi.fn(() => ({ eq: eqA }))
  const from = vi.fn(() => ({ select }))
  const client = { from }
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
  return { from, select, eqA, eqB, maybeSingle }
}

function baseParams(overrides: Partial<ResolveSpecialistRouteParams> = {}): ResolveSpecialistRouteParams {
  return {
    organizationId: ORG_ID,
    channel: 'voice',
    intent: 'booking_specialist',
    ...overrides,
  }
}

describe('resolveSpecialistRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches an active same-org specialist by slug on an allowed channel', async () => {
    mockAgentLookup(buildAgentRow())
    const decision = await resolveSpecialistRoute(baseParams())
    expect(decision.matched).toBe(true)
    if (decision.matched) {
      expect(decision.agentId).toBe(SPECIALIST_AGENT_ID)
      expect(decision.agentSlug).toBe('booking_specialist')
    }
  })

  it('scopes the lookup by organization_id and slug (never a global slug lookup)', async () => {
    const { eqA, eqB } = mockAgentLookup(buildAgentRow())
    await resolveSpecialistRoute(baseParams())
    expect(eqA).toHaveBeenCalledWith('organization_id', ORG_ID)
    expect(eqB).toHaveBeenCalledWith('slug', 'booking_specialist')
  })

  it('denies with no_intent when intent is absent', async () => {
    mockAgentLookup(null)
    const decision = await resolveSpecialistRoute(baseParams({ intent: undefined }))
    expect(decision).toEqual({ matched: false, reason: 'no_intent' })
  })

  it('denies with no_intent when intent is empty/whitespace', async () => {
    mockAgentLookup(null)
    const decision = await resolveSpecialistRoute(baseParams({ intent: '   ' }))
    expect(decision).toEqual({ matched: false, reason: 'no_intent' })
  })

  it('denies with not_found when no agent matches the slug in this org', async () => {
    mockAgentLookup(null)
    const decision = await resolveSpecialistRoute(baseParams({ intent: 'unknown_specialist' }))
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('never returns a match from a different organization', async () => {
    // The query itself is org-scoped (.eq('organization_id', ORG_ID)); simulate
    // the DB correctly returning no row for a slug that only exists in another org.
    mockAgentLookup(null)
    const decision = await resolveSpecialistRoute(
      baseParams({ organizationId: OTHER_ORG_ID, intent: 'booking_specialist' })
    )
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })

  it('defense-in-depth: denies cross_organization if the row somehow does not match the query org', async () => {
    mockAgentLookup(buildAgentRow({ organization_id: OTHER_ORG_ID }))
    const decision = await resolveSpecialistRoute(baseParams())
    expect(decision).toEqual({ matched: false, reason: 'cross_organization' })
  })

  it('denies with inactive when the specialist is not active', async () => {
    mockAgentLookup(buildAgentRow({ is_active: false }))
    const decision = await resolveSpecialistRoute(baseParams())
    expect(decision).toEqual({ matched: false, reason: 'inactive' })
  })

  it('denies with channel_not_allowed when the specialist does not allow this channel', async () => {
    mockAgentLookup(buildAgentRow({ allowed_channels: ['web_widget'] }))
    const decision = await resolveSpecialistRoute(baseParams({ channel: 'voice' }))
    expect(decision).toEqual({ matched: false, reason: 'channel_not_allowed' })
  })

  it('allows the workflow channel regardless of the specialist allowed_channels list', async () => {
    mockAgentLookup(buildAgentRow({ allowed_channels: ['web_widget'] }))
    const decision = await resolveSpecialistRoute(baseParams({ channel: 'workflow' }))
    expect(decision.matched).toBe(true)
  })

  it('denies with not_found on a lookup error', async () => {
    mockAgentLookup(null, { message: 'boom' })
    const decision = await resolveSpecialistRoute(baseParams())
    expect(decision).toEqual({ matched: false, reason: 'not_found' })
  })
})

describe('resolveTrustedAgentRoute (channel-neutral entry/specialist resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes directly to the matched specialist with no router/orchestrator call', async () => {
    mockAgentLookup(buildAgentRow())
    const route = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: 'booking_specialist',
    })
    expect(route).toEqual({ agentId: SPECIALIST_AGENT_ID, specialistMatched: true })
  })

  it('falls back to the configured entry agent when intent is absent (ambiguous)', async () => {
    mockAgentLookup(null)
    const route = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: undefined,
    })
    expect(route).toEqual({ agentId: ENTRY_AGENT_ID, specialistMatched: false })
  })

  it('falls back to the configured entry agent when no specialist matches the intent', async () => {
    mockAgentLookup(null)
    const route = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: 'unmapped_intent',
    })
    expect(route).toEqual({ agentId: ENTRY_AGENT_ID, specialistMatched: false })
  })

  it('falls back to the configured entry agent when the specialist is inactive', async () => {
    mockAgentLookup(buildAgentRow({ is_active: false }))
    const route = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: 'booking_specialist',
    })
    expect(route).toEqual({ agentId: ENTRY_AGENT_ID, specialistMatched: false })
  })

  it('falls back to the configured entry agent when the channel is not allowed for the specialist', async () => {
    mockAgentLookup(buildAgentRow({ allowed_channels: ['web_widget'] }))
    const route = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: 'booking_specialist',
    })
    expect(route).toEqual({ agentId: ENTRY_AGENT_ID, specialistMatched: false })
  })

  it('is channel-neutral: works identically for voice and web_widget without any hardcoded slug or tenant', async () => {
    mockAgentLookup(buildAgentRow({ slug: 'generic_specialist', allowed_channels: ['voice', 'web_widget'] }))
    const voiceRoute = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'voice',
      entryAgentId: ENTRY_AGENT_ID,
      intent: 'generic_specialist',
    })
    mockAgentLookup(buildAgentRow({ slug: 'generic_specialist', allowed_channels: ['voice', 'web_widget'] }))
    const webRoute = await resolveTrustedAgentRoute({
      organizationId: ORG_ID,
      channel: 'web_widget',
      entryAgentId: ENTRY_AGENT_ID,
      intent: 'generic_specialist',
    })
    expect(voiceRoute.specialistMatched).toBe(true)
    expect(webRoute.specialistMatched).toBe(true)
  })
})
