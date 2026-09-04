// Phase 139 Plan 05 (TMPL-01): proves the install half of the `agents` asset
// group -- given a captured snapshot (139-01's SnapshotAgent[] /
// SnapshotAgentPartnerEdge[] / SnapshotAgentChannelDefault[]), installAgents()
// creates agents, their prompt versions, direct tool grants, partner edges,
// delegated workflow grants, and channel defaults in a fresh target org --
// idempotently, and without ever activating specialist routing.
//
// THE BUG THIS SUITE EXISTS TO CATCH (139-CONTEXT.md): the first hand-run
// provisioning of the Cuts & Culture mesh created six agents and no
// agent_prompt_versions rows -- resolveAgent() refuses to load an agent with
// no active prompt version, so all six were inert until repaired by hand.
// installAgents() must make that state structurally impossible.
//
// This suite NEVER touches a real database. installSnapshotIntoOrg() is
// exercised only against the in-memory FakeSupabase defined below (same
// fake-double style as tests/canary-graph-shape.test.ts's FakeSupabase and
// tests/org-templates-agents-capture.test.ts's FakeSupabase).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installSnapshotIntoOrg } from '../src/lib/org-templates/install'
import type {
  OrgTemplateSnapshot,
  SnapshotAgent,
  SnapshotAgentChannelDefault,
  SnapshotAgentPartnerEdge,
} from '../src/lib/org-templates/types'

