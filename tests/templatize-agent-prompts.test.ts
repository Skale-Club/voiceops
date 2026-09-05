// Phase 139 Plan 06 (TMPL-02): proves scripts/templatize-agent-prompts.ts is
// safe to point at a live tenant's prompts -- dry run by default, a
// mandatory roundtrip guard before any write, and never a write without
// both --apply and a matching --expect-slug.
//
// This suite NEVER touches a real organization or a real Xkedule tenant.
// @/lib/xkedule/credentials and @/lib/xkedule/client are mocked so
// resolveTenantFacts() always falls back to the (fake) organizations row --
// scripts/templatize-agent-prompts.ts is exercised only against the
// in-memory FakeSupabase defined below, and it is never run with --apply
// anywhere in this file.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getXkeduleCredentialsForOrg = vi.fn()
const xkeduleFetchJson = vi.fn()

vi.mock('@/lib/xkedule/credentials', () => ({
  getXkeduleCredentialsForOrg: (...args: unknown[]) => getXkeduleCredentialsForOrg(...args),
}))

vi.mock('@/lib/xkedule/client', () => ({
  xkeduleFetchJson: (...args: unknown[]) => xkeduleFetchJson(...args),
}))

import { assertSafeToWrite } from '../scripts/provision-canary-graph'
import {
  templatizeAgentPrompt,
  assertRoundtrips,
  templatizeOrgAgentPrompts,
  parseExpectSlug,
  assertExpectSlugPresentForApply,
} from '../scripts/templatize-agent-prompts'
import {
  clearTenantFactsCache,
  renderPromptTemplate,
  type TenantFacts,
} from '../src/lib/org-templates/prompt-template'

beforeEach(() => {
  // resolveTenantFacts() caches per org id; these cases reuse one fake org
  // with different facts, so the cache must not carry across them.
  clearTenantFactsCache()
  getXkeduleCredentialsForOrg.mockReset()
  xkeduleFetchJson.mockReset()
  // No Xkedule connection for any org in this suite -- resolveTenantFacts()
  // always falls back to the fake organizations row's own name/address.
  getXkeduleCredentialsForOrg.mockResolvedValue(null)
})

