// tests/service-location-mode.test.ts
// Phase 138 Plan 01 (MODAL-01/MODAL-02): booking modality engine contracts.
//
// Task 1: structural-contract tests for migration 1297 (new, idempotent,
// never applied here), database.ts widening, and the canary
// book_appointment input_schema gaining customerAddress.
//
// Task 2: unit tests for the three pure/fail-closed modules that own the
// modality vocabulary end to end — applyServiceLocationMode() (schema
// transform), renderServiceLocationBlock() (prompt text), and
// resolveServiceLocationMode() (fail-closed org resolver).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Task 1: migration 1297 structural contract
// ---------------------------------------------------------------------------

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/1297_organization_service_location_mode.sql',
)

describe('migration 1297 organization service_location_mode', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds service_location_mode as a bounded, defaulted column', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS service_location_mode TEXT')
    expect(sql).toMatch(/NOT NULL\s+DEFAULT 'on_premises'/)
    expect(sql).toContain(
      "CHECK (service_location_mode IN ('on_premises', 'at_customer', 'either'))",
    )
  })

  it('is idempotent (ADD COLUMN IF NOT EXISTS, single ALTER TABLE, no separate constraint pair)', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS')
    expect(sql).not.toMatch(/DROP CONSTRAINT/i)
  })

  it('performs no backfill against organizations', () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.organizations/i)
    expect(sql).not.toMatch(/UPDATE\s+public\.organizations\s+SET/i)
  })

  it('documents the safe default and the fail-closed runtime contract', () => {
    expect(sql).toMatch(/on_premises/)
    expect(sql).toMatch(/fail(s)? closed|never (a|to) mode that asks/i)
  })
})

const databaseTypesPath = resolve(process.cwd(), 'src/types/database.ts')

describe('database.ts widened for organizations.service_location_mode', () => {
  const source = readFileSync(databaseTypesPath, 'utf8')
  const orgBlockStart = source.indexOf('organizations: {')
  const orgBlockEnd = source.indexOf('\n      }', source.indexOf('Relationships: []', orgBlockStart))
  const orgBlock = source.slice(orgBlockStart, orgBlockEnd)

  it('adds service_location_mode to Row, Insert, and Update', () => {
    expect(orgBlock).toContain('service_location_mode: string')
    expect(orgBlock).toContain('service_location_mode?: string')
  })
})

const canaryPath = resolve(
  process.cwd(),
  '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json',
)

