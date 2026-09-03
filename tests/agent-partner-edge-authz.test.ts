// tests/agent-partner-edge-authz.test.ts
// Phase 132 Plan 02 (ROUT-03, AUTHZ-01, AUTHZ-02, AUTHZ-03)
//
// Task 1: structural contract tests for migration 1291 (composite same-org
// FKs, bounded budget CHECK constraints, normalized delegated-workflow grant
// table — source-only, never applied here) plus database.ts widening.
//
// Task 2: unit tests for resolvePartnerEdge() — a fail-closed preflight that
// is intentionally separate from resolveAgentTool() (direct tool ownership).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Task 1: migration 1291 structural contract
// ---------------------------------------------------------------------------

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/1291_authorized_agent_partner_edges.sql'
)

describe('migration 1291 authorized agent partner edges', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds composite same-organization FKs for both edge endpoints', () => {
    expect(sql).toContain('agent_partners_agent_same_org_fkey')
    expect(sql).toContain('agent_partners_partner_agent_same_org_fkey')
    expect(sql).toContain('FOREIGN KEY (organization_id, agent_id)')
    expect(sql).toContain('FOREIGN KEY (organization_id, partner_agent_id)')
    // Both endpoint FKs must resolve against the same-org composite key.
    const refs = sql.match(/REFERENCES public\.agents\(organization_id, id\)/g) ?? []
    expect(refs.length).toBeGreaterThanOrEqual(2)
  })

  it('adds explicit channel policy and bounded call/depth/timeout budget columns', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS allowed_channels public.agent_channel[]')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS max_calls_per_turn integer NOT NULL DEFAULT 3')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS max_depth integer NOT NULL DEFAULT 2')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS timeout_ms integer NOT NULL DEFAULT 30000')
    expect(sql).toContain('CHECK (max_calls_per_turn BETWEEN 1 AND 10)')
    expect(sql).toContain('CHECK (max_depth BETWEEN 1 AND 5)')
    expect(sql).toContain('CHECK (timeout_ms BETWEEN 1000 AND 120000)')
  })

  it('represents delegated workflows as a normalized same-organization grant table, not a UUID array', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agent_partner_workflow_grants')
    expect(sql).not.toMatch(/delegated_workflow_ids\s+uuid\[\]/i)
    expect(sql).toContain('agent_partner_workflow_grants_edge_same_org_fkey')
    expect(sql).toContain('agent_partner_workflow_grants_workflow_same_org_fkey')
    expect(sql).toContain('REFERENCES public.agent_partners(organization_id, id)')
    expect(sql).toContain('REFERENCES public.workflows(org_id, id)')
    expect(sql).toContain('UNIQUE (partner_edge_id, workflow_id)')
  })

  it('enables RLS with an org-scoped policy on the new grant table', () => {
    expect(sql).toContain('ALTER TABLE public.agent_partner_workflow_grants ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/organization_id = \(SELECT public\.get_current_org_id\(\)\)/)
  })

  it('is idempotent: every ADD CONSTRAINT is guarded by a preceding IF NOT EXISTS check', () => {
    const lines = sql.split('\n')
    const constraintLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /ADD CONSTRAINT/.test(line))
    expect(constraintLines.length).toBeGreaterThan(0)
    for (const { i } of constraintLines) {
      const precedingWindow = lines.slice(Math.max(0, i - 10), i).join('\n')
      expect(precedingWindow).toMatch(/IF NOT EXISTS \(/)
    }
  })

  it('performs no tenant-specific inserts, updates, or data backfill', () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.agent_partners/i)
    expect(sql).not.toMatch(/UPDATE\s+public\.agent_partners\s+SET/i)
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.agent_partner_workflow_grants/i)
  })

  it('documents the fail-closed conservative default for legacy edges', () => {
    expect(sql).toMatch(/no delegated workflow\s*\n?-- ?authority/i)
  })
})

const databaseTypesPath = resolve(process.cwd(), 'src/types/database.ts')