// ─────────────────────────────────────────────────────────────────────────
// Fake Supabase client -- the ONLY client templatizeOrgAgentPrompts() is
// ever exercised against in this file. Supports exactly the surface
// scripts/templatize-agent-prompts.ts and prompt-template.ts's
// resolveTenantFacts() use: select/eq/order/limit/maybeSingle/single on
// reads, insert/update on writes, all logged to writeLog for assertion.
// ─────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<[string, unknown]> = []
  private orderCol: string | null = null
  private orderAscending = true
  private limitN: number | null = null
  private pendingOp: { type: 'insert' | 'update'; rows?: Row[]; patch?: Row } | null = null

  constructor(private readonly client: FakeSupabase, private readonly table: string) {}

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

  insert(rowOrRows: Row | Row[]): this {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
    this.pendingOp = { type: 'insert', rows }
    return this
  }

  update(patch: Row): this {
    this.pendingOp = { type: 'update', patch }
    return this
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  private execWrite(): Row[] {
    const table = this.client.tables[this.table] ?? (this.client.tables[this.table] = [])
    const results: Row[] = []

    if (this.pendingOp!.type === 'insert') {
      for (const row of this.pendingOp!.rows!) {
        const newRow: Row = {
          id: `fake-${this.table}-${table.length}-${Math.random().toString(36).slice(2, 8)}`,
          ...row,
        }
        table.push(newRow)
        this.client.writeLog.push({ table: this.table, op: 'insert', row: newRow })
        results.push(newRow)
      }
      return results
    }

    // update
    for (let i = 0; i < table.length; i++) {
      if (this.matches(table[i])) {
        table[i] = { ...table[i], ...this.pendingOp!.patch }
        this.client.writeLog.push({ table: this.table, op: 'update', row: table[i] })
        results.push(table[i])
      }
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
    let rows = (this.client.tables[this.table] ?? []).filter((r) => this.matches(r))
    if (this.orderCol) {
      const col = this.orderCol
      rows = [...rows].sort((a, b) => {
        const av = a[col] as number
        const bv = b[col] as number
        return this.orderAscending ? av - bv : bv - av
      })
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
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

  from(table: string) {
    return new FakeQuery(this, table) as unknown as ReturnType<
      import('@supabase/supabase-js').SupabaseClient['from']
    >
  }
}

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ORG_SLUG = 'acme-cuts'
const AGENT_ID = '33333333-3333-4333-8333-333333333333'
const VERSION_ID = '44444444-4444-4444-8444-444444444444'

function orgRow(overrides: Partial<Row> = {}): Row {
  return {
    id: ORG_ID,
    slug: ORG_SLUG,
    name: 'Acme Cuts',
    address_line1: '9 Main St',
    address_line2: null,
    address_city: 'Springfield',
    address_state: null,
    address_postal_code: null,
    address_country: null,
    ...overrides,
  }
}

function clientWithOrgAndAgent(promptText: string): FakeSupabase {
  const client = new FakeSupabase()
  client.seed('organizations', [orgRow()])
  client.seed('agents', [{ id: AGENT_ID, organization_id: ORG_ID, slug: 'services', active_prompt_version_id: VERSION_ID }])
  client.seed('agent_prompt_versions', [
    { id: VERSION_ID, organization_id: ORG_ID, agent_id: AGENT_ID, version: 1, system_prompt: promptText },
  ])
  return client
}

// ─────────────────────────────────────────────────────────────────────────
// Task 1: detect-and-replace with a mandatory roundtrip check, dry-run first
// ─────────────────────────────────────────────────────────────────────────

describe('templatizeAgentPrompt: pure detect-and-replace', () => {
  it('Test 1: name + address roundtrips through {{business_location}}', () => {
    const facts: TenantFacts = { businessName: 'Acme Cuts', businessAddress: '9 Main St, Springfield' }
    const original = '...at Acme Cuts, 9 Main St, Springfield. You do not...'

    const { changed, result } = templatizeAgentPrompt(original, facts)

    expect(changed).toBe(true)
    expect(result).toBe('...at {{business_location}}. You do not...')

    expect(renderPromptTemplate(result, facts)).toBe(original)
  })

  it('Test 2: bare business name (no address) roundtrips through {{business_name}}', () => {
    const facts: TenantFacts = { businessName: 'Acme Cuts', businessAddress: null }
    const original = 'You are the Services specialist for Acme Cuts.'

    const { changed, result } = templatizeAgentPrompt(original, facts)

    expect(changed).toBe(true)
    expect(result).toBe('You are the Services specialist for {{business_name}}.')

    expect(renderPromptTemplate(result, facts)).toBe(original)
  })

  it('Test 3: neither the business name nor a recognizable address substring present -- left unchanged, not an error', () => {
    const facts: TenantFacts = { businessName: 'Acme Cuts', businessAddress: '9 Main St, Springfield' }
    const original = 'You are the Pricing specialist. Never invent a price.'

    const { changed, result } = templatizeAgentPrompt(original, facts)

    expect(changed).toBe(false)
    expect(result).toBe(original)
  })

  it('Test 4: the roundtrip check throws when templatizing does not reconstruct the original -- fail closed', () => {
    // A prompt that already contains the literal token text is the
    // realistic way this can happen: bare-name replacement is naive
    // string substitution, so a prompt that already says "{{business_name}}"
    // for some unrelated reason gets corrupted by the render step re-expanding
    // that pre-existing literal token along with the newly-injected one.
    const facts: TenantFacts = { businessName: 'Acme', businessAddress: null }
    const original = 'Say {{business_name}} literally, never Acme by itself.'

    const { changed, result } = templatizeAgentPrompt(original, facts)
    expect(changed).toBe(true)

    expect(() => assertRoundtrips(original, result, facts, 'services')).toThrow(
      /Roundtrip check failed for agent "services"/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Task 1: org-level flow -- dry run, apply, and the safety gates
// ─────────────────────────────────────────────────────────────────────────

describe('templatizeOrgAgentPrompts: safety-gated org flow', () => {
  it('Test 5: --org without --apply performs the facts lookup and prints the diff, writes nothing', async () => {
    const client = clientWithOrgAndAgent('You are the Services specialist for Acme Cuts.')

    const result = await templatizeOrgAgentPrompts({
      supabase: client as never,
      organizationId: ORG_ID,
      expectSlug: null,
      apply: false,
    })

    expect(result.dryRun).toBe(true)
    expect(result.changes).toEqual([{ agentSlug: 'services', changed: true }])
    expect(client.writeLog).toHaveLength(0)
    expect(client.tables.agent_prompt_versions).toHaveLength(1)
    expect(client.tables.agents[0].active_prompt_version_id).toBe(VERSION_ID)
  })

  it('Test 6: --apply without --org throws, reusing assertSafeToWrite from provision-canary-graph.ts unmodified', () => {
    expect(() => assertSafeToWrite({ org: null, apply: true })).toThrow(/requires an explicit --org/)
  })

  it('Test 6b: --apply without --expect-slug throws', () => {
    expect(() => assertExpectSlugPresentForApply({ org: ORG_ID, apply: true }, null)).toThrow(
      /requires an explicit --expect-slug/,
    )
    expect(() => assertExpectSlugPresentForApply({ org: ORG_ID, apply: true }, ORG_SLUG)).not.toThrow()
    expect(() => assertExpectSlugPresentForApply({ org: null, apply: false }, null)).not.toThrow()
  })

  it('parseExpectSlug reads only --expect-slug=<slug> from argv', () => {
    expect(parseExpectSlug([])).toBeNull()
    expect(parseExpectSlug(['--org=abc', '--apply'])).toBeNull()
    expect(parseExpectSlug(['--expect-slug=acme-cuts'])).toBe('acme-cuts')
  })

  it('Test 7: applying against an org whose resolved slug does not match --expect-slug refuses to write', async () => {
    const client = clientWithOrgAndAgent('You are the Services specialist for Acme Cuts.')

    await expect(
      templatizeOrgAgentPrompts({
        supabase: client as never,
        organizationId: ORG_ID,
        expectSlug: 'some-other-tenant',
        apply: true,
      }),
    ).rejects.toThrow(/has slug "acme-cuts", not "some-other-tenant"/)

    expect(client.writeLog).toHaveLength(0)
  })

  it('the roundtrip guard is enforced before any write inside the full org flow -- throws and writes nothing', async () => {
    const client = clientWithOrgAndAgent('Say {{business_name}} literally, never Acme by itself.')
    client.seed('organizations', [orgRow({ name: 'Acme', address_line1: null, address_city: null })])

    await expect(
      templatizeOrgAgentPrompts({
        supabase: client as never,
        organizationId: ORG_ID,
        expectSlug: ORG_SLUG,
        apply: true,
      }),
    ).rejects.toThrow(/Roundtrip check failed for agent "services"/)

    expect(client.writeLog).toHaveLength(0)
    expect(client.tables.agent_prompt_versions).toHaveLength(1)
  })

  it('applies: creates one new agent_prompt_versions row (version = max + 1) and repoints active_prompt_version_id, never editing the old row', async () => {
    const client = clientWithOrgAndAgent('You are the Services specialist for Acme Cuts.')

    const result = await templatizeOrgAgentPrompts({
      supabase: client as never,
      organizationId: ORG_ID,
      expectSlug: ORG_SLUG,
      apply: true,
    })

    expect(result.dryRun).toBe(false)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].changed).toBe(true)
    const newVersionId = result.changes[0].newVersionId
    expect(newVersionId).toBeTruthy()
    expect(newVersionId).not.toBe(VERSION_ID)

    // Append-only: the old version row is still there, untouched.
    expect(client.tables.agent_prompt_versions).toHaveLength(2)
    const oldVersion = client.tables.agent_prompt_versions.find((v) => v.id === VERSION_ID)
    expect(oldVersion).toEqual({
      id: VERSION_ID,
      organization_id: ORG_ID,
      agent_id: AGENT_ID,
      version: 1,
      system_prompt: 'You are the Services specialist for Acme Cuts.',
    })

    const newVersion = client.tables.agent_prompt_versions.find((v) => v.id === newVersionId)!
    expect(newVersion.version).toBe(2)
    expect(newVersion.system_prompt).toBe('You are the Services specialist for {{business_name}}.')
    expect(newVersion.organization_id).toBe(ORG_ID)
    expect(newVersion.agent_id).toBe(AGENT_ID)

    // Repointed, not edited in place.
    expect(client.tables.agents[0].active_prompt_version_id).toBe(newVersionId)

    const writeOps = client.writeLog.map((w) => `${w.table}:${w.op}`)
    expect(writeOps).toEqual(['agent_prompt_versions:insert', 'agents:update'])
  })

  it('an agent with no active prompt version is skipped, not an error', async () => {
    const client = new FakeSupabase()
    client.seed('organizations', [orgRow()])
    client.seed('agents', [{ id: AGENT_ID, organization_id: ORG_ID, slug: 'orphan', active_prompt_version_id: null }])

    const result = await templatizeOrgAgentPrompts({
      supabase: client as never,
      organizationId: ORG_ID,
      expectSlug: null,
      apply: false,
    })

    expect(result.changes).toEqual([{ agentSlug: 'orphan', changed: false }])
    expect(client.writeLog).toHaveLength(0)
  })

  it('refuses to proceed against an organization id that does not exist', async () => {
    const client = new FakeSupabase() // organizations table left empty

    await expect(
      templatizeOrgAgentPrompts({ supabase: client as never, organizationId: ORG_ID, expectSlug: null, apply: false }),
    ).rejects.toThrow(/does not exist/)
    expect(client.writeLog).toHaveLength(0)
  })
})
