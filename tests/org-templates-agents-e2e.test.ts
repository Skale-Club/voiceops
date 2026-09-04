// Phase 139 Plan 08 (TMPL-01): proves the FULL `agents` asset-group pipeline
// end to end -- capture composed with install -- against the known-good
// Cuts & Culture shape (6 agents, 7 partner edges, 10 delegated workflow
// grants of which exactly 3 are writes, all on the Booking-shaped
// specialist).
//
// 139-01 through 139-07 each proved their own function correct in isolation:
// tests/org-templates-agents-capture.test.ts hand-checks captureOrgSnapshot(),
// tests/org-templates-agents-install.test.ts hand-authors a SnapshotAgent[]
// fixture and checks installSnapshotIntoOrg() against it directly. Neither
// proves the two compose: that what captureOrgSnapshot() actually emits from
// a source organization is exactly what installSnapshotIntoOrg() needs to
// reproduce the mesh in a second, unrelated, empty organization. This suite
// is that missing link -- the same lesson 137-VERIFICATION.md drew about the
// canary graph itself ("row counts and unit tests said the mesh existed;
// nothing before this plan had exercised it").
//
// This suite NEVER touches a real database and NEVER calls the Vapi API --
// it is a same-process assertion over two independent in-memory fake
// Supabase clients (one for the source org captureOrgSnapshot() reads from,
// one for the target org installSnapshotIntoOrg() writes to), in the same
// fake-double style as tests/canary-graph-shape.test.ts,
// tests/org-templates-agents-capture.test.ts, and
// tests/org-templates-agents-install.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureOrgSnapshot } from '../src/lib/org-templates/snapshot'
import { installSnapshotIntoOrg } from '../src/lib/org-templates/install'
import type { OrgTemplateAssetGroup } from '../src/lib/org-templates/types'

// ─────────────────────────────────────────────────────────────────────────
// SOURCE fake -- read-only surface snapshot.ts uses: .from(table).select()
// .order()/.eq()/.in(), and is a thenable. Copied from the same style as
// tests/org-templates-agents-capture.test.ts's FakeSupabase -- capture never
// writes, so no upsert/insert/update path is needed here.
// ─────────────────────────────────────────────────────────────────────────

class SourceFakeQuery<T extends Record<string, unknown>> implements PromiseLike<{ data: T[]; error: null }> {
  private filters: ((row: T) => boolean)[] = []

  constructor(private rows: T[]) {}

  select(_cols?: string) {
    return this
  }

  order(_col?: string) {
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val)
    return this
  }

  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]))
    return this
  }

  then<TResult1 = { data: T[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.rows.filter((r) => this.filters.every((f) => f(r)))
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
  }
}

class SourceFakeSupabase {
  calls: string[] = []
  constructor(private tables: Record<string, Record<string, unknown>[]>) {}

