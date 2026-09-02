// The CRM mirror as Xpot uses it: one opportunity PER SALE under one account.
//
// runCrmMirror was written for Xtimator, where a company has exactly one
// lifecycle deal, and keyed the opportunity on company.id. A field-sales app
// closes several deals with the same shop over time. Three things had to
// change for that, and each is pinned here against a fake Supabase client:
//
//   1. opportunity.external_id — when the caller sends one, that is the row's
//      identity; two sales to one shop are two opportunities. Omitted, the
//      company id is the key and nothing changes for the existing callers.
//   2. an account first created through POST /api/v1/prospects (identified by
//      source_type + source_id) is adopted by the mirror instead of duplicated.
//   3. a note for a company with no contact goes on the account, not the floor.

import { describe, expect, it } from 'vitest'
import { mirrorPayloadSchema, runCrmMirror } from '@/lib/crm-mirror/mirror'

// ─── A small in-memory Supabase ──────────────────────────────────────────────

type Row = Record<string, unknown>

class FakeDb {
  tables: Record<string, Row[]> = {
    accounts: [],
    contacts: [],
    opportunities: [],
    pipelines: [],
    pipeline_stages: [],
    notes: [],
  }
  private seq = 0
  nextId(prefix: string) {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  from(table: string) {
    const rows = this.tables[table] ?? (this.tables[table] = [])
    const filters: ((r: Row) => boolean)[] = []
    let pendingInsert: Row | null = null
    let pendingUpdate: Row | null = null
    let selectCols: string | null = null

    // Same escape hatch mirror.ts uses for MirrorDb: the chain shape is
    // Supabase's, not something worth re-typing in a test double.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: (cols?: string) => { selectCols = cols ?? '*'; return q },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q },
      is: (k: string, v: unknown) => { filters.push((r) => r[k] == v); return q },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q },
      insert: (row: Row) => { pendingInsert = row; return q },
      update: (patch: Row) => { pendingUpdate = patch; return q },
      maybeSingle: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      single: async () => q.maybeSingle(),
      // Awaiting the chain directly (update / insert without select)
      then: (resolve: (v: unknown) => void) => {
        if (pendingInsert) {
          const row = { id: this.nextId(table.slice(0, 3)), ...pendingInsert }
          rows.push(row)
          pendingInsert = null
          return resolve({ data: selectCols ? row : null, error: null })
        }
        if (pendingUpdate) {
          for (const r of rows) if (filters.every((f) => f(r))) Object.assign(r, pendingUpdate)
          pendingUpdate = null
          return resolve({ data: null, error: null })
        }
        return resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null })
      },
    }
    // .insert(...).select('id').single() — resolve the insert on single()
    const origSingle = q.single
    q.single = async () => {
      if (pendingInsert) {
        const row = { id: this.nextId(table.slice(0, 3)), ...pendingInsert }
        rows.push(row)
        pendingInsert = null
        return { data: row, error: null }
      }
      return origSingle()
    }
    return q
  }
}

const ORG = 'org-1'

function withPipeline(db: FakeDb) {
  db.tables.pipelines.push({ id: 'pipe-1', org_id: ORG, name: 'Xpot Field Sales' })
  db.tables.pipeline_stages.push(
    { id: 'stage-interested', org_id: ORG, pipeline_id: 'pipe-1', name: 'Interested', is_won: false, is_lost: false },
    { id: 'stage-customer', org_id: ORG, pipeline_id: 'pipe-1', name: 'Customer', is_won: true, is_lost: false },
  )
  return db
}

const shop = { id: '42', name: 'Barbearia do Zé', phone: '+13055550100' }

function saleInput(saleKey: string, value: number, occurredAt: string) {
  return {
    source: 'xpot',
    pipelineName: 'Xpot Field Sales',
    company: shop,
    opportunity: { external_id: saleKey, stage: 'Customer', status: 'won' as const, value, currency: 'USD' },
    note: { title: 'Sale', content: `Sale — $${value}` },
    occurredAt,
  }
}

// ─── 1. One opportunity per sale ─────────────────────────────────────────────