describe('database.ts widened for agent_partners edge policy', () => {
  const source = readFileSync(databaseTypesPath, 'utf8')

  it('adds the new policy columns to the agent_partners Row type', () => {
    const start = source.indexOf('agent_partners: {')
    const end = source.indexOf('agent_partner_workflow_grants: {')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = source.slice(start, end)
    expect(block).toContain('allowed_channels: AgentChannel[] | null')
    expect(block).toContain('max_calls_per_turn: number')
    expect(block).toContain('max_depth: number')
    expect(block).toContain('timeout_ms: number')
    expect(block).toContain('agent_partners_agent_same_org_fkey')
    expect(block).toContain('agent_partners_partner_agent_same_org_fkey')
  })

  it('adds the agent_partner_workflow_grants table type', () => {
    expect(source).toContain('agent_partner_workflow_grants: {')
    expect(source).toContain('agent_partner_workflow_grants_edge_same_org_fkey')
    expect(source).toContain('agent_partner_workflow_grants_workflow_same_org_fkey')
  })
})

// ---------------------------------------------------------------------------
// Task 2: resolvePartnerEdge() fail-closed preflight
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  resolvePartnerEdge,
  isWorkflowDelegatedThroughEdge,
  type ResolvePartnerEdgeParams,
} from '@/lib/agent-runtime/resolve-partner-edge'

const ORG_ID = 'org-11111111-1111-1111-1111-111111111111'
const SOURCE_AGENT_ID = 'agent-source-0000-0000-0000-000000000001'
const PARTNER_AGENT_ID = 'agent-partner-000-0000-0000-000000000002'

type EdgeRowOverrides = Partial<{
  id: string
  organization_id: string
  allowed_channels: string[] | null
  max_calls_per_turn: number | null
  max_depth: number | null
  timeout_ms: number | null
  source: { id: string; organization_id: string; is_active: boolean | null } | null
  target: { id: string; organization_id: string; is_active: boolean | null } | null
  agent_partner_workflow_grants: { workflow_id: string }[] | null
}>

function buildEdgeRow(overrides: EdgeRowOverrides = {}) {
  return {
    id: 'edge-0000-0000-0000-0000-000000000001',
    organization_id: ORG_ID,
    allowed_channels: null,
    max_calls_per_turn: 3,
    max_depth: 2,
    timeout_ms: 30000,
    source: { id: SOURCE_AGENT_ID, organization_id: ORG_ID, is_active: true },
    target: { id: PARTNER_AGENT_ID, organization_id: ORG_ID, is_active: true },
    agent_partner_workflow_grants: [],
    ...overrides,
  }
}

/**
 * Builds a chainable Supabase mock matching resolvePartnerEdge's exact query
 * shape: .from('agent_partners').select(...).eq().eq().eq().maybeSingle().
 */
function mockEdgeLookup(row: ReturnType<typeof buildEdgeRow> | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const eqC = vi.fn(() => ({ maybeSingle }))
  const eqB = vi.fn(() => ({ eq: eqC }))
  const eqA = vi.fn(() => ({ eq: eqB }))
  const select = vi.fn(() => ({ eq: eqA }))
  const from = vi.fn(() => ({ select }))
  const client = { from }
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
  return { from, select, eqA, eqB, eqC, maybeSingle }
}

function baseParams(overrides: Partial<ResolvePartnerEdgeParams> = {}): ResolvePartnerEdgeParams {
  return {
    organizationId: ORG_ID,
    sourceAgentId: SOURCE_AGENT_ID,
    partnerAgentId: PARTNER_AGENT_ID,
    channel: 'web_widget',
    currentDepth: 0,
    currentCallCount: 0,
    ...overrides,
  }
}

