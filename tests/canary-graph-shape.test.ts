// Phase 137 Plan 01 (MESH-01/MESH-03): proves the shape of the Cuts & Culture
// canary specialist mesh and the safety/idempotency of its provisioning
// script -- by test, not by reading the JSON and trusting it.
//
// This suite NEVER touches a real organization. scripts/provision-canary-graph.ts
// is exercised only against the in-memory FakeSupabase defined below.
//
// The graph was rewritten against the tenant's REAL workflow tool names
// (137-CONTEXT.md "Tenant reality") and conforms to the CanaryGraph /
// CanaryAgentDef / CanaryWorkflowDef / CanaryEdgeDef interfaces declared in
// scripts/provision-canary-graph.ts.

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

// The eight REAL tool names for this tenant, verified from the live database
// on 2026-09-04 (137-CONTEXT.md "Tenant reality"). An earlier revision of
// this graph invented five tool names that do not exist for this org.
const REAL_TOOL_NAMES = [
  'list_services',
  'business_info',
  'get_quote',
  'check_availability',
  'lookup_customer',
  'book_appointment',
  'reschedule_appointment',
  'cancel_appointment',
] as const

const WRITE_TOOL_NAMES = ['book_appointment', 'reschedule_appointment', 'cancel_appointment'] as const

// ─────────────────────────────────────────────────────────────────────────
// Task 1: the graph as tenant-scoped data
// ─────────────────────────────────────────────────────────────────────────