describe('canary cuts-and-culture.json book_appointment.input_schema', () => {
  const canary = JSON.parse(readFileSync(canaryPath, 'utf8')) as {
    workflows: Array<{ tool_name: string; input_schema: Record<string, unknown> }>
  }
  const bookAppointment = canary.workflows.find((w) => w.tool_name === 'book_appointment')

  it('gains a customerAddress field, optional at this static/default level', () => {
    expect(bookAppointment).toBeDefined()
    const field = bookAppointment!.input_schema.customerAddress as
      | { type?: string; required?: boolean; description?: string }
      | undefined
    expect(field).toBeDefined()
    expect(field!.type).toBe('string')
    expect(field!.required).toBe(false)
    expect(field!.description).toMatch(/service_location_mode/)
  })

  it('leaves the four existing required fields and notes untouched', () => {
    const schema = bookAppointment!.input_schema as Record<string, { required?: boolean }>
    expect(schema.service_id.required).toBe(true)
    expect(schema.date.required).toBe(true)
    expect(schema.time.required).toBe(true)
    expect(schema.customer_name.required).toBe(true)
    expect(schema.customer_phone.required).toBe(true)
    expect(schema.notes.required).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task 2: applyServiceLocationMode()
// ---------------------------------------------------------------------------

import type { InputSchemaMap } from '@/lib/workflows/derive-input-schema'
import { applyServiceLocationMode, isServiceLocationMode } from '@/lib/agent-runtime/service-location-schema'

function baseSchema(): InputSchemaMap {
  return {
    service_id: { type: 'string', required: true },
    customerAddress: { type: 'string', description: 'Customer address.', required: false },
  }
}

describe('applyServiceLocationMode', () => {
  it('deletes customerAddress entirely for on_premises — the model must not see it can exist', () => {
    const result = applyServiceLocationMode(baseSchema(), 'on_premises')
    expect(result).not.toHaveProperty('customerAddress')
    expect(result.service_id).toEqual({ type: 'string', required: true })
  })

  it('keeps customerAddress and makes it required for at_customer', () => {
    const result = applyServiceLocationMode(baseSchema(), 'at_customer')
    expect(result.customerAddress).toMatchObject({ type: 'string', required: true })
  })

  it('keeps customerAddress optional for either', () => {
    const result = applyServiceLocationMode(baseSchema(), 'either')
    expect(result.customerAddress).toMatchObject({ type: 'string', required: false })
  })

  it.each([undefined, null, '', 'ON_PREMISES', 'at_customer_typo', 42, {}])(
    'fails closed to on_premises behaviour for unrecognised mode %j',
    (mode) => {
      const result = applyServiceLocationMode(baseSchema(), mode)
      expect(result).not.toHaveProperty('customerAddress')
    },
  )

  it('returns a map with no customerAddress key unchanged, for every mode', () => {
    const noAddressSchema: InputSchemaMap = { foo: { type: 'string', required: true } }
    for (const mode of ['on_premises', 'at_customer', 'either', 'bogus']) {
      expect(applyServiceLocationMode(noAddressSchema, mode)).toEqual(noAddressSchema)
    }
  })

  it('respects a custom fieldKey', () => {
    const schema: InputSchemaMap = { addr: { type: 'string', required: false } }
    const result = applyServiceLocationMode(schema, 'at_customer', 'addr')
    expect(result.addr).toMatchObject({ required: true })
  })
})

describe('isServiceLocationMode', () => {
  it('accepts only the three recognised modes', () => {
    expect(isServiceLocationMode('on_premises')).toBe(true)
    expect(isServiceLocationMode('at_customer')).toBe(true)
    expect(isServiceLocationMode('either')).toBe(true)
    expect(isServiceLocationMode('ON_PREMISES')).toBe(false)
    expect(isServiceLocationMode('')).toBe(false)
    expect(isServiceLocationMode(undefined)).toBe(false)
    expect(isServiceLocationMode(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task 2: renderServiceLocationBlock()
// ---------------------------------------------------------------------------

import { renderServiceLocationBlock } from '@/lib/agent-runtime/service-location-prompt'

describe('renderServiceLocationBlock', () => {
  it('renders three non-empty, mutually distinct strings for the real modes', () => {
    const onPrem = renderServiceLocationBlock('on_premises')
    const atCust = renderServiceLocationBlock('at_customer')
    const either = renderServiceLocationBlock('either')

    for (const text of [onPrem, atCust, either]) {
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    }

    expect(onPrem).not.toBe(atCust)
    expect(onPrem).not.toBe(either)
    expect(atCust).not.toBe(either)

    // No mode's rendered text is embedded verbatim inside another's — a
    // find-and-replace of one can't silently corrupt another.
    expect(atCust).not.toContain(onPrem)
    expect(either).not.toContain(onPrem)
    expect(onPrem).not.toContain(atCust)
    expect(either).not.toContain(atCust)
    expect(onPrem).not.toContain(either)
    expect(atCust).not.toContain(either)
  })

  it('states plainly that on_premises never asks for or records an address', () => {
    expect(renderServiceLocationBlock('on_premises')).toMatch(/never ask/i)
  })

  it('states that at_customer requires the address, collected after price and before availability', () => {
    const text = renderServiceLocationBlock('at_customer')
    expect(text).toMatch(/address/i)
    expect(text).toMatch(/before checking availability/i)
  })

  it('states that either asks exactly one narrowing question at the same point', () => {
    const text = renderServiceLocationBlock('either')
    expect(text).toMatch(/is this at the shop, or are we coming to you/i)
    expect(text).toMatch(/before checking availability/i)
  })

  it('renders the same on_premises text for any unrecognised mode — fail closed', () => {
    const fallback = renderServiceLocationBlock('bogus')
    expect(fallback).toBe(renderServiceLocationBlock('on_premises'))
    expect(renderServiceLocationBlock(undefined)).toBe(renderServiceLocationBlock('on_premises'))
    expect(renderServiceLocationBlock(null)).toBe(renderServiceLocationBlock('on_premises'))
  })
})

// ---------------------------------------------------------------------------
// Task 2: resolveServiceLocationMode()
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveServiceLocationMode, DEFAULT_SERVICE_LOCATION_MODE } from '@/lib/agent-runtime/resolve-service-location-mode'

const ORG_ID = 'org-11111111-2222-3333-4444-555555555555'

function mockServiceLocationSource(
  resolveRow: (org: string) => { service_location_mode: unknown } | null,
  error: unknown = null,
) {
  const calledTables: string[] = []
  const from = vi.fn((table: string) => {
    calledTables.push(table)
    let org = ''
    const eq = vi.fn((_col: string, val: string) => {
      org = val
      return {
        maybeSingle: vi.fn().mockImplementation(async () => ({
          data: error ? null : resolveRow(org),
          error,
        })),
      }
    })
    const select = vi.fn(() => ({ eq }))
    return { select }
  })
  const client = { from }
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
  return { from, calledTables }
}

describe('resolveServiceLocationMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns on_premises when no row exists for the organization', async () => {
    mockServiceLocationSource(() => null)
    expect(await resolveServiceLocationMode(ORG_ID)).toBe('on_premises')
  })

  it('returns on_premises on a Supabase read error even if a row would otherwise match', async () => {
    mockServiceLocationSource(() => ({ service_location_mode: 'at_customer' }), new Error('boom'))
    expect(await resolveServiceLocationMode(ORG_ID)).toBe('on_premises')
  })

  it.each(['ON_PREMISES', 'AtCustomer', 'true', '', 'ask'])(
    'returns on_premises for the unrecognised stored value %j',
    async (value) => {
      mockServiceLocationSource(() => ({ service_location_mode: value }))
      expect(await resolveServiceLocationMode(ORG_ID)).toBe('on_premises')
    },
  )

  it.each([null, undefined, 123, {}, []])(
    'returns on_premises for malformed stored data %j',
    async (value) => {
      mockServiceLocationSource(() => ({ service_location_mode: value as unknown }))
      expect(await resolveServiceLocationMode(ORG_ID)).toBe('on_premises')
    },
  )

  it('returns on_premises when organizationId is missing, without querying the database', async () => {
    const { from } = mockServiceLocationSource(() => ({ service_location_mode: 'at_customer' }))
    expect(await resolveServiceLocationMode('')).toBe('on_premises')
    expect(from).not.toHaveBeenCalled()
  })

  it('returns at_customer for the exact recognised value', async () => {
    mockServiceLocationSource(() => ({ service_location_mode: 'at_customer' }))
    expect(await resolveServiceLocationMode(ORG_ID)).toBe('at_customer')
  })

  it('returns either for the exact recognised value', async () => {
    mockServiceLocationSource(() => ({ service_location_mode: 'either' }))
    expect(await resolveServiceLocationMode(ORG_ID)).toBe('either')
  })

  it('never throws, even when the client factory itself throws', async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('no env var')
    })
    await expect(resolveServiceLocationMode(ORG_ID)).resolves.toBe(DEFAULT_SERVICE_LOCATION_MODE)
  })

  it('only ever reads from organizations for this lookup', async () => {
    const { calledTables } = mockServiceLocationSource(() => ({ service_location_mode: 'at_customer' }))
    await resolveServiceLocationMode(ORG_ID)
    expect(calledTables).toEqual(['organizations'])
  })
})
