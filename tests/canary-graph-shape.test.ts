// Phase 136 Plan 02 (ROLL-01): proves the shape of the Cuts & Culture canary
// specialist graph and the safety/idempotency of its provisioning script --
// by test, not by reading the JSON and trusting it.
//
// This suite NEVER touches a real organization. scripts/provision-canary-graph.ts
// is exercised only against the in-memory FakeSupabase defined below.

import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  loadCanaryGraph,
  GRAPH_PATH,
  assertOnlyBookingHoldsWriteGrants,
  parseArgs,
  assertSafeToWrite,
  provisionCanaryGraph,
  type CanaryGraph,
} from '../scripts/provision-canary-graph'

const REPO_ROOT = resolve(__dirname, '..')
const SEEDS_WORKFLOWS_DIR = join(REPO_ROOT, 'supabase', 'seeds', 'workflows')

const SPECIALIST_KEYS = ['services', 'pricing', 'availability', 'customer', 'booking'] as const

// ─────────────────────────────────────────────────────────────────────────
// Task 1: the graph as tenant-scoped data
// ─────────────────────────────────────────────────────────────────────────

describe('ROLL-01: Cuts & Culture canary graph shape', () => {
  const graph = loadCanaryGraph()

  it('is declared outside the platform seed path', () => {
    expect(GRAPH_PATH).not.toContain(join('supabase', 'seeds', 'workflows'))
    expect(existsSync(GRAPH_PATH)).toBe(true)
  })

  it('has exactly one entry orchestrator plus the five named specialists', () => {
    const orchestrators = graph.agents.filter((a) => a.role === 'orchestrator')
    const specialists = graph.agents.filter((a) => a.role === 'specialist')
    expect(orchestrators).toHaveLength(1)
    expect(orchestrators[0].key).toBe('entry')
    expect(specialists.map((a) => a.key).sort()).toEqual([...SPECIALIST_KEYS].sort())
    expect(graph.agents).toHaveLength(6)
  })

  it('every agent key is unique', () => {
    const keys = graph.agents.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has exactly one partner edge from entry to each specialist, and no others', () => {
    expect(graph.partner_edges).toHaveLength(5)
    for (const edge of graph.partner_edges) {
      expect(edge.agent_key).toBe('entry')
    }
    expect(graph.partner_edges.map((e) => e.partner_agent_key).sort()).toEqual([...SPECIALIST_KEYS].sort())
  })

  it('every agent and every edge covers both the voice and web_widget channels', () => {
    for (const agent of graph.agents) {
      expect(agent.allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    }
    for (const edge of graph.partner_edges) {
      expect(edge.allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    }
  })

  it('voice and widget resolve to the SAME Availability specialist -- one agent, one edge, by id', () => {
    const availabilityAgents = graph.agents.filter((a) => a.key === 'availability')
    const availabilityEdges = graph.partner_edges.filter((e) => e.partner_agent_key === 'availability')
    expect(availabilityAgents).toHaveLength(1)
    expect(availabilityEdges).toHaveLength(1)
    // The single edge covers both channels rather than there being two
    // channel-specific copies of the specialist.
    expect(availabilityEdges[0].allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    expect(availabilityAgents[0].allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
  })

  it('declares both read and write Xkedule workflows, matching the 8 execute-action.ts xkedule_* cases', () => {
    const toolNames = graph.workflows.map((w) => w.tool_name).sort()
    expect(toolNames).toEqual(
      [
        'xkedule_business_info',
        'xkedule_cancel_booking',
        'xkedule_check_availability',
        'xkedule_create_booking',
        'xkedule_get_services',
        'xkedule_lookup_customer',
        'xkedule_quote',
        'xkedule_reschedule_booking',
      ].sort(),
    )
    const writeTools = graph.workflows.filter((w) => w.access === 'write').map((w) => w.tool_name).sort()
    expect(writeTools).toEqual(['xkedule_cancel_booking', 'xkedule_create_booking', 'xkedule_reschedule_booking'].sort())
  })

  it('only the edge to Booking grants a write-access workflow -- proven against the grant data, not the label', () => {
    expect(() => assertOnlyBookingHoldsWriteGrants(graph)).not.toThrow()

    const writeKeys = new Set(graph.workflows.filter((w) => w.access === 'write').map((w) => w.key))
    const edgesGrantingWrite = graph.partner_edges.filter((e) => e.workflow_grants.some((k) => writeKeys.has(k)))
    expect(edgesGrantingWrite).toHaveLength(1)
    expect(edgesGrantingWrite[0].partner_agent_key).toBe('booking')

    // Every non-booking edge holds zero write-access grants.
    for (const edge of graph.partner_edges) {
      if (edge.partner_agent_key === 'booking') continue
      expect(edge.workflow_grants.every((k) => !writeKeys.has(k))).toBe(true)
    }
  })

  it('assertOnlyBookingHoldsWriteGrants rejects a graph that drifts from the locked decision', () => {
    const corrupted: CanaryGraph = JSON.parse(JSON.stringify(graph))
    const servicesEdge = corrupted.partner_edges.find((e) => e.partner_agent_key === 'services')!
    servicesEdge.workflow_grants.push('create_booking')
    expect(() => assertOnlyBookingHoldsWriteGrants(corrupted)).toThrow(/only "booking" may hold an Xkedule write grant/)
  })

  it('every edge workflow_grants key resolves to a declared workflow', () => {
    const workflowKeys = new Set(graph.workflows.map((w) => w.key))
    for (const edge of graph.partner_edges) {
      for (const grant of edge.workflow_grants) {
        expect(workflowKeys.has(grant)).toBe(true)
      }
    }
  })

  it('per-edge budgets stay within the 1291 migration bounds (calls 1-10, depth 1-5, timeout 1000-120000ms)', () => {
    for (const edge of graph.partner_edges) {
      expect(edge.max_calls_per_turn).toBeGreaterThanOrEqual(1)
      expect(edge.max_calls_per_turn).toBeLessThanOrEqual(10)
      expect(edge.max_depth).toBeGreaterThanOrEqual(1)
      expect(edge.max_depth).toBeLessThanOrEqual(5)
      expect(edge.timeout_ms).toBeGreaterThanOrEqual(1000)
      expect(edge.timeout_ms).toBeLessThanOrEqual(120000)
    }
  })

  it('the platform seed path is untouched -- no seed file references this tenant', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
          const content = readFileSync(full, 'utf8')
          if (/cuts.{0,3}(&|and).{0,3}culture/i.test(content)) offenders.push(full)
        }
      }
    }
    walk(SEEDS_WORKFLOWS_DIR)
    expect(offenders).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Fake Supabase client -- the ONLY client the provisioning script is ever
// exercised against in this repo. No test in this file opens a network
// connection or reads real Supabase env vars.
// ─────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<[string, unknown]> = []
  private pendingOp: { type: 'upsert' | 'insert'; rows: Row[]; onConflict?: string } | null = null

  constructor(private readonly client: FakeSupabase, private readonly table: string) {}

  select(_cols: string): this {
    return this
  }

  eq(col: string, val: unknown): this {
    this.filters.push([col, val])
    return this
  }

  upsert(rowOrRows: Row | Row[], opts?: { onConflict?: string }): this {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
    this.pendingOp = { type: 'upsert', rows, onConflict: opts?.onConflict }
    return this
  }

  insert(rowOrRows: Row | Row[]): this {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
    this.pendingOp = { type: 'insert', rows }
    return this
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  private execWrite(): Row[] {
    const table = this.client.tables[this.table] ?? (this.client.tables[this.table] = [])
    const results: Row[] = []
    for (const row of this.pendingOp!.rows) {
      if (this.pendingOp!.type === 'upsert' && this.pendingOp!.onConflict) {
        const keys = this.pendingOp!.onConflict.split(',')
        const existingIdx = table.findIndex((r) => keys.every((k) => r[k] === row[k]))
        if (existingIdx >= 0) {
          table[existingIdx] = { ...table[existingIdx], ...row }
          this.client.writeLog.push({ table: this.table, op: 'upsert:update', row: table[existingIdx] })
          results.push(table[existingIdx])
          continue
        }
      }
      const newRow: Row = { id: `fake-${this.table}-${table.length}-${Math.random().toString(36).slice(2, 8)}`, ...row }
      table.push(newRow)
      this.client.writeLog.push({ table: this.table, op: this.pendingOp!.type, row: newRow })
      results.push(newRow)
    }
    return results
  }

  private async resolve(): Promise<{ data: unknown; error: { message: string } | null }> {
    if (this.pendingOp) {
      try {
        return { data: this.execWrite(), error: null }
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } }
      }
    }
    const table = this.client.tables[this.table] ?? []
    return { data: table.filter((r) => this.matches(r)), error: null }
  }

  async maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const { data, error } = await this.resolve()
    if (error) return { data: null, error }
    const arr = (Array.isArray(data) ? data : []) as Row[]
    return { data: arr[0] ?? null, error: null }
  }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const result = await this.maybeSingle()
    if (!result.data) return { data: null, error: { message: 'no rows found' } }
    return result
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {}
  writeLog: Array<{ table: string; op: string; row: Row }> = []

  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((r) => ({ ...r }))
  }

  // Matches the subset of the supabase-js surface provision-canary-graph.ts uses.
  from(table: string) {
    return new FakeQuery(this, table) as unknown as ReturnType<
      import('@supabase/supabase-js').SupabaseClient['from']
    >
  }
}