describe('resolvePartnerEdge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows traversal for a healthy same-org edge with no configured grants', async () => {
    mockEdgeLookup(buildEdgeRow())
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision.allow).toBe(true)
    if (decision.allow) {
      expect(decision.partnerAgentId).toBe(PARTNER_AGENT_ID)
      expect(decision.maxCallsPerTurn).toBe(3)
      expect(decision.maxDepth).toBe(2)
      expect(decision.timeoutMs).toBe(30000)
      // 132-CONTEXT.md: legacy/default edges carry NO delegated workflow authority.
      expect(decision.grantedWorkflowIds).toEqual([])
    }
  })

  it('surfaces the normalized delegated-workflow grant list when explicitly configured', async () => {
    mockEdgeLookup(
      buildEdgeRow({ agent_partner_workflow_grants: [{ workflow_id: 'wf-1' }, { workflow_id: 'wf-2' }] })
    )
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision.allow).toBe(true)
    if (decision.allow) {
      expect(decision.grantedWorkflowIds).toEqual(['wf-1', 'wf-2'])
    }
  })

  it('denies when no edge row exists', async () => {
    mockEdgeLookup(null)
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision).toEqual({ allow: false, reason: 'edge_not_found' })
  })

  it('denies on a Supabase error even if a row is returned', async () => {
    mockEdgeLookup(buildEdgeRow(), new Error('boom'))
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision).toEqual({ allow: false, reason: 'edge_not_found' })
  })

  it('denies (defense-in-depth) when the edge organization does not match the trusted org', async () => {
    mockEdgeLookup(buildEdgeRow({ organization_id: 'org-other' }))
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision).toEqual({ allow: false, reason: 'cross_organization' })
  })

  it('denies when the source agent is inactive', async () => {
    mockEdgeLookup(buildEdgeRow({ source: { id: SOURCE_AGENT_ID, organization_id: ORG_ID, is_active: false } }))
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision).toEqual({ allow: false, reason: 'source_inactive' })
  })

  it('denies when the target (partner) agent is inactive', async () => {
    mockEdgeLookup(buildEdgeRow({ target: { id: PARTNER_AGENT_ID, organization_id: ORG_ID, is_active: false } }))
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision).toEqual({ allow: false, reason: 'target_inactive' })
  })

  it('denies when the channel is not in the edge allowed_channels list', async () => {
    mockEdgeLookup(buildEdgeRow({ allowed_channels: ['voice'] }))
    const decision = await resolvePartnerEdge(baseParams({ channel: 'web_widget' }))
    expect(decision).toEqual({ allow: false, reason: 'channel_not_allowed' })
  })

  it('allows when allowed_channels is null (every channel the specialist itself allows)', async () => {
    mockEdgeLookup(buildEdgeRow({ allowed_channels: null }))
    const decision = await resolvePartnerEdge(baseParams({ channel: 'voice' }))
    expect(decision.allow).toBe(true)
  })

  it('allows when the channel is explicitly present in allowed_channels', async () => {
    mockEdgeLookup(buildEdgeRow({ allowed_channels: ['voice', 'web_widget'] }))
    const decision = await resolvePartnerEdge(baseParams({ channel: 'voice' }))
    expect(decision.allow).toBe(true)
  })

  it('denies when current depth has reached the edge max_depth', async () => {
    mockEdgeLookup(buildEdgeRow({ max_depth: 2 }))
    const decision = await resolvePartnerEdge(baseParams({ currentDepth: 2 }))
    expect(decision).toEqual({ allow: false, reason: 'depth_exceeded' })
  })

  it('denies when current call count has reached the edge max_calls_per_turn', async () => {
    mockEdgeLookup(buildEdgeRow({ max_calls_per_turn: 3 }))
    const decision = await resolvePartnerEdge(baseParams({ currentCallCount: 3 }))
    expect(decision).toEqual({ allow: false, reason: 'call_count_exceeded' })
  })

  it.each([
    { max_depth: null },
    { max_depth: 0 },
    { max_calls_per_turn: null },
    { max_calls_per_turn: 0 },
    { timeout_ms: null },
    { timeout_ms: 0 },
  ])('fails closed for side effects on malformed policy %o', async (overrides) => {
    mockEdgeLookup(buildEdgeRow(overrides as EdgeRowOverrides))
    const decision = await resolvePartnerEdge(baseParams())
    expect(decision).toEqual({ allow: false, reason: 'malformed_policy' })
  })

  it('denies invalid_request for missing identity fields instead of throwing', async () => {
    const decision = await resolvePartnerEdge(baseParams({ organizationId: '' }))
    expect(decision).toEqual({ allow: false, reason: 'invalid_request' })
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('denies invalid_request for negative depth/call counters instead of throwing', async () => {
    const decision = await resolvePartnerEdge(baseParams({ currentDepth: -1 }))
    expect(decision).toEqual({ allow: false, reason: 'invalid_request' })
  })

  it('ignores extra payload-shaped properties merged onto the trusted params object', async () => {
    const { eqA } = mockEdgeLookup(buildEdgeRow())
    const spoofed = {
      ...baseParams(),
      // Simulates an LLM-controlled payload accidentally spread in by a caller.
      organization_id: 'attacker-org',
      agentId: 'attacker-agent',
      role: 'system',
    } as ResolvePartnerEdgeParams
    const decision = await resolvePartnerEdge(spoofed)
    expect(decision.allow).toBe(true)
    // The query is built only from the named, trusted fields.
    expect(eqA).toHaveBeenCalledWith('organization_id', ORG_ID)
  })
})

