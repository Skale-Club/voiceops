import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ---- Helpers for building mock Supabase query chains ----
function makeSingleChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeInsertChain(result: { data: unknown; error: unknown }) {
  return {
    insert: vi.fn().mockResolvedValue(result),
  }
}

// ---- ACTN-01: Org resolution ----

describe('ACTN-01: Org resolution by assistant ID', () => {
  beforeEach(() => vi.resetModules())

  it('resolveOrg(assistantId) returns organization_id for a known active assistant mapping', async () => {
    const chain = makeSingleChain({ data: { organization_id: 'org_abc' }, error: null })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveOrg } = await import('@/lib/action-engine/resolve-org')
    const result = await resolveOrg('asst_known', supabase)

    expect(supabase.from).toHaveBeenCalledWith('assistant_mappings')
    expect(chain.select).toHaveBeenCalledWith('organization_id')
    expect(chain.eq).toHaveBeenCalledWith('vapi_assistant_id', 'asst_known')
    expect(chain.eq).toHaveBeenCalledWith('is_active', true)
    expect(result).toBe('org_abc')
  })

  it('resolveOrg(assistantId) returns null for unknown assistant ID', async () => {
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveOrg } = await import('@/lib/action-engine/resolve-org')
    const result = await resolveOrg('asst_unknown', supabase)

    expect(result).toBeNull()
  })

  it('resolveOrg(assistantId) returns null for inactive assistant mapping (is_active=false)', async () => {
    // Inactive mapping: DB query filters is_active=true, so returns no rows → error
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveOrg } = await import('@/lib/action-engine/resolve-org')
    const result = await resolveOrg('asst_inactive', supabase)

    expect(result).toBeNull()
  })
})

// ---- ACTN-02: Tool config routing ----

describe('ACTN-02: Tool config routing', () => {
  beforeEach(() => vi.resetModules())

  const mockToolConfig = {
    id: 'tc_001',
    organization_id: 'org_abc',
    integration_id: 'int_001',
    tool_name: 'create_lead',
    action_type: 'create_contact' as const,
    config: {},
    fallback_message: 'Sorry, I could not create the contact.',
    is_active: true,
    integrations: {
      id: 'int_001',
      encrypted_api_key: 'encrypted:abc',
      location_id: 'loc_xyz',
      provider: 'gohighlevel' as const,
      config: {},
    },
  }

  it('resolveTool(orgId, toolName) returns tool_config row with integration for a matching active config', async () => {
    const chain = makeSingleChain({ data: mockToolConfig, error: null })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'create_lead', supabase)

    expect(supabase.from).toHaveBeenCalledWith('tool_configs')
    expect(chain.select).toHaveBeenCalledWith('*, integrations(*)')
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org_abc')
    expect(chain.eq).toHaveBeenCalledWith('tool_name', 'create_lead')
    expect(chain.eq).toHaveBeenCalledWith('is_active', true)
    expect(result).toEqual(mockToolConfig)
    expect(result?.integrations.encrypted_api_key).toBe('encrypted:abc')
  })

  it('resolveTool(orgId, toolName) returns null for unknown tool name in that org', async () => {
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'unknown_tool', supabase)

    expect(result).toBeNull()
  })

  it('resolveTool(orgId, toolName) returns null for inactive tool config (is_active=false)', async () => {
    // Inactive config: DB query filters is_active=true, so returns no rows → error
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'inactive_tool', supabase)

    expect(result).toBeNull()
  })
})

// ---- ACTN-11: executeAction dispatcher ----

describe('ACTN-11: executeAction dispatcher', () => {
  beforeEach(() => vi.resetModules())

  const credentials = { apiKey: 'decrypted-token', locationId: 'loc_xyz' }
  const params = { firstName: 'Jane', email: 'jane@example.com' }

  it('executeAction("create_contact", params, credentials) calls createContact and returns its string result', async () => {
    vi.doMock('@/lib/ghl/create-contact', () => ({
      createContact: vi.fn().mockResolvedValue('Contact created. ID: cid_123'),
    }))
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('create_contact', params, credentials)
    expect(result).toBe('Contact created. ID: cid_123')
  })

  it('executeAction("get_availability", params, credentials) calls getAvailability and returns its string result', async () => {
    vi.doMock('@/lib/ghl/get-availability', () => ({
      getAvailability: vi.fn().mockResolvedValue('Available slots: 09:00 AM, 10:00 AM'),
    }))
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('get_availability', { calendarId: 'cal_123', startDate: '2026-04-10', endDate: '2026-04-11' }, credentials)
    expect(result).toBe('Available slots: 09:00 AM, 10:00 AM')
  })

  it('executeAction("create_appointment", params, credentials) calls createAppointment and returns its string result', async () => {
    vi.doMock('@/lib/ghl/create-appointment', () => ({
      createAppointment: vi.fn().mockResolvedValue('Appointment confirmed. ID: appt_789'),
    }))
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('create_appointment', { calendarId: 'cal_123', contactId: 'cid_456', startTime: '2026-04-10T09:00:00Z', endTime: '2026-04-10T09:30:00Z' }, credentials)
    expect(result).toBe('Appointment confirmed. ID: appt_789')
  })

  it('executeAction with unsupported action_type throws "Unsupported action type: send_sms"', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    await expect(executeAction('send_sms', params, credentials)).rejects.toThrow('Unsupported action type: send_sms')
  })
})

// ---- ACTN-12: logAction ----

describe('ACTN-12: logAction writes action_logs and swallows errors', () => {
  beforeEach(() => vi.resetModules())

  const payload = {
    organization_id: 'org_abc',
    tool_config_id: 'tc_001',
    vapi_call_id: 'call_xyz',
    tool_name: 'create_lead',
    status: 'success' as const,
    execution_ms: 123,
    request_payload: { firstName: 'Jane' },
    response_payload: { result: 'Contact created. ID: cid_123' },
    error_detail: null,
  }

  it('logAction() calls supabase.from("action_logs").insert() with the provided payload', async () => {
    const insertChain = makeInsertChain({ data: null, error: null })
    const supabase = { from: vi.fn().mockReturnValue(insertChain) } as unknown as SupabaseClient<Database>

    const { logAction } = await import('@/lib/action-engine/log-action')
    await logAction(payload, supabase)

    expect(supabase.from).toHaveBeenCalledWith('action_logs')
    expect(insertChain.insert).toHaveBeenCalledWith(payload)
  })

  it('logAction() does not throw on Supabase insert error — swallows errors silently', async () => {
    const insertChain = {
      insert: vi.fn().mockRejectedValue(new Error('DB connection error')),
    }
    const supabase = { from: vi.fn().mockReturnValue(insertChain) } as unknown as SupabaseClient<Database>

    const { logAction } = await import('@/lib/action-engine/log-action')
    // Must resolve (not reject) even when DB throws
    await expect(logAction(payload, supabase)).resolves.toBeUndefined()
  })
})