  from(table: string) {
    this.calls.push(table)
    return new SourceFakeQuery(this.tables[table] ?? [])
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ADMIN (target) fake -- the fuller read/write surface install.ts uses:
// .from(table).select(cols).eq()/.order()/.limit(), .insert(), .update(),
// .upsert(onConflict), .maybeSingle()/.single(). Copied from the same style
// as tests/org-templates-agents-install.test.ts's FakeSupabase.
// ─────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

class AdminFakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<[string, unknown]> = []
  private pendingOp: { type: 'upsert' | 'insert' | 'update'; rows?: Row[]; fields?: Row; onConflict?: string } | null =
    null
  private orderCol: string | null = null
  private orderAscending = true
  private limitN: number | null = null

  constructor(
    private readonly client: AdminFakeSupabase,
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

class AdminFakeSupabase {
  tables: Record<string, Row[]> = {}
  writeLog: Array<{ table: string; op: string }> = []
  calls: string[] = []

  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((r) => ({ ...r }))
  }

  from(table: string) {
    this.calls.push(table)
    return new AdminFakeQuery(this, table) as unknown as ReturnType<
      import('@supabase/supabase-js').SupabaseClient['from']
    >
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Fixture facts. The source fixture's mesh shape is keyed to the canary
// JSON's agent slugs/roles for readability (139-CONTEXT.md's locked
// decision: the canary JSON is a fixture for tests only, never the source of
// truth for counts -- the exact counts asserted below come from
// 139-CONTEXT.md's "Verification focus" / 137-VERIFICATION.md's live count
// of 10 edge grants (3 write), not from whatever the JSON file currently
// contains).
// ─────────────────────────────────────────────────────────────────────────

const TARGET_ORG_ID = '55555555-5555-4555-8555-555555555555'
const DECOY_SOURCE_ORG_ID = '66666666-6666-4666-8666-666666666666'

const SOURCE_BUSINESS_NAME = 'Cuts & Culture Barbershop'
const TARGET_BUSINESS_NAME = 'Riverside Wellness Spa'

const WRITE_TOOL_NAMES = ['book_appointment', 'reschedule_appointment', 'cancel_appointment']

/**
 * The source organization's mesh, shaped exactly like the live Cuts &
 * Culture graph: 1 orchestrator + 5 specialists, 7 partner edges, 10
 * delegated workflow grants of which exactly 3 (all on the entry->booking
 * edge) are writes. The orchestrator's captured prompt carries
 * `{{business_name}}` / `{{business_location}}` tokens rather than the
 * source business's hardcoded facts -- proving the templating half of the
 * pipeline (139-06/139-07) composes with capture+install, not just the
 * literal string "Cuts & Culture" happening to be absent by omission.
 */
function buildSourceFixture() {
  const agents = [
    {
      id: 'a-entry',
      slug: 'entry',
      name: 'Entry',
      description: 'Orchestrator',
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'Let me get someone.',
      kb_scope: null,
      allowed_channels: ['voice', 'web_widget'],
      is_active: true,
      active_prompt_version_id: 'pv-entry',
    },
    {
      id: 'a-services',
      slug: 'services',
      name: 'Services',
      description: 'Specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      kb_scope: null,
      allowed_channels: ['voice', 'web_widget'],
      is_active: true,
      active_prompt_version_id: 'pv-services',
    },
    {
      id: 'a-pricing',
      slug: 'pricing',
      name: 'Pricing',
      description: 'Specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      kb_scope: null,
      allowed_channels: ['voice', 'web_widget'],
      is_active: true,
      active_prompt_version_id: 'pv-pricing',
    },
    {
      id: 'a-availability',
      slug: 'availability',
      name: 'Availability',
      description: 'Specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      kb_scope: null,
      allowed_channels: ['voice', 'web_widget'],
      is_active: true,
      active_prompt_version_id: 'pv-availability',
    },
    {
      id: 'a-customer',
      slug: 'customer',
      name: 'Customer',
      description: 'Specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      kb_scope: null,
      allowed_channels: ['voice', 'web_widget'],
      is_active: true,
      active_prompt_version_id: 'pv-customer',
    },
    {
      id: 'a-booking',
      slug: 'booking',
      name: 'Booking',
      description: 'Specialist',
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 500,
      max_history: 20,
      fallback_message: 'One moment.',
      kb_scope: null,
      allowed_channels: ['voice', 'web_widget'],
      is_active: true,
      active_prompt_version_id: 'pv-booking',
    },
  ]

  const agent_prompt_versions = [
    {
      id: 'pv-entry',
      agent_id: 'a-entry',
      system_prompt:
        'You are the front-desk orchestrator for {{business_name}}, located at {{business_location}}. ' +
        'Never invent a price; always quote before booking, and repeat a price at most three times if ' +
        "asked. If you didn't catch something, ask the caller to repeat it rather than agreeing blindly.",
    },
    { id: 'pv-services', agent_id: 'a-services', system_prompt: 'You quote services and hours.' },
    { id: 'pv-pricing', agent_id: 'a-pricing', system_prompt: 'You quote prices, never inventing one.' },
    { id: 'pv-availability', agent_id: 'a-availability', system_prompt: 'You check open time slots.' },
    { id: 'pv-customer', agent_id: 'a-customer', system_prompt: 'You look up returning customers.' },
    {
      id: 'pv-booking',
      agent_id: 'a-booking',
      system_prompt: 'You book, reschedule, and cancel appointments at {{business_location}}.',
    },
  ]

  const workflows = [
    {
      id: 'w-list-services',
      name: 'List services',
      slug: 'list-services',
      description: 'Catalogue of services.',
      kind: 'tool',
      tool_name: 'list_services',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-business-info',
      name: 'Business info',
      slug: 'business-info',
      description: 'Address, hours, policy.',
      kind: 'tool',
      tool_name: 'business_info',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-get-quote',
      name: 'Get quote',
      slug: 'get-quote',
      description: 'Real total for services.',
      kind: 'tool',
      tool_name: 'get_quote',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-check-availability',
      name: 'Check availability',
      slug: 'check-availability',
      description: 'Open times for services.',
      kind: 'tool',
      tool_name: 'check_availability',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-lookup-customer',
      name: 'Lookup customer',
      slug: 'lookup-customer',
      description: 'Identify a returning customer.',
      kind: 'tool',
      tool_name: 'lookup_customer',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-book-appointment',
      name: 'Book appointment',
      slug: 'book-appointment',
      description: 'Create a new appointment.',
      kind: 'tool',
      tool_name: 'book_appointment',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-reschedule-appointment',
      name: 'Reschedule appointment',
      slug: 'reschedule-appointment',
      description: 'Move an existing appointment.',
      kind: 'tool',
      tool_name: 'reschedule_appointment',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
    {
      id: 'w-cancel-appointment',
      name: 'Cancel appointment',
      slug: 'cancel-appointment',
      description: 'Cancel an existing appointment.',
      kind: 'tool',
      tool_name: 'cancel_appointment',
      trigger_type: 'tool_call',
      trigger_config: {},
      current_version_id: null,
    },
  ]

  // Direct ownership (agent_tools) -- workflow_id-sourced only, matching the
  // live mesh's shape. Entry (orchestrator) holds none directly.
  const agent_tools = [
    { agent_id: 'a-services', workflow_id: 'w-list-services', tool_config_id: null },
    { agent_id: 'a-services', workflow_id: 'w-business-info', tool_config_id: null },
    { agent_id: 'a-pricing', workflow_id: 'w-get-quote', tool_config_id: null },
    { agent_id: 'a-pricing', workflow_id: 'w-list-services', tool_config_id: null },
    { agent_id: 'a-availability', workflow_id: 'w-check-availability', tool_config_id: null },
    { agent_id: 'a-availability', workflow_id: 'w-list-services', tool_config_id: null },
    { agent_id: 'a-customer', workflow_id: 'w-lookup-customer', tool_config_id: null },
    { agent_id: 'a-booking', workflow_id: 'w-book-appointment', tool_config_id: null },
    { agent_id: 'a-booking', workflow_id: 'w-reschedule-appointment', tool_config_id: null },
    { agent_id: 'a-booking', workflow_id: 'w-cancel-appointment', tool_config_id: null },
    { agent_id: 'a-booking', workflow_id: 'w-list-services', tool_config_id: null },
  ]

  // 7 partner edges: entry -> each of the 5 specialists, plus the 2
  // authorized specialist-to-specialist edges (booking -> availability,
  // booking -> customer), exactly matching the live topology.
  const agent_partners = [
    {
      id: 'e-entry-services',
      agent_id: 'a-entry',
      partner_agent_id: 'a-services',
      invocation_description: 'Ask about services.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
    },
    {
      id: 'e-entry-pricing',
      agent_id: 'a-entry',
      partner_agent_id: 'a-pricing',
      invocation_description: 'Ask about pricing.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
    },
    {
      id: 'e-entry-availability',
      agent_id: 'a-entry',
      partner_agent_id: 'a-availability',
      invocation_description: 'Check availability.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
    },
    {
      id: 'e-entry-customer',
      agent_id: 'a-entry',
      partner_agent_id: 'a-customer',
      invocation_description: 'Look up customer.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
    },
    {
      id: 'e-entry-booking',
      agent_id: 'a-entry',
      partner_agent_id: 'a-booking',
      invocation_description: 'Book, reschedule, or cancel an appointment.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 1,
      timeout_ms: 8000,
    },
    {
      id: 'e-booking-availability',
      agent_id: 'a-booking',
      partner_agent_id: 'a-availability',
      invocation_description: 'Confirm slot before writing.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 2,
      timeout_ms: 8000,
    },
    {
      id: 'e-booking-customer',
      agent_id: 'a-booking',
      partner_agent_id: 'a-customer',
      invocation_description: 'Confirm customer before writing.',
      allowed_channels: ['voice', 'web_widget'],
      max_calls_per_turn: 3,
      max_depth: 2,
      timeout_ms: 8000,
    },
  ]

  // Exactly 10 delegated workflow grants; exactly 3 are writes
  // (book/reschedule/cancel), all three on the entry->booking edge --
  // the live tenant's shape per 137-VERIFICATION.md ("Live count: 10 edge
  // grants (3 write)"), not the drifted count sitting in the canary JSON.
  const agent_partner_workflow_grants = [
    { partner_edge_id: 'e-entry-services', workflow_id: 'w-list-services' },
    { partner_edge_id: 'e-entry-pricing', workflow_id: 'w-get-quote' },
    { partner_edge_id: 'e-entry-pricing', workflow_id: 'w-list-services' },
    { partner_edge_id: 'e-entry-availability', workflow_id: 'w-check-availability' },
    { partner_edge_id: 'e-entry-customer', workflow_id: 'w-lookup-customer' },
    { partner_edge_id: 'e-entry-booking', workflow_id: 'w-book-appointment' },
    { partner_edge_id: 'e-entry-booking', workflow_id: 'w-reschedule-appointment' },
    { partner_edge_id: 'e-entry-booking', workflow_id: 'w-cancel-appointment' },
    { partner_edge_id: 'e-booking-availability', workflow_id: 'w-check-availability' },
    { partner_edge_id: 'e-booking-customer', workflow_id: 'w-lookup-customer' },
  ]

  const agent_channel_defaults = [{ channel: 'web_widget', agent_id: 'a-entry' }]

  return {
    agents,
    agent_prompt_versions,
    workflows,
    agent_tools,
    agent_partners,
    agent_partner_workflow_grants,
    agent_channel_defaults,
  }
}

function buildSourceClient(): SourceFakeSupabase {
  return new SourceFakeSupabase(buildSourceFixture())
}

/**
 * The target organization: freshly created, empty, unrelated to the source.
 * Its `organizations` table also holds the SOURCE org's own row (a
 * service-role admin client can see every organization) -- this is what
 * makes assertion 4 below a real check of `resolveTenantFacts()` scoping by
 * id, rather than a trivially-true check that a string nobody ever wrote
 * happens to be absent.
 */
function buildAdminClient(): AdminFakeSupabase {
  const client = new AdminFakeSupabase()
  client.seed('organizations', [
    {
      id: DECOY_SOURCE_ORG_ID,
      name: SOURCE_BUSINESS_NAME,
      address_line1: '212 Newbury Street',
      address_line2: null,
      address_city: 'Boston',
      address_state: 'MA',
      address_postal_code: '02116',
      address_country: 'US',
    },
    {
      id: TARGET_ORG_ID,
      name: TARGET_BUSINESS_NAME,
      address_line1: '88 Ocean Ave',
      address_line2: null,
      address_city: 'Providence',
      address_state: 'RI',
      address_postal_code: '02901',
      address_country: 'US',
    },
  ])
  client.seed('integrations', []) // no Xkedule connection -- resolveTenantFacts falls back to the org row
  client.seed('workflows', [])
  client.seed('agents', [])
  client.seed('agent_prompt_versions', [])
  client.seed('agent_tools', [])
  client.seed('agent_partners', [])
  client.seed('agent_partner_workflow_grants', [])
  client.seed('agent_channel_defaults', [])
  return client
}

const GROUPS: OrgTemplateAssetGroup[] = ['agents', 'workflows']

// ─────────────────────────────────────────────────────────────────────────

describe('TMPL-01: agents asset group, capture composed with install, end to end', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('captures the source mesh and installs it into a second, empty org, landing 6/7/10/3 exactly', async () => {
    const source = buildSourceClient()
    const admin = buildAdminClient()

    const snapshot = await captureOrgSnapshot(source as never, GROUPS)

    // Sanity on the intermediate snapshot itself -- if this drifts, the
    // fixture (not the pipeline) is the thing that broke.
    expect(snapshot.agents).toHaveLength(6)
    expect(snapshot.agent_partner_edges).toHaveLength(7)
    const totalDelegatedGrants = (snapshot.agent_partner_edges ?? []).reduce(
      (sum, e) => sum + e.workflow_grants.length,
      0
    )
    expect(totalDelegatedGrants).toBe(10)

    await installSnapshotIntoOrg(admin as never, TARGET_ORG_ID, snapshot, GROUPS, null)

    // ── 1. Six agents, every one with a non-null active_prompt_version_id.
    const installedAgents = admin.tables['agents']
    expect(installedAgents).toHaveLength(6)
    for (const agent of installedAgents) {
      expect(agent.active_prompt_version_id).toBeTruthy()
    }

    // ── 2. Exactly 7 agent_partners rows and 10 agent_partner_workflow_grants rows.
    expect(admin.tables['agent_partners']).toHaveLength(7)
    expect(admin.tables['agent_partner_workflow_grants']).toHaveLength(10)

    // ── 3. Exactly 3 of those 10 delegated grants resolve to a write-access
    // tool, and all 3 target the same partner agent (Booking).
    const agentsBySlug = new Map(installedAgents.map((a) => [a.slug as string, a]))
    const bookingAgent = agentsBySlug.get('booking')!
    const edgesById = new Map(admin.tables['agent_partners'].map((e) => [e.id as string, e]))
    const workflowsById = new Map(admin.tables['workflows'].map((w) => [w.id as string, w]))

    let writeGrantCount = 0
    for (const grant of admin.tables['agent_partner_workflow_grants']) {
      const workflow = workflowsById.get(grant.workflow_id as string)!
      if (!WRITE_TOOL_NAMES.includes(workflow.tool_name as string)) continue
      writeGrantCount += 1
      const edge = edgesById.get(grant.partner_edge_id as string)!
      expect(edge.partner_agent_id).toBe(bookingAgent.id)
    }
    expect(writeGrantCount).toBe(3)

    // ── 4. The orchestrator's rendered prompt names the TARGET business,
    // never the source fixture's business name -- proving resolveTenantFacts()
    // resolved facts for TARGET_ORG_ID, not the decoy source-org row also
    // present in the admin client's organizations table.
    const entryAgent = agentsBySlug.get('entry')!
    const entryVersion = admin.tables['agent_prompt_versions'].find(
      (v) => v.id === entryAgent.active_prompt_version_id
    )!
    const renderedPrompt = entryVersion.system_prompt as string
    expect(renderedPrompt).toContain(TARGET_BUSINESS_NAME)
    expect(renderedPrompt).not.toContain(SOURCE_BUSINESS_NAME)
    expect(renderedPrompt).not.toContain('{{')

    // ── 5. Re-running the identical install call is a no-op: identical row
    // counts across every table the pipeline touches.
    const before = {
      agents: admin.tables['agents'].length,
      versions: admin.tables['agent_prompt_versions'].length,
      tools: admin.tables['agent_tools'].length,
      partners: admin.tables['agent_partners'].length,
      grants: admin.tables['agent_partner_workflow_grants'].length,
      defaults: admin.tables['agent_channel_defaults'].length,
      workflows: admin.tables['workflows'].length,
    }

    await installSnapshotIntoOrg(admin as never, TARGET_ORG_ID, snapshot, GROUPS, null)

    expect(admin.tables['agents']).toHaveLength(before.agents)
    expect(admin.tables['agent_prompt_versions']).toHaveLength(before.versions)
    expect(admin.tables['agent_tools']).toHaveLength(before.tools)
    expect(admin.tables['agent_partners']).toHaveLength(before.partners)
    expect(admin.tables['agent_partner_workflow_grants']).toHaveLength(before.grants)
    expect(admin.tables['agent_channel_defaults']).toHaveLength(before.defaults)
    expect(admin.tables['workflows']).toHaveLength(before.workflows)

    // ── 6. agent_channel_routing_modes is never touched -- not read, not
    // written -- by either half of the pipeline, across the entire run
    // (capture + both install calls).
    expect(source.calls).not.toContain('agent_channel_routing_modes')
    expect(admin.calls).not.toContain('agent_channel_routing_modes')
  })
})