describe('isWorkflowDelegatedThroughEdge (AUTHZ-02: never a direct tool grant)', () => {
  it('returns true only when the workflow is present in the edge grant list', async () => {
    mockEdgeLookup(buildEdgeRow({ agent_partner_workflow_grants: [{ workflow_id: 'wf-allowed' }] }))
    const decision = await resolvePartnerEdge(baseParams())
    expect(isWorkflowDelegatedThroughEdge(decision, 'wf-allowed')).toBe(true)
    expect(isWorkflowDelegatedThroughEdge(decision, 'wf-not-granted')).toBe(false)
  })

  it('returns false for any workflow when the edge itself was denied', () => {
    const denied = { allow: false, reason: 'edge_not_found' } as const
    expect(isWorkflowDelegatedThroughEdge(denied, 'wf-anything')).toBe(false)
  })

  it('returns false when no grants are configured (legacy edge, no delegated side effects)', async () => {
    mockEdgeLookup(buildEdgeRow({ agent_partner_workflow_grants: [] }))
    const decision = await resolvePartnerEdge(baseParams())
    expect(isWorkflowDelegatedThroughEdge(decision, 'wf-anything')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task 2: agentPartnerEdgeSchema (config-layer validation for the edge policy)
// ---------------------------------------------------------------------------

import { agentPartnerEdgeSchema } from '@/lib/agents/zod-schemas'

describe('agentPartnerEdgeSchema', () => {
  const validPayload = {
    partner_agent_id: '11111111-1111-1111-1111-111111111111',
    invocation_description: 'Call the billing specialist for invoice questions.',
    allowed_channels: null,
    max_calls_per_turn: 3,
    max_depth: 2,
    timeout_ms: 30000,
    granted_workflow_ids: [] as string[],
  }

  it('accepts a valid payload with null allowed_channels (legacy default)', () => {
    expect(agentPartnerEdgeSchema.safeParse(validPayload).success).toBe(true)
  })

  it('accepts an explicit non-empty allowed_channels list', () => {
    const r = agentPartnerEdgeSchema.safeParse({ ...validPayload, allowed_channels: ['voice'] })
    expect(r.success).toBe(true)
  })

  it('rejects an empty allowed_channels array (ambiguous with "no channels")', () => {
    const r = agentPartnerEdgeSchema.safeParse({ ...validPayload, allowed_channels: [] })
    expect(r.success).toBe(false)
  })

  it.each([0, 11])('rejects out-of-bounds max_calls_per_turn=%i', (max_calls_per_turn) => {
    expect(agentPartnerEdgeSchema.safeParse({ ...validPayload, max_calls_per_turn }).success).toBe(false)
  })

  it.each([0, 6])('rejects out-of-bounds max_depth=%i', (max_depth) => {
    expect(agentPartnerEdgeSchema.safeParse({ ...validPayload, max_depth }).success).toBe(false)
  })

  it.each([500, 999999])('rejects out-of-bounds timeout_ms=%i', (timeout_ms) => {
    expect(agentPartnerEdgeSchema.safeParse({ ...validPayload, timeout_ms }).success).toBe(false)
  })

  it('rejects a non-uuid partner_agent_id', () => {
    const r = agentPartnerEdgeSchema.safeParse({ ...validPayload, partner_agent_id: 'not-a-uuid' })
    expect(r.success).toBe(false)
  })

  it('rejects a non-uuid entry in granted_workflow_ids', () => {
    const r = agentPartnerEdgeSchema.safeParse({ ...validPayload, granted_workflow_ids: ['nope'] })
    expect(r.success).toBe(false)
  })
})
