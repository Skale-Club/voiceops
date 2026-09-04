// Phase 139 Plan 01 (TMPL-01): captures the agent mesh into a structure-only
// org-template snapshot, keyed by stable names (slug / tool_name) rather than
// database ids -- this is the interface a later, parallel-safe plan installs
// against.
//
// This suite NEVER touches a real database. captureOrgSnapshot() is exercised
// only against the in-memory FakeSupabase defined below (same fake-double
// style as tests/canary-graph-shape.test.ts's FakeSupabase).

import { describe, it, expect } from 'vitest'
import { captureOrgSnapshot } from '../src/lib/org-templates/snapshot'
import type { OrgTemplateAssetGroup } from '../src/lib/org-templates/types'

// ─────────────────────────────────────────────────────────────────────────
// Minimal in-memory Supabase fake -- supports exactly the query surface
// snapshot.ts uses: .from(table).select(cols).order(col), .eq(), .in(),
// and is a thenable so `await` resolves it like the real client.
// ─────────────────────────────────────────────────────────────────────────

class FakeQueryBuilder<T extends Record<string, unknown>> implements PromiseLike<{ data: T[]; error: null }> {
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

class FakeSupabase {
  calls: string[] = []
  constructor(private tables: Record<string, Record<string, unknown>[]>) {}

