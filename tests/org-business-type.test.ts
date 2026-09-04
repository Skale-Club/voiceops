// tests/org-business-type.test.ts
// Phase 138 Plan 00 (MODAL-00): an organization's business type, set by an
// operator in Settings -> Company Info, and the DEFAULT
// service_location_mode it implies.
//
// Task 1: migration 1296 structural contract + database.ts widening +
// src/lib/org/business-type.ts pure mapping.
// Task 2: updateCompanyProfile() wiring — sets the derived mode only when
// the org has no explicit override, and rejects an out-of-CHECK-set value.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Task 1: migration 1296 structural contract
// ---------------------------------------------------------------------------

const migrationPath = resolve(process.cwd(), 'supabase/migrations/1296_organization_business_type.sql')

describe('migration 1296 organization business_type', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds business_type as a bounded, defaulted column', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS business_type TEXT')
    expect(sql).toMatch(/NOT NULL\s+DEFAULT 'on_premises_shop'/)
    expect(sql).toContain(
      "CHECK (business_type IN ('on_premises_shop', 'mobile_service', 'hybrid', 'other'))",
    )
  })

  it('is idempotent (ADD COLUMN IF NOT EXISTS)', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS')
  })

  it('performs no backfill against organizations', () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.organizations/i)
    expect(sql).not.toMatch(/UPDATE\s+public\.organizations\s+SET/i)
  })

  it('documents that the default matches every existing tenant, unchanged', () => {
    expect(sql).toMatch(/default|Default/)
    expect(sql).toMatch(/on_premises_shop/)
  })
})

const databaseTypesPath = resolve(process.cwd(), 'src/types/database.ts')

describe('database.ts widened for organizations.business_type', () => {
  const source = readFileSync(databaseTypesPath, 'utf8')
  const orgBlockStart = source.indexOf('organizations: {')
  const orgBlockEnd = source.indexOf('\n      }', source.indexOf('Relationships: []', orgBlockStart))
  const orgBlock = source.slice(orgBlockStart, orgBlockEnd)

  it('adds business_type to Row, Insert, and Update', () => {
    expect(orgBlock).toContain('business_type: string')
    expect(orgBlock).toContain('business_type?: string')
  })
})

// ---------------------------------------------------------------------------
// Task 1: src/lib/org/business-type.ts pure mapping
// ---------------------------------------------------------------------------

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  isBusinessType,
  deriveServiceLocationModeFromBusinessType,
} from '@/lib/org/business-type'

describe('business-type vocabulary', () => {
  it('exposes exactly the four values the migration CHECK constraint allows', () => {
    expect(BUSINESS_TYPES).toEqual(['on_premises_shop', 'mobile_service', 'hybrid', 'other'])
  })

  it('has a label for every business type', () => {
    for (const type of BUSINESS_TYPES) {
      expect(typeof BUSINESS_TYPE_LABELS[type]).toBe('string')
      expect(BUSINESS_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })

  it('isBusinessType accepts only the recognised set', () => {
    expect(isBusinessType('on_premises_shop')).toBe(true)
    expect(isBusinessType('mobile_service')).toBe(true)
    expect(isBusinessType('hybrid')).toBe(true)
    expect(isBusinessType('other')).toBe(true)
    expect(isBusinessType('barbershop')).toBe(false)
    expect(isBusinessType(undefined)).toBe(false)
    expect(isBusinessType(null)).toBe(false)
    expect(isBusinessType(123)).toBe(false)
  })
})

describe('deriveServiceLocationModeFromBusinessType', () => {
  it('maps a shop the customer visits to on_premises', () => {
    expect(deriveServiceLocationModeFromBusinessType('on_premises_shop')).toBe('on_premises')
  })

  it('maps a business that travels to the customer to at_customer', () => {
    expect(deriveServiceLocationModeFromBusinessType('mobile_service')).toBe('at_customer')
  })

  it('maps a business that does both to either', () => {
    expect(deriveServiceLocationModeFromBusinessType('hybrid')).toBe('either')
  })

  it('never forces "other" into a mode that asks for an address', () => {
    expect(deriveServiceLocationModeFromBusinessType('other')).toBe('on_premises')
  })

  it.each([undefined, null, '', 'ON_PREMISES_SHOP', 'barbershop', 42, {}])(
    'fails closed to on_premises for unrecognised input %j',
    (value) => {
      expect(deriveServiceLocationModeFromBusinessType(value)).toBe('on_premises')
    },
  )
})

// ---------------------------------------------------------------------------
// Task 2: updateCompanyProfile() business_type wiring
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { updateCompanyProfile } from '@/app/(dashboard)/settings/company-info/actions'

const ORG_ID = '00000000-0000-0000-0000-0000000000aa'

function buildFakeClient(opts: {
  currentRow: { business_type: string | null; service_location_mode: string | null } | null
}) {
  const updateCalls: Record<string, unknown>[] = []
  const rpc = vi.fn().mockResolvedValue({ data: ORG_ID, error: null })
  const from = vi.fn((table: string) => {
    if (table !== 'organizations') throw new Error(`unexpected table: ${table}`)
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.currentRow, error: null }),
        })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updateCalls.push(patch)
        return { eq: vi.fn().mockResolvedValue({ error: null }) }
      }),
    }
  })
  return { client: { rpc, from }, updateCalls }
}