describe('MESH-01: Cuts & Culture canary graph shape', () => {
  const graph = loadCanaryGraph()

  it('is declared outside the platform seed path', () => {
    expect(GRAPH_PATH).not.toContain(join('supabase', 'seeds', 'workflows'))
    expect(existsSync(GRAPH_PATH)).toBe(true)
  })

  it('targets the real tenant slug, not a placeholder', () => {
    expect(graph.organization.slug).toBe('cuts-culture-barbershop')
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

  it('the orchestrator holds no direct tool of its own', () => {
    const entry = graph.agents.find((a) => a.key === 'entry')!
    expect(entry.direct_tools).toEqual([])
  })

  it('routes named-service availability directly without a Services detour', () => {
    const entry = graph.agents.find((a) => a.key === 'entry')!
    expect(entry.system_prompt).toContain('hand directly to Availability')
    expect(entry.system_prompt).toContain('Never call Services first just to obtain an id')
  })

  it('every specialist directly owns exactly the tools it needs, using only real tool names', () => {
    const byKey = new Map(graph.agents.map((a) => [a.key, a]))
    expect(byKey.get('services')!.direct_tools.sort()).toEqual(['business_info', 'list_services'].sort())
    expect(byKey.get('pricing')!.direct_tools.sort()).toEqual(['get_quote', 'list_services'].sort())
    expect(byKey.get('availability')!.direct_tools.sort()).toEqual(['check_availability', 'list_services'].sort())
    expect(byKey.get('customer')!.direct_tools).toEqual(['lookup_customer'])
    expect(byKey.get('booking')!.direct_tools.sort()).toEqual(
      ['book_appointment', 'reschedule_appointment', 'cancel_appointment', 'list_services'].sort(),
    )
    for (const agent of graph.agents) {
      for (const toolName of agent.direct_tools) {
        expect(REAL_TOOL_NAMES).toContain(toolName)
      }
    }
  })

  it('has exactly one edge from entry to each specialist, plus the two authorized specialist-to-specialist edges -- not a star topology', () => {
    expect(graph.partner_edges).toHaveLength(7)

    const fromEntry = graph.partner_edges.filter((e) => e.agent_key === 'entry')
    expect(fromEntry).toHaveLength(5)
    expect(fromEntry.map((e) => e.partner_agent_key).sort()).toEqual([...SPECIALIST_KEYS].sort())

    const specialistToSpecialist = graph.partner_edges.filter((e) => e.agent_key !== 'entry')
    expect(specialistToSpecialist).toHaveLength(2)
    expect(
      specialistToSpecialist.map((e) => `${e.agent_key}->${e.partner_agent_key}`).sort(),
    ).toEqual(['booking->availability', 'booking->customer'].sort())
  })

  it('every agent and every edge covers both the voice and web_widget channels', () => {
    for (const agent of graph.agents) {
      expect(agent.allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    }
    for (const edge of graph.partner_edges) {
      expect(edge.allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    }
  })

  it('voice and widget resolve to the SAME Availability specialist -- one agent row, reachable by two edges, by id', () => {
    const availabilityAgents = graph.agents.filter((a) => a.key === 'availability')
    const availabilityEdges = graph.partner_edges.filter((e) => e.partner_agent_key === 'availability')
    expect(availabilityAgents).toHaveLength(1)
    // Reachable both from the entry orchestrator (voice/widget explicit or
    // ambiguous intent) and from Booking (confirm-before-write) -- always
    // the same specialist row, never a per-caller copy.
    expect(availabilityEdges).toHaveLength(2)
    expect(new Set(availabilityEdges.map((e) => e.partner_agent_key))).toEqual(new Set(['availability']))
    for (const edge of availabilityEdges) {
      expect(edge.allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    }
    expect(availabilityAgents[0].allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
  })

  it('declares exactly the eight real tool names for this tenant -- an earlier revision invented five that do not exist', () => {
    const toolNames = graph.workflows.map((w) => w.tool_name).sort()
    expect(toolNames).toEqual([...REAL_TOOL_NAMES].sort())

    const writeTools = graph.workflows.filter((w) => w.access === 'write').map((w) => w.tool_name).sort()
    expect(writeTools).toEqual([...WRITE_TOOL_NAMES].sort())
  })

  it('workflow key equals tool_name -- edges and direct_tools grant by the real tool name directly', () => {
    for (const wf of graph.workflows) {
      expect(wf.key).toBe(wf.tool_name)
    }
  })

  it('only the edge to Booking grants a write-access workflow -- proven against the grant data, not the label', () => {
    expect(() => assertOnlyBookingHoldsWriteGrants(graph)).not.toThrow()

    const writeKeys = new Set(graph.workflows.filter((w) => w.access === 'write').map((w) => w.key))
    const edgesGrantingWrite = graph.partner_edges.filter((e) => e.workflow_grants.some((k) => writeKeys.has(k)))
    expect(edgesGrantingWrite).toHaveLength(1)
    expect(edgesGrantingWrite[0].partner_agent_key).toBe('booking')

    // Every non-booking-destination edge holds zero write-access grants,
    // including the booking->customer and booking->availability edges --
    // Booking is the one agent with write authority, not every edge it sits on.
    for (const edge of graph.partner_edges) {
      if (edge.partner_agent_key === 'booking') continue
      expect(edge.workflow_grants.every((k) => !writeKeys.has(k))).toBe(true)
    }
  })

  it('only Booking directly owns a write-access workflow', () => {
    const writeKeys = new Set(graph.workflows.filter((w) => w.access === 'write').map((w) => w.key))
    for (const agent of graph.agents) {
      const ownsWrite = agent.direct_tools.some((k) => writeKeys.has(k))
      expect(ownsWrite).toBe(agent.key === 'booking')
    }
  })

  it('assertOnlyBookingHoldsWriteGrants rejects a graph whose edge drifts from the locked decision', () => {
    const corrupted: CanaryGraph = JSON.parse(JSON.stringify(graph))
    const servicesEdge = corrupted.partner_edges.find((e) => e.partner_agent_key === 'services')!
    servicesEdge.workflow_grants.push('book_appointment')
    expect(() => assertOnlyBookingHoldsWriteGrants(corrupted)).toThrow(/only "booking" may hold an Xkedule write grant/)
  })

  it('assertOnlyBookingHoldsWriteGrants rejects a graph whose direct ownership drifts from the locked decision', () => {
    const corrupted: CanaryGraph = JSON.parse(JSON.stringify(graph))
    const servicesAgent = corrupted.agents.find((a) => a.key === 'services')!
    servicesAgent.direct_tools.push('cancel_appointment')
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

  it('every agent direct_tools key resolves to a declared workflow', () => {
    const workflowKeys = new Set(graph.workflows.map((w) => w.key))
    for (const agent of graph.agents) {
      for (const toolName of agent.direct_tools) {
        expect(workflowKeys.has(toolName)).toBe(true)
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
          if (/cuts.{0,3}(&|and|-).{0,3}culture/i.test(content) || content.includes('cuts-culture-barbershop')) {
            offenders.push(full)
          }
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
const TARGET_ORG_SLUG = 'cuts-culture-barbershop'

function freshClient(orgSlug = TARGET_ORG_SLUG): FakeSupabase {
  const client = new FakeSupabase()
  client.seed('organizations', [{ id: TARGET_ORG_ID, slug: orgSlug }])
  return client
}

// Total per-edge delegated-workflow grants: entry->services(2) + entry->pricing(2)
// + entry->availability(2) + entry->customer(1) + entry->booking(4)
// + booking->customer(1) + booking->availability(2) = 14.
const EXPECTED_EDGE_GRANT_COUNT = 14
// Total direct-ownership (agent_tools) grants: services(2) + pricing(2)
// + availability(2) + customer(1) + booking(4) = 11. Entry holds none.
const EXPECTED_DIRECT_TOOL_COUNT = 11

// ─────────────────────────────────────────────────────────────────────────
// Task 2/3: safe, idempotent, dry-run-by-default provisioning that reuses
// the tenant's existing workflow rows instead of creating duplicates
// ─────────────────────────────────────────────────────────────────────────

describe('MESH-03: provision-canary-graph.ts safety and idempotency', () => {
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
    for (const table of ['agents', 'workflows', 'agent_tools', 'agent_partners', 'agent_partner_workflow_grants']) {
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
    expect(client.tables.agent_tools).toHaveLength(EXPECTED_DIRECT_TOOL_COUNT)
    expect(client.tables.agent_partners).toHaveLength(7)
    expect(client.tables.agent_partner_workflow_grants).toHaveLength(EXPECTED_EDGE_GRANT_COUNT)

    for (const table of ['agents', 'workflows', 'agent_tools', 'agent_partners', 'agent_partner_workflow_grants']) {
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
      agentTools: client.tables.agent_tools.length,
      agent_partners: client.tables.agent_partners.length,
      grants: client.tables.agent_partner_workflow_grants.length,
    }

    const second = await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    expect(client.tables.agents).toHaveLength(countsAfterFirst.agents)
    expect(client.tables.workflows).toHaveLength(countsAfterFirst.workflows)
    expect(client.tables.agent_tools).toHaveLength(countsAfterFirst.agentTools)
    expect(client.tables.agent_partners).toHaveLength(countsAfterFirst.agent_partners)
    expect(client.tables.agent_partner_workflow_grants).toHaveLength(countsAfterFirst.grants)

    // Same rows, same ids -- not a parallel duplicate graph.
    expect(second.agentIds).toEqual(first.agentIds)
    expect(second.workflowIds).toEqual(first.workflowIds)
    expect(second.edgeIds).toEqual(first.edgeIds)
    expect(second.agentToolIds).toEqual(first.agentToolIds)
  })

  it('MESH-03: a provisioning run against an organization that already has all eight workflows creates zero new workflow rows', async () => {
    const client = freshClient()
    // Pre-seed the eight workflows as if they were the tenant's real,
    // already-existing rows (137-CONTEXT.md "Tenant reality") -- created
    // through some other path, at ids the graph does not know in advance.
    client.seed(
      'workflows',
      graph.workflows.map((wf, i) => ({
        id: `preexisting-workflow-${i}`,
        org_id: TARGET_ORG_ID,
        tool_name: wf.tool_name,
        kind: 'tool',
      })),
    )

    const result = await provisionCanaryGraph({
      supabase: client as never,
      graph,
      organizationId: TARGET_ORG_ID,
      apply: true,
    })

    // Still exactly 8 rows -- none created, none duplicated.
    expect(client.tables.workflows).toHaveLength(8)
    expect(client.writeLog.filter((w) => w.table === 'workflows' && w.op === 'insert')).toHaveLength(0)

    // The resolved workflow ids are the PRE-EXISTING ids, not fresh ones --
    // proof the script bound to them rather than creating a parallel set.
    for (const wf of graph.workflows) {
      expect(result.workflowIds[wf.key]).toBe(
        client.tables.workflows.find((w) => w.tool_name === wf.tool_name)!.id,
      )
    }

    // Grants and direct tool ownership still get created correctly against
    // the pre-existing workflow ids.
    expect(client.tables.agent_partner_workflow_grants).toHaveLength(EXPECTED_EDGE_GRANT_COUNT)
    expect(client.tables.agent_tools).toHaveLength(EXPECTED_DIRECT_TOOL_COUNT)
    for (const grant of client.tables.agent_partner_workflow_grants) {
      expect(client.tables.workflows.some((w) => w.id === grant.workflow_id)).toBe(true)
    }
    for (const grant of client.tables.agent_tools) {
      expect(client.tables.workflows.some((w) => w.id === grant.workflow_id)).toBe(true)
    }
  })

  it('re-running against an organization with pre-existing workflows is still a no-op on a second apply', async () => {
    const client = freshClient()
    client.seed(
      'workflows',
      graph.workflows.map((wf, i) => ({
        id: `preexisting-workflow-${i}`,
        org_id: TARGET_ORG_ID,
        tool_name: wf.tool_name,
        kind: 'tool',
      })),
    )

    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    expect(client.tables.workflows).toHaveLength(8)
    expect(client.tables.agent_tools).toHaveLength(EXPECTED_DIRECT_TOOL_COUNT)
    expect(client.tables.agent_partner_workflow_grants).toHaveLength(EXPECTED_EDGE_GRANT_COUNT)
  })

  it('only Booking ends up with a delegated Xkedule write grant -- proven against the written grant rows, not the JSON', async () => {
    const client = freshClient()
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    const agentsById = new Map(client.tables.agents.map((a) => [a.id as string, a]))
    const edgesById = new Map(client.tables.agent_partners.map((e) => [e.id as string, e]))
    const workflowsById = new Map(client.tables.workflows.map((w) => [w.id as string, w]))

    const writeToolNames = new Set<string>(WRITE_TOOL_NAMES)

    let writeGrantCount = 0
    for (const grant of client.tables.agent_partner_workflow_grants) {
      const workflow = workflowsById.get(grant.workflow_id as string)!
      const isWrite = writeToolNames.has(workflow.tool_name as string)
      const edge = edgesById.get(grant.partner_edge_id as string)!
      const partnerAgent = agentsById.get(edge.partner_agent_id as string)!
      if (isWrite) {
        writeGrantCount += 1
        expect(partnerAgent.slug).toBe('cc-booking-specialist')
      }
    }
    expect(writeGrantCount).toBe(3)
  })

  it('only Booking directly owns a write-access workflow -- proven against the written agent_tools rows', async () => {
    const client = freshClient()
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    const agentsById = new Map(client.tables.agents.map((a) => [a.id as string, a]))
    const workflowsById = new Map(client.tables.workflows.map((w) => [w.id as string, w]))
    const writeToolNames = new Set<string>(WRITE_TOOL_NAMES)

    let writeOwnerCount = 0
    for (const grant of client.tables.agent_tools) {
      const workflow = workflowsById.get(grant.workflow_id as string)!
      if (!writeToolNames.has(workflow.tool_name as string)) continue
      writeOwnerCount += 1
      const owner = agentsById.get(grant.agent_id as string)!
      expect(owner.slug).toBe('cc-booking-specialist')
    }
    expect(writeOwnerCount).toBe(3)
  })

  it('voice and widget resolve to the same Availability specialist row in the provisioned data, by id', async () => {
    const client = freshClient()
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    const availabilityAgents = client.tables.agents.filter((a) => a.slug === 'cc-availability-specialist')
    expect(availabilityAgents).toHaveLength(1)
    const availabilityId = availabilityAgents[0].id

    const availabilityEdges = client.tables.agent_partners.filter((e) => e.partner_agent_id === availabilityId)
    // Reachable from both entry (voice/widget) and booking (pre-write confirm).
    expect(availabilityEdges).toHaveLength(2)
    for (const edge of availabilityEdges) {
      expect(edge.allowed_channels).toEqual(expect.arrayContaining(['voice', 'web_widget']))
    }
  })

  it('never writes to any other organization', async () => {
    const otherOrgId = '22222222-2222-4222-8222-222222222222'
    const client = freshClient()
    client.tables.organizations.push({ id: otherOrgId, slug: 'some-unrelated-org' })
    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    for (const table of ['agents', 'workflows', 'agent_tools', 'agent_partners', 'agent_partner_workflow_grants']) {
      const rows = client.tables[table] ?? []
      expect(rows.some((r) => (r.organization_id ?? r.org_id) === otherOrgId)).toBe(false)
    }
  })

  it('never touches the existing generalist agent -- the graph provisions six specialist-mesh agents by their own slugs only', async () => {
    const client = freshClient()
    const generalist = {
      id: 'generalist-agent-id',
      organization_id: TARGET_ORG_ID,
      slug: 'cuts-culture-booking-agent-en',
      name: 'Cuts & Culture Booking Agent (EN)',
      is_active: true,
    }
    client.seed('agents', [generalist])

    await provisionCanaryGraph({ supabase: client as never, graph, organizationId: TARGET_ORG_ID, apply: true })

    const stillThere = client.tables.agents.find((a) => a.slug === 'cuts-culture-booking-agent-en')
    expect(stillThere).toEqual(generalist)
    expect(client.tables.agents).toHaveLength(7) // generalist + 6 mesh agents
  })
})