// ─────────────────────────────────────────────────────────────────────────
// Minimal in-memory Supabase fake -- supports the query surface install.ts
// uses: .from(table).select(cols).eq()/.order()/.limit(), .insert(),
// .update(), .upsert(onConflict), .maybeSingle()/.single(), and is a
// thenable so `await` resolves it like the real client.
// ─────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<[string, unknown]> = []
  private pendingOp: { type: 'upsert' | 'insert' | 'update'; rows?: Row[]; fields?: Row; onConflict?: string } | null =
    null
  private orderCol: string | null = null
  private orderAscending = true
  private limitN: number | null = null

  constructor(
    private readonly client: FakeSupabase,
    private readonly table: string
  ) {}

  select(_cols?: string): this {
    return this
  }

  eq(col: string, val: unknown): this {
    this.filters.push([col, val])
    return this
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col
    this.orderAscending = opts?.ascending ?? true
    return this
  }

  limit(n: number): this {
    this.limitN = n
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

  update(fields: Row): this {
    this.pendingOp = { type: 'update', fields }
    return this
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  private execWrite(): Row[] {
    const table = this.client.tables[this.table] ?? (this.client.tables[this.table] = [])

    if (this.pendingOp!.type === 'update') {
      const updated: Row[] = []
      for (const row of table) {
        if (this.matches(row)) {
          Object.assign(row, this.pendingOp!.fields)
          updated.push(row)
        }
      }
      this.client.writeLog.push({ table: this.table, op: 'update' })
      return updated
    }

    const results: Row[] = []
    for (const row of this.pendingOp!.rows!) {
      if (this.pendingOp!.type === 'upsert' && this.pendingOp!.onConflict) {
        const keys = this.pendingOp!.onConflict.split(',')
        const existingIdx = table.findIndex((r) => keys.every((k) => r[k] === row[k]))
        if (existingIdx >= 0) {
          table[existingIdx] = { ...table[existingIdx], ...row }
          this.client.writeLog.push({ table: this.table, op: 'upsert:update' })
          results.push(table[existingIdx])
          continue
        }
      }
      const newRow: Row = {
        id: `fake-${this.table}-${table.length}-${Math.random().toString(36).slice(2, 8)}`,
        ...row,
      }
      table.push(newRow)
      this.client.writeLog.push({ table: this.table, op: this.pendingOp!.type })
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
    let rows = table.filter((r) => this.matches(r))
    if (this.orderCol) {
      const col = this.orderCol
      rows = [...rows].sort((a, b) => {
        const av = Number(a[col])
        const bv = Number(b[col])
        return this.orderAscending ? av - bv : bv - av
      })
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN)
    return { data: rows, error: null }
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
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {}
  writeLog: Array<{ table: string; op: string }> = []
  calls: string[] = []

  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((r) => ({ ...r }))
  }

  // Matches the subset of the supabase-js surface install.ts uses.
  from(table: string) {
    this.calls.push(table)
    return new FakeQuery(this, table) as unknown as ReturnType<
      import('@supabase/supabase-js').SupabaseClient['from']
    >
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const ORG_ID = '22222222-2222-4222-8222-222222222222'

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

function freshClient(orgName = 'Second Chances Barbershop'): FakeSupabase {
  const client = new FakeSupabase()
  client.seed('organizations', [
    {
      id: ORG_ID,
      name: orgName,
      address_line1: null,
      address_line2: null,
      address_city: null,
      address_state: null,
      address_postal_code: null,
      address_country: null,
    },
  ])
  client.seed('integrations', []) // no Xkedule connection -- resolveTenantFacts falls back to the org row
  client.seed(
    'workflows',
    REAL_TOOL_NAMES.map((tool_name) => ({
      id: `w-${tool_name}`,
      org_id: ORG_ID,
      tool_name,
    }))
  )
  client.seed('agents', [])
  client.seed('agent_prompt_versions', [])
  client.seed('agent_tools', [])
  client.seed('agent_partners', [])
  client.seed('agent_partner_workflow_grants', [])
  client.seed('agent_channel_defaults', [])
  return client
}

/** A mesh shaped like Cuts & Culture: 1 orchestrator + 5 specialists, 7 partner
 * edges, 10 delegated workflow grants of which exactly 3 (all on the edge
 * whose destination is "booking") are writes. */
function buildMeshSnapshot(): OrgTemplateSnapshot {
  const agents: SnapshotAgent[] = [
    {
      slug: 'entry',
      name: 'Entry',
      description: 'Orchestrator',
      role: 'orchestrator',
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'Let me get someone.',
      allowed_channels: ['voice', 'web_widget'],
      kb_scope: null,
      is_active: true,
      system_prompt: 'You route calls at {{business_name}}.',
      direct_tools: [],
    },
    {
      slug: 'services',
      name: 'Services',
      description: 'Specialist',
      role: 'specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      allowed_channels: ['voice', 'web_widget'],
      kb_scope: null,
      is_active: true,
      system_prompt: 'You quote services for {{business_name}}.',
      direct_tools: ['list_services', 'business_info'],
    },
    {
      slug: 'pricing',
      name: 'Pricing',
      description: 'Specialist',
      role: 'specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      allowed_channels: ['voice', 'web_widget'],
      kb_scope: null,
      is_active: true,
      system_prompt: 'You quote prices.',
      direct_tools: ['get_quote', 'list_services'],
    },
    {
      slug: 'availability',
      name: 'Availability',
      description: 'Specialist',
      role: 'specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      allowed_channels: ['voice', 'web_widget'],
      kb_scope: null,
      is_active: true,
      system_prompt: 'You check availability.',
      direct_tools: ['check_availability', 'list_services'],
    },
    {
      slug: 'customer',
      name: 'Customer',
      description: 'Specialist',
      role: 'specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      allowed_channels: ['voice', 'web_widget'],
      kb_scope: null,
      is_active: true,
      system_prompt: 'You look up customers.',
      direct_tools: ['lookup_customer'],
    },
    {
      slug: 'booking',
      name: 'Booking',
      description: 'Specialist',
      role: 'specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      allowed_channels: ['voice', 'web_widget'],
      kb_scope: null,
      is_active: true,
      system_prompt: 'You book appointments at {{business_location}}.',
      direct_tools: ['book_appointment', 'reschedule_appointment', 'cancel_appointment', 'list_services'],
    },
  ]

  const agent_partner_edges: SnapshotAgentPartnerEdge[] = [
    {
      agent_slug: 'entry',
      partner_agent_slug: 'services',
      invocation_description: 'Ask about services.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
      workflow_grants: ['list_services', 'business_info'],
    },
    {
      agent_slug: 'entry',
      partner_agent_slug: 'pricing',
      invocation_description: 'Ask about pricing.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
      workflow_grants: ['get_quote', 'list_services'],
    },
    {
      agent_slug: 'entry',
      partner_agent_slug: 'availability',
      invocation_description: 'Check availability.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
      workflow_grants: ['check_availability'],
    },
    {
      agent_slug: 'entry',
      partner_agent_slug: 'customer',
      invocation_description: 'Look up customer.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
      workflow_grants: ['lookup_customer'],
    },
    {
      agent_slug: 'entry',
      partner_agent_slug: 'booking',
      invocation_description: 'Book appointment.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
      workflow_grants: ['book_appointment', 'reschedule_appointment', 'cancel_appointment'],
    },
    {
      agent_slug: 'booking',
      partner_agent_slug: 'availability',
      invocation_description: 'Confirm slot before writing.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 2,
      timeout_ms: 8000,
      workflow_grants: ['check_availability'],
    },
    {
      agent_slug: 'booking',
      partner_agent_slug: 'customer',
      invocation_description: 'Confirm customer before writing.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 2,
      timeout_ms: 8000,
      workflow_grants: [],
    },
  ]

  const agent_channel_defaults: SnapshotAgentChannelDefault[] = [{ channel: 'web_widget', agent_slug: 'entry' }]

  return { agents, agent_partner_edges, agent_channel_defaults }
}

const WRITE_TOOL_NAMES = ['book_appointment', 'reschedule_appointment', 'cancel_appointment']

// ─────────────────────────────────────────────────────────────────────────

describe('TMPL-01: installAgents() via installSnapshotIntoOrg(["agents"])', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  // ── Task 1 ──────────────────────────────────────────────────────────────

  it('Task 1: installs 6 agents, each with a non-null active_prompt_version_id pointing at a rendered prompt', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    const agents = client.tables['agents']
    expect(agents).toHaveLength(6)

    const versionsById = new Map(client.tables['agent_prompt_versions'].map((v) => [v.id, v]))
    for (const agent of agents) {
      expect(agent.active_prompt_version_id).toBeTruthy()
      const version = versionsById.get(agent.active_prompt_version_id as string)
      expect(version).toBeTruthy()
      // Rendered, not verbatim -- tokens substituted with the TARGET org's
      // own facts, never the source org's.
      expect((version!.system_prompt as string)).not.toContain('{{')
    }
  })

  it('Task 1: renders {{business_name}} with the target org name, never "Cuts & Culture"', async () => {
    const client = freshClient('Second Chances Barbershop')
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    const entry = client.tables['agents'].find((a) => a.slug === 'entry')!
    const version = client.tables['agent_prompt_versions'].find((v) => v.id === entry.active_prompt_version_id)!
    expect(version.system_prompt).toContain('Second Chances Barbershop')
    expect(version.system_prompt).not.toContain('Cuts & Culture')
  })

  it('Task 1: re-running install against an already-installed org creates zero new prompt versions and zero duplicate agents', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)
    const agentsAfterFirst = client.tables['agents'].length
    const versionsAfterFirst = client.tables['agent_prompt_versions'].length

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.tables['agents']).toHaveLength(agentsAfterFirst)
    expect(client.tables['agent_prompt_versions']).toHaveLength(versionsAfterFirst)
  })

  it('Task 1: a direct_tools entry resolves against the target org workflow by tool_name into exactly one agent_tools row', async () => {
    const client = freshClient()
    const snapshot: OrgTemplateSnapshot = {
      agents: [
        {
          slug: 'services',
          name: 'Services',
          description: null,
          role: 'specialist',
          model: 'gpt-4o',
          temperature: 0.2,
          max_tokens: 500,
          max_history: 20,
          fallback_message: 'One moment.',
          allowed_channels: ['voice'],
          kb_scope: null,
          is_active: true,
          system_prompt: 'You quote services.',
          direct_tools: ['list_services'],
        },
      ],
    }

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.tables['agent_tools']).toHaveLength(1)
    const grant = client.tables['agent_tools'][0]
    expect(grant.workflow_id).toBe('w-list_services')
    expect(grant.tool_config_id ?? null).toBeNull()
  })

  it('Task 1: a direct_tools entry with no matching target-org workflow is skipped with a warning, not fatal', async () => {
    const client = freshClient()
    const snapshot: OrgTemplateSnapshot = {
      agents: [
        {
          slug: 'services',
          name: 'Services',
          description: null,
          role: 'specialist',
          model: 'gpt-4o',
          temperature: 0.2,
          max_tokens: 500,
          max_history: 20,
          fallback_message: 'One moment.',
          allowed_channels: ['voice'],
          kb_scope: null,
          is_active: true,
          system_prompt: 'You quote services.',
          direct_tools: ['nonexistent_tool', 'list_services'],
        },
      ],
    }

    await expect(
      installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)
    ).resolves.not.toThrow()

    expect(warnSpy).toHaveBeenCalled()
    // The rest of the install still ran -- the resolvable tool still granted,
    // the agent still installed with a prompt version.
    expect(client.tables['agent_tools']).toHaveLength(1)
    expect(client.tables['agents']).toHaveLength(1)
    expect(client.tables['agents'][0].active_prompt_version_id).toBeTruthy()
  })

  it('Task 1: every installed agent in the full fixture has a non-null active_prompt_version_id (invariant, not spot-checked)', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    const agents = client.tables['agents']
    expect(agents).toHaveLength(6)
    for (const agent of agents) {
      expect(agent.active_prompt_version_id).toBeTruthy()
    }
  })

  // ── Task 2 ──────────────────────────────────────────────────────────────

  it('Task 2: installs 6 agents, 7 partner edges, and 10 delegated workflow grants (3 writes, all on booking)', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.tables['agents']).toHaveLength(6)
    expect(client.tables['agent_partners']).toHaveLength(7)
    expect(client.tables['agent_partner_workflow_grants']).toHaveLength(10)

    const agentsBySlug = new Map(client.tables['agents'].map((a) => [a.slug, a]))
    const edgesById = new Map(client.tables['agent_partners'].map((e) => [e.id, e]))
    const bookingId = agentsBySlug.get('booking')!.id

    const workflowById = new Map(client.tables['workflows'].map((w) => [w.id, w]))
    let writeGrantCount = 0
    for (const grant of client.tables['agent_partner_workflow_grants']) {
      const workflow = workflowById.get(grant.workflow_id as string)!
      if (WRITE_TOOL_NAMES.includes(workflow.tool_name as string)) {
        writeGrantCount += 1
        const edge = edgesById.get(grant.partner_edge_id as string)!
        expect(edge.partner_agent_id).toBe(bookingId)
      }
    }
    expect(writeGrantCount).toBe(3)
  })

  it('Task 2: re-running the full install a second time produces identical counts -- zero new rows of any kind', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)
    const before = {
      agents: client.tables['agents'].length,
      versions: client.tables['agent_prompt_versions'].length,
      tools: client.tables['agent_tools'].length,
      partners: client.tables['agent_partners'].length,
      grants: client.tables['agent_partner_workflow_grants'].length,
      defaults: client.tables['agent_channel_defaults'].length,
    }

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.tables['agents']).toHaveLength(before.agents)
    expect(client.tables['agent_prompt_versions']).toHaveLength(before.versions)
    expect(client.tables['agent_tools']).toHaveLength(before.tools)
    expect(client.tables['agent_partners']).toHaveLength(before.partners)
    expect(client.tables['agent_partner_workflow_grants']).toHaveLength(before.grants)
    expect(client.tables['agent_channel_defaults']).toHaveLength(before.defaults)
  })

  it('Task 2: never inserts or updates agent_channel_routing_modes -- zero calls to that table', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)
    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.calls).not.toContain('agent_channel_routing_modes')
  })

  it('Task 2: never overwrites an existing agent_channel_defaults row', async () => {
    const client = freshClient()
    // Simulate a non-fresh org that already has an operator-chosen default.
    client.seed('agent_channel_defaults', [
      { id: 'existing-default', organization_id: ORG_ID, channel: 'web_widget', agent_id: 'some-other-agent' },
    ])
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.tables['agent_channel_defaults']).toHaveLength(1)
    expect(client.tables['agent_channel_defaults'][0].agent_id).toBe('some-other-agent')
  })

  it('Task 2: creates a channel default when none exists, pointing at the installed orchestrator', async () => {
    const client = freshClient()
    const snapshot = buildMeshSnapshot()

    await installSnapshotIntoOrg(client as never, ORG_ID, snapshot, ['agents'], null)

    expect(client.tables['agent_channel_defaults']).toHaveLength(1)
    const entry = client.tables['agents'].find((a) => a.slug === 'entry')!
    expect(client.tables['agent_channel_defaults'][0].agent_id).toBe(entry.id)
    expect(client.tables['agent_channel_defaults'][0].channel).toBe('web_widget')
  })
})