describe('updateCompanyProfile: business_type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a business_type outside the CHECK set', async () => {
    const { client } = buildFakeClient({ currentRow: null })
    vi.mocked(createClient).mockResolvedValue(client as never)

    const res = await updateCompanyProfile({
      orgId: ORG_ID,
      // @ts-expect-error - intentionally invalid to prove zod rejects it
      business_type: 'barbershop',
    })
    expect(res.ok).toBe(false)
  })

  it('yields the derived mode when the org has no explicit override (no row yet)', async () => {
    const { client, updateCalls } = buildFakeClient({ currentRow: null })
    vi.mocked(createClient).mockResolvedValue(client as never)

    const res = await updateCompanyProfile({ orgId: ORG_ID, business_type: 'mobile_service' })
    expect(res.ok).toBe(true)
    expect(updateCalls[0]).toMatchObject({
      business_type: 'mobile_service',
      service_location_mode: 'at_customer',
    })
  })

  it('yields the derived mode when the current mode still matches the OLD business type default', async () => {
    const { client, updateCalls } = buildFakeClient({
      currentRow: { business_type: 'on_premises_shop', service_location_mode: 'on_premises' },
    })
    vi.mocked(createClient).mockResolvedValue(client as never)

    const res = await updateCompanyProfile({ orgId: ORG_ID, business_type: 'hybrid' })
    expect(res.ok).toBe(true)
    expect(updateCalls[0]).toMatchObject({
      business_type: 'hybrid',
      service_location_mode: 'either',
    })
  })

  it('leaves a deliberately-set mode alone when it diverges from the OLD business type default', async () => {
    // Org is on_premises_shop (implies on_premises) but someone set the mode
    // to at_customer by hand — that deliberate choice must survive a
    // business_type change.
    const { client, updateCalls } = buildFakeClient({
      currentRow: { business_type: 'on_premises_shop', service_location_mode: 'at_customer' },
    })
    vi.mocked(createClient).mockResolvedValue(client as never)

    const res = await updateCompanyProfile({ orgId: ORG_ID, business_type: 'hybrid' })
    expect(res.ok).toBe(true)
    expect(updateCalls[0]).toMatchObject({ business_type: 'hybrid' })
    expect(updateCalls[0]).not.toHaveProperty('service_location_mode')
  })

  it('does not touch service_location_mode or query the current row when business_type is not part of the save', async () => {
    const { client, updateCalls } = buildFakeClient({ currentRow: null })
    vi.mocked(createClient).mockResolvedValue(client as never)

    const res = await updateCompanyProfile({ orgId: ORG_ID, legal_name: 'Acme Inc.' })
    expect(res.ok).toBe(true)
    expect(updateCalls[0]).not.toHaveProperty('business_type')
    expect(updateCalls[0]).not.toHaveProperty('service_location_mode')
  })
})