  from(table: string) {
    this.calls.push(table)
    return new FakeQueryBuilder(this.tables[table] ?? [])
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Fixture: a mesh shaped like Cuts & Culture -- 1 orchestrator + 5
// specialists, 7 partner edges, 8 real tool names.
// ─────────────────────────────────────────────────────────────────────────

function buildMeshFixture() {
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
    { id: 'pv-entry', agent_id: 'a-entry', system_prompt: 'You route calls at {{business_name}}.' },
    { id: 'pv-services', agent_id: 'a-services', system_prompt: 'You quote services.' },
    { id: 'pv-pricing', agent_id: 'a-pricing', system_prompt: 'You quote prices.' },
    { id: 'pv-availability', agent_id: 'a-availability', system_prompt: 'You check availability.' },
    { id: 'pv-customer', agent_id: 'a-customer', system_prompt: 'You look up customers.' },
    { id: 'pv-booking', agent_id: 'a-booking', system_prompt: 'You book appointments.' },
  ]

  const workflows = [
    { id: 'w-list-services', tool_name: 'list_services' },
    { id: 'w-business-info', tool_name: 'business_info' },
    { id: 'w-get-quote', tool_name: 'get_quote' },
    { id: 'w-check-availability', tool_name: 'check_availability' },
    { id: 'w-lookup-customer', tool_name: 'lookup_customer' },
    { id: 'w-book-appointment', tool_name: 'book_appointment' },
    { id: 'w-reschedule-appointment', tool_name: 'reschedule_appointment' },
    { id: 'w-cancel-appointment', tool_name: 'cancel_appointment' },
  ]

  const agent_tools = [
    { agent_id: 'a-services', workflow_id: 'w-list-services', tool_config_id: null },
    { agent_id: 'a-services', workflow_id: 'w-business-info', tool_config_id: null },
    // A tool_config-sourced grant on the same agent -- must be silently skipped (Test 2).
    { agent_id: 'a-services', workflow_id: null, tool_config_id: 'tc-legacy-1' },
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

  const agent_partners = [
    { id: 'e-entry-services', agent_id: 'a-entry', partner_agent_id: 'a-services', invocation_description: 'Ask about services.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 1, timeout_ms: 8000 },
    { id: 'e-entry-pricing', agent_id: 'a-entry', partner_agent_id: 'a-pricing', invocation_description: 'Ask about pricing.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 1, timeout_ms: 8000 },
    { id: 'e-entry-availability', agent_id: 'a-entry', partner_agent_id: 'a-availability', invocation_description: 'Check availability.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 1, timeout_ms: 8000 },
    { id: 'e-entry-customer', agent_id: 'a-entry', partner_agent_id: 'a-customer', invocation_description: 'Look up customer.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 1, timeout_ms: 8000 },
    { id: 'e-entry-booking', agent_id: 'a-entry', partner_agent_id: 'a-booking', invocation_description: 'Book appointment.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 1, timeout_ms: 8000 },
    { id: 'e-booking-availability', agent_id: 'a-booking', partner_agent_id: 'a-availability', invocation_description: 'Confirm slot before writing.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 2, timeout_ms: 8000 },
    { id: 'e-booking-customer', agent_id: 'a-booking', partner_agent_id: 'a-customer', invocation_description: 'Confirm customer before writing.', allowed_channels: ['voice', 'web_widget'], max_calls_per_turn: 3, max_depth: 2, timeout_ms: 8000 },
  ]

  const agent_partner_workflow_grants = [
    { partner_edge_id: 'e-booking-availability', workflow_id: 'w-check-availability' },
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

function buildFakeSupabase(overrides: Record<string, Record<string, unknown>[]> = {}) {
  const fixture = buildMeshFixture()
  return new FakeSupabase({ ...fixture, ...overrides })
}

// ─────────────────────────────────────────────────────────────────────────

describe('TMPL-01: captureOrgSnapshot(["agents"])', () => {
  it('captures 6 agents and 7 partner edges for a Cuts & Culture-shaped mesh', async () => {
    const fake = buildFakeSupabase()
    const snapshot = await captureOrgSnapshot(fake as never, ['agents'])
    expect(snapshot.agents).toHaveLength(6)
    expect(snapshot.agent_partner_edges).toHaveLength(7)
  })

  it('omits a tool_config-sourced grant, keeping only the workflow-sourced tool_name', async () => {
    const fake = buildFakeSupabase()
    const snapshot = await captureOrgSnapshot(fake as never, ['agents'])
    const services = snapshot.agents!.find((a) => a.slug === 'services')!
    expect(services.direct_tools.sort()).toEqual(['business_info', 'list_services'].sort())
  })

  it('derives role from direct_tools: empty -> orchestrator, non-empty -> specialist', async () => {
    const fake = buildFakeSupabase()
    const snapshot = await captureOrgSnapshot(fake as never, ['agents'])
    const bySlug = new Map(snapshot.agents!.map((a) => [a.slug, a]))
    expect(bySlug.get('entry')!.role).toBe('orchestrator')
    for (const slug of ['services', 'pricing', 'availability', 'customer', 'booking']) {
      expect(bySlug.get(slug)!.role).toBe('specialist')
    }
  })

  it('resolves a partner edge workflow_grants to tool_names, not raw workflow ids', async () => {
    const fake = buildFakeSupabase()
    const snapshot = await captureOrgSnapshot(fake as never, ['agents'])
    const edge = snapshot.agent_partner_edges!.find(
      (e) => e.agent_slug === 'booking' && e.partner_agent_slug === 'availability'
    )!
    expect(edge.workflow_grants).toEqual(['check_availability'])
  })

  it('captures agent_channel_defaults as {channel, agent_slug}', async () => {
    const fake = buildFakeSupabase()
    const snapshot = await captureOrgSnapshot(fake as never, ['agents'])
    expect(snapshot.agent_channel_defaults).toEqual([{ channel: 'web_widget', agent_slug: 'entry' }])
  })

  it('an org with zero agents returns snapshot.agents === [] -- never undefined, never an error', async () => {
    const fake = buildFakeSupabase({ agents: [] })
    const snapshot = await captureOrgSnapshot(fake as never, ['agents'])
    expect(snapshot.agents).toEqual([])
    expect(snapshot.agent_partner_edges).toEqual([])
    expect(snapshot.agent_channel_defaults).toEqual([])
  })

  it('requesting only "pipelines" never touches any agents table', async () => {
    const fake = buildFakeSupabase({ pipelines: [] })
    const groups: OrgTemplateAssetGroup[] = ['pipelines']
    await captureOrgSnapshot(fake as never, groups)
    const agentTables = [
      'agents',
      'agent_tools',
      'agent_prompt_versions',
      'agent_partners',
      'agent_partner_workflow_grants',
      'agent_channel_defaults',
    ]
    for (const table of agentTables) {
      expect(fake.calls).not.toContain(table)
    }
  })
})