const TARGET_ORG_ID = '11111111-1111-4111-8111-111111111111'

function freshClient(orgSlug = 'cuts-and-culture'): FakeSupabase {
  const client = new FakeSupabase()
  client.seed('organizations', [{ id: TARGET_ORG_ID, slug: orgSlug }])
  return client
}

// ─────────────────────────────────────────────────────────────────────────
// Task 2: safe, idempotent, dry-run-by-default provisioning
// ─────────────────────────────────────────────────────────────────────────

describe('ROLL-01: provision-canary-graph.ts safety and idempotency', () => {
  let graph: CanaryGraph

  beforeEach(() => {
    graph = loadCanaryGraph()
  })

  it('parseArgs defaults to dry run and never reads an org id from the environment', () => {
    process.env.DEMO_ORG_ID = 'should-never-be-used'
    process.env.ORG_ID = 'should-never-be-used-either'
    try {
      expect(parseArgs([])).toEqual({ org: null, apply: false })
      expect(parseArgs(['--apply'])).toEqual({ org: null, apply: true })
      expect(parseArgs(['--org=abc-123'])).toEqual({ org: 'abc-123', apply: false })
      expect(parseArgs(['--org=abc-123', '--apply'])).toEqual({ org: 'abc-123', apply: true })
    } finally {
      delete process.env.DEMO_ORG_ID
      delete process.env.ORG_ID
    }
  })

  it('refuses --apply without an explicit --org', () => {
    expect(() => assertSafeToWrite({ org: null, apply: true })).toThrow(/requires an explicit --org/)
    expect(() => assertSafeToWrite({ org: TARGET_ORG_ID, apply: true })).not.toThrow()
    expect(() => assertSafeToWrite({ org: null, apply: false })).not.toThrow()
  })

  it('a dry run against a valid target organization performs zero writes', async () => {
    const client = freshClient()
    const result = await provisionCanaryGraph({
      supabase: client as never,
      graph,
      organizationId: TARGET_ORG_ID,
      apply: false,
    })
    expect(result.dryRun).toBe(true)
    expect(client.writeLog).toHaveLength(0)
    for (const table of ['agents', 'workflows', 'agent_partners', 'agent_partner_workflow_grants']) {
      expect(client.tables[table] ?? []).toHaveLength(0)
    }
  })

  it('refuses to provision against an organization whose slug does not match the graph target', async () => {
    const client = freshClient('some-other-tenant')
    await expect(
      provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true }),
    ).rejects.toThrow(/Refusing to provision the Cuts & Culture canary graph against a different tenant/)
    expect(client.writeLog).toHaveLength(0)
  })

  it('refuses to provision against an organization id that does not exist', async () => {
    const client = new FakeSupabase() // organizations table left empty
    await expect(
      provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true }),
    ).rejects.toThrow(/does not exist/)
    expect(client.writeLog).toHaveLength(0)
  })

  it('applies the full graph, writing only within the target organization', async () => {
    const client = freshClient()
    const result = await provisionCanaryGraph({
      supabase: client as never,
      graph,
      organizationId: TARGET_ORG_ID,
      apply: true,
    })

    expect(result.dryRun).toBe(false)
    expect(client.tables.agents).toHaveLength(6)
    expect(client.tables.workflows).toHaveLength(8)
    expect(client.tables.agent_partners).toHaveLength(5)
    expect(client.tables.agent_partner_workflow_grants).toHaveLength(8) // 1+1+1+2+3

    for (const table of ['agents', 'workflows', 'agent_partners', 'agent_partner_workflow_grants']) {
      for (const row of client.tables[table]) {
        const orgField = (row.organization_id ?? row.org_id) as string
        expect(orgField).toBe(TARGET_ORG_ID)
      }
    }
  })

  it('re-running after a successful apply is a no-op, not a duplicate graph', async () => {
    const client = freshClient()
    const first = await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })
    const countsAfterFirst = {
      agents: client.tables.agents.length,
      workflows: client.tables.workflows.length,
      agent_partners: client.tables.agent_partners.length,
      grants: client.tables.agent_partner_workflow_grants.length,
    }

    const second = await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    expect(client.tables.agents).toHaveLength(countsAfterFirst.agents)
    expect(client.tables.workflows).toHaveLength(countsAfterFirst.workflows)
    expect(client.tables.agent_partners).toHaveLength(countsAfterFirst.agent_partners)
    expect(client.tables.agent_partner_workflow_grants).toHaveLength(countsAfterFirst.grants)

    // Same rows, same ids -- not a parallel duplicate graph.
    expect(second.agentIds).toEqual(first.agentIds)
    expect(second.workflowIds).toEqual(first.workflowIds)
    expect(second.edgeIds).toEqual(first.edgeIds)
  })

  it('only Booking ends up with an Xkedule write grant -- proven against the written grant rows, not the JSON', async () => {
    const client = freshClient()
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    const agentsById = new Map(client.tables.agents.map((a) => [a.id as string, a]))
    const edgesById = new Map(client.tables.agent_partners.map((e) => [e.id as string, e]))
    const workflowsById = new Map(client.tables.workflows.map((w) => [w.id as string, w]))

    const writeToolNames = new Set(['xkedule_create_booking', 'xkedule_cancel_booking', 'xkedule_reschedule_booking'])

    let writeGrantCount = 0
    for (const grant of client.tables.agent_partner_workflow_grants) {
      const workflow = workflowsById.get(grant.workflow_id as string)!
      const isWrite = writeToolNames.has(workflow.tool_name as string)
      const edge = edgesById.get(grant.partner_edge_id as string)!
      const partnerAgent = agentsById.get(edge.partner_agent_id as string)!
      if (isWrite) {
        writeGrantCount += 1
        expect(partnerAgent.slug).toBe('cuts-and-culture-booking')
      } else {
        expect(partnerAgent.slug).not.toBe('cuts-and-culture-booking')
      }
    }
    expect(writeGrantCount).toBe(3)
  })

  it('voice and widget resolve to the same Availability specialist row in the provisioned data, by id', async () => {
    const client = freshClient()
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    const availabilityAgents = client.tables.agents.filter((a) => a.slug === 'cuts-and-culture-availability')
    expect(availabilityAgents).toHaveLength(1)
    const availabilityId = availabilityAgents[0].id

    const availabilityEdges = client.tables.agent_partners.filter((e) => e.partner_agent_id === availabilityId)
    expect(availabilityEdges).toHaveLength(1)
    expect(availabilityEdges[0].allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
  })

  it('never writes to any other organization', async () => {
    const otherOrgId = '22222222-2222-4222-8222-222222222222'
    const client = freshClient()
    client.tables.organizations.push({ id: otherOrgId, slug: 'some-unrelated-org' })
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    for (const table of ['agents', 'workflows', 'agent_partners', 'agent_partner_workflow_grants']) {
      const rows = client.tables[table] ?? []
      expect(rows.some((r) => (r.organization_id ?? r.org_id) === otherOrgId)).toBe(false)
    }
  })
})