describe('opportunity.external_id — one row per field sale', () => {
  it('two sales to the same shop are two opportunities under one account', async () => {
    const db = withPipeline(new FakeDb())

    const first = await runCrmMirror(db, ORG, saleInput('sale-1', 600, '2026-09-01T10:00:00Z'))
    const second = await runCrmMirror(db, ORG, saleInput('sale-2', 150, '2026-09-01T11:00:00Z'))

    expect(db.tables.accounts).toHaveLength(1)
    expect(db.tables.opportunities).toHaveLength(2)
    expect(first.opportunity_id).not.toBe(second.opportunity_id)
    expect(db.tables.opportunities.map((o) => o.external_id)).toEqual(['sale-1', 'sale-2'])
    expect(db.tables.opportunities.map((o) => o.value)).toEqual([600, 150])
    expect(db.tables.opportunities.every((o) => o.account_id === db.tables.accounts[0].id)).toBe(true)
  })

  it('the same sale delivered twice updates one row, never inserts a second', async () => {
    const db = withPipeline(new FakeDb())
    await runCrmMirror(db, ORG, saleInput('sale-1', 600, '2026-09-01T10:00:00Z'))
    await runCrmMirror(db, ORG, saleInput('sale-1', 600, '2026-09-01T10:00:05Z'))
    expect(db.tables.opportunities).toHaveLength(1)
  })

  it('an interest that converts keeps its key and moves to won', async () => {
    const db = withPipeline(new FakeDb())
    await runCrmMirror(db, ORG, {
      ...saleInput('lead-42-interest', 0, '2026-09-01T10:00:00Z'),
      opportunity: { external_id: 'lead-42-interest', stage: 'Interested', status: 'open', value: 0, currency: 'USD' },
    })
    await runCrmMirror(db, ORG, saleInput('lead-42-interest', 600, '2026-09-08T10:00:00Z'))

    expect(db.tables.opportunities).toHaveLength(1)
    expect(db.tables.opportunities[0]).toMatchObject({ status: 'won', stage_id: 'stage-customer', value: 600 })
  })

  it('without external_id the company is still the key — the Xtimator shape is untouched', async () => {
    const db = withPipeline(new FakeDb())
    const base = saleInput('ignored', 100, '2026-09-01T10:00:00Z')
    const noKey = { ...base, opportunity: { stage: 'Customer', status: 'won' as const, value: 100 } }
    await runCrmMirror(db, ORG, noKey)
    await runCrmMirror(db, ORG, { ...noKey, occurredAt: '2026-09-02T10:00:00Z', opportunity: { ...noKey.opportunity, value: 200 } })

    expect(db.tables.opportunities).toHaveLength(1)
    expect(db.tables.opportunities[0]).toMatchObject({ external_id: '42', value: 200 })
  })

  it('the wire contract accepts the key and keeps it optional', () => {
    const withKey = mirrorPayloadSchema.safeParse({
      source: 'xpot', event: 'sale.completed', occurred_at: '2026-09-01T10:00:00Z',
      company: { id: 42, name: 'Shop' },
      opportunity: { stage: 'Customer', external_id: 'sale-9' },
    })
    expect(withKey.success).toBe(true)
    const without = mirrorPayloadSchema.safeParse({
      source: 'xtimator', event: 'subscription.updated', occurred_at: '2026-09-01T10:00:00Z',
      company: { id: 7, name: 'Customer' },
      opportunity: { stage: 'Active' },
    })
    expect(without.success).toBe(true)
  })
})

// ─── 2. A prospect becomes the account, not a twin of it ─────────────────────

describe('an account created through /api/v1/prospects is adopted, not duplicated', () => {
  it('matches on source_type + source_id when no external key exists yet, and claims the row', async () => {
    const db = withPipeline(new FakeDb())
    // What POST /api/v1/prospects wrote before it learned to stamp external_*.
    db.tables.accounts.push({
      id: 'acc-prospect', org_id: ORG, name: 'Barbearia do Zé',
      source_type: 'xpot', source_id: '42', external_source: null, external_id: null,
    })

    const result = await runCrmMirror(db, ORG, saleInput('sale-1', 600, '2026-09-01T10:00:00Z'))

    expect(db.tables.accounts).toHaveLength(1)
    expect(result.account_id).toBe('acc-prospect')
    expect(db.tables.accounts[0]).toMatchObject({ external_source: 'xpot', external_id: '42' })
    expect(db.tables.opportunities[0].account_id).toBe('acc-prospect')
  })

  it('does not adopt a prospect that belongs to a different source', async () => {
    const db = withPipeline(new FakeDb())
    db.tables.accounts.push({
      id: 'acc-other', org_id: ORG, name: 'Someone else',
      source_type: 'scraper', source_id: '42', external_source: null, external_id: null,
    })
    await runCrmMirror(db, ORG, saleInput('sale-1', 600, '2026-09-01T10:00:00Z'))
    expect(db.tables.accounts).toHaveLength(2)
  })
})

// ─── 3. The note survives a company with no contact ──────────────────────────

describe('a note with no contact to hang on goes to the account', () => {
  it('a shop that gave only its name still gets the sale on its timeline', async () => {
    const db = withPipeline(new FakeDb())
    const nameOnly = { ...saleInput('sale-1', 600, '2026-09-01T10:00:00Z'), company: { id: '42', name: 'Barbearia do Zé' } }

    const result = await runCrmMirror(db, ORG, nameOnly)

    expect(result.contact_id).toBeNull()
    expect(db.tables.notes).toHaveLength(1)
    expect(db.tables.notes[0]).toMatchObject({ entity_type: 'account', entity_id: result.account_id, content: 'Sale — $600' })
  })

  it('with a phone the contact exists and the note goes there, as before', async () => {
    const db = withPipeline(new FakeDb())
    const result = await runCrmMirror(db, ORG, saleInput('sale-1', 600, '2026-09-01T10:00:00Z'))
    expect(result.contact_id).not.toBeNull()
    expect(db.tables.notes[0]).toMatchObject({ entity_type: 'contact', entity_id: result.contact_id })
  })
})
