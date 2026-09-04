import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// execute-action imports the complete executor catalog, including Medusa modules
// that import the Redis singleton. Keep this unit suite hermetic: it verifies
// dispatcher wiring, not Redis connectivity.
vi.mock('@/lib/redis', () => ({
  default: {
    isReady: false,
    on: vi.fn(),
    connect: vi.fn(),
  },
}))

// Route observability is covered separately. Avoid background event-log network
// attempts leaking into the focused Vapi contract tests.
vi.mock('@/lib/logger', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

// ---- Helpers for building mock Vapi webhook payloads ----
function makeVapiPayload(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      type: 'tool-calls',
      call: {
        id: 'call_abc',
        assistantId: 'asst_known',
      },
      toolCallList: [
        {
          id: 'tc_call_001',
          name: 'create_lead',
          arguments: { firstName: 'Jane', email: 'jane@example.com' },
        },
      ],
      ...overrides,
    },
  }
}

// ---- Helpers for building mock Supabase query chains ----
function makeSingleChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return chain
}

// ---- Canned rows for the unified resolver (SEED-025: workflows kind='tool') ----
// resolveTool → resolveWorkflowAsTool reads workflows → workflow_versions →
// integrations and projects the result back into ToolConfigWithIntegration.
const FALLBACK_MESSAGE = 'Sorry, unable to help right now.'

const workflowRow = {
  id: 'wf_001',
  org_id: 'org_abc',
  tool_name: 'create_lead',
  is_active: true,
  health_blocked: false,
  current_version_id: 'ver_001',
  legacy_tool_config_id: 'tc_001',
}

const versionRow = {
  definition: {
    nodes: [
      {
        id: 'n1',
        type: 'action',
        data: {
          kind: 'action',
          action_type: 'create_contact',
          config: {},
          credential_ref: 'int_001',
          fallback_message: FALLBACK_MESSAGE,
        },
      },
    ],
  },
}

const integrationRow = {
  id: 'int_001',
  encrypted_api_key: 'aXY=:Y3Q=', // fake base64 iv:ct
  location_id: 'loc_xyz',
  provider: 'gohighlevel' as const,
  config: {},
}

function makeResolverSupabase(workflowResult: { data: unknown; error: unknown }) {
  const workflowsChain = makeSingleChain(workflowResult)
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'workflows') return workflowsChain
    if (table === 'workflow_versions') return makeSingleChain({ data: versionRow, error: null })
    if (table === 'integrations') return makeSingleChain({ data: integrationRow, error: null })
    return makeSingleChain({ data: null, error: { code: 'unknown', message: 'unexpected table' } })
  })
  return {
    supabase: { from: fromFn } as unknown as SupabaseClient<Database>,
    workflowsChain,
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

  it('resolveTool(orgId, toolName) projects the workflow into ToolConfigWithIntegration', async () => {
    const { supabase, workflowsChain } = makeResolverSupabase({ data: workflowRow, error: null })

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'create_lead', supabase)

    expect(supabase.from).toHaveBeenCalledWith('workflows')
    expect(workflowsChain.eq).toHaveBeenCalledWith('org_id', 'org_abc')
    expect(workflowsChain.eq).toHaveBeenCalledWith('kind', 'tool')
    expect(workflowsChain.eq).toHaveBeenCalledWith('tool_name', 'create_lead')
    expect(workflowsChain.eq).toHaveBeenCalledWith('is_active', true)
    expect(result).toEqual({
      id: 'tc_001', // legacy_tool_config_id preserved for transition compat
      workflow_id: 'wf_001',
      organization_id: 'org_abc',
      integration_id: 'int_001',
      tool_name: 'create_lead',
      action_type: 'create_contact',
      config: {},
      fallback_message: FALLBACK_MESSAGE,
      is_active: true,
      integrations: integrationRow,
    })
    expect(result?.integrations.encrypted_api_key).toBe('aXY=:Y3Q=')
  })

  it('resolveTool(orgId, toolName) returns null for unknown tool name in that org', async () => {
    const { supabase } = makeResolverSupabase({ data: null, error: { code: 'PGRST116', message: 'Not found' } })

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

  it('executeAction send_sms without ctx throws missing ctx error', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    // send_sms is now implemented — requires ctx with organizationId and supabase
    await expect(executeAction('send_sms', params, credentials)).rejects.toThrow('send_sms requires ctx.organizationId and ctx.supabase')
  })
})

// ---- ACTN-12: logToolRun (successor of the frozen logAction/action_logs path) ----

describe('ACTN-12: logToolRun writes workflow_runs (kind=tool) and swallows errors', () => {
  beforeEach(() => vi.resetModules())

  const input = {
    orgId: 'org_abc',
    workflowId: 'wf_001',
    toolName: 'create_lead',
    triggerType: 'vapi',
    vapiCallId: 'call_xyz',
    status: 'success' as const,
    executionMs: 123,
    requestPayload: { firstName: 'Jane' },
    responsePayload: { result: 'Contact created. ID: cid_123' },
    errorDetail: null,
  }

  it('logToolRun() inserts a terminal workflow_runs row with kind=tool and returns its id', async () => {
    const singleSpy = vi.fn().mockResolvedValue({ data: { id: 'run_1' }, error: null })
    const selectSpy = vi.fn().mockReturnValue({ single: singleSpy })
    const insertSpy = vi.fn().mockReturnValue({ select: selectSpy })
    const supabase = { from: vi.fn().mockReturnValue({ insert: insertSpy }) } as unknown as SupabaseClient<Database>

    const { logToolRun } = await import('@/lib/workflows/log-tool-run')
    const runId = await logToolRun(input, supabase)

    expect(supabase.from).toHaveBeenCalledWith('workflow_runs')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org_abc',
      workflow_id: 'wf_001',
      kind: 'tool',
      trigger_type: 'vapi',
      vapi_call_id: 'call_xyz',
      tool_name: 'create_lead',
      status: 'succeeded',
      execution_ms: 123,
    }))
    expect(runId).toBe('run_1')
  })

  it('logToolRun() maps timeout/error statuses to run statuses', async () => {
    const singleSpy = vi.fn().mockResolvedValue({ data: { id: 'run_1' }, error: null })
    const selectSpy = vi.fn().mockReturnValue({ single: singleSpy })
    const insertSpy = vi.fn().mockReturnValue({ select: selectSpy })
    const supabase = { from: vi.fn().mockReturnValue({ insert: insertSpy }) } as unknown as SupabaseClient<Database>

    const { logToolRun } = await import('@/lib/workflows/log-tool-run')
    await logToolRun({ ...input, status: 'timeout' }, supabase)
    await logToolRun({ ...input, status: 'error', errorDetail: 'boom' }, supabase)

    expect(insertSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'timeout' }))
    expect(insertSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'failed', error: 'boom' }))
  })

  it('logToolRun() does not throw on Supabase insert error — resolves null', async () => {
    const insertSpy = vi.fn().mockImplementation(() => {
      throw new Error('DB connection error')
    })
    const supabase = { from: vi.fn().mockReturnValue({ insert: insertSpy }) } as unknown as SupabaseClient<Database>

    const { logToolRun } = await import('@/lib/workflows/log-tool-run')
    // Must resolve (not reject) even when DB throws — returns null on error
    await expect(logToolRun(input, supabase)).resolves.toBeNull()
  })
})

// ---- ACTN-09 + ACTN-10: Vapi tools webhook route ----

describe('POST /api/vapi/tools — webhook route', () => {
  beforeEach(() => vi.resetModules())

  // Tool resolution goes workflows → workflow_versions → integrations (SEED-025),
  // using the canned workflowRow/versionRow/integrationRow fixtures above.
  function buildMockSupabase(
    assistantResult: { data: unknown; error: unknown },
    workflowResult: { data: unknown; error: unknown }
  ) {
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'assistant_mappings') {
        return makeSingleChain(assistantResult)
      }
      if (table === 'workflows') {
        return makeSingleChain(workflowResult)
      }
      if (table === 'workflow_versions') {
        return makeSingleChain({ data: versionRow, error: null })
      }
      if (table === 'integrations') {
        return makeSingleChain({ data: integrationRow, error: null })
      }
      if (table === 'workflow_runs') {
        // logToolRun: insert(...).select('id').single()
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'run_1' }, error: null }),
            }),
          }),
        }
      }
      return makeSingleChain({ data: null, error: { code: 'unknown', message: 'unexpected table' } })
    })
    return { from: fromFn } as unknown as SupabaseClient<Database>
  }

  it('Test 1: POST with valid assistantId + tool → returns 200 with results[0].result string', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: workflowRow, error: null }
        )
      ),
    }))
    vi.doMock('@/lib/crypto', () => ({
      decrypt: vi.fn().mockResolvedValue('decrypted-api-key'),
    }))
    vi.doMock('@/lib/action-engine/execute-action', () => ({
      executeAction: vi.fn().mockResolvedValue('Contact created. ID: cid_123'),
    }))
    // Phase 133: the route now guards side-effecting calls with the shared
    // idempotency helpers, which build their OWN service-role client rather
    // than the one mocked above. Stub the module so these tests keep asserting
    // what they were written for — the route's action-dispatch contract — while
    // the guard's own behavior is covered by tests/vapi-tools-idempotency.test.ts
    // and tests/idempotency-ingress-key.test.ts.
    vi.doMock('@/lib/agent-runtime/idempotency', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()),
      checkIdempotency: vi.fn().mockResolvedValue({ status: 'fresh' }),
      recordIdempotency: vi.fn().mockResolvedValue(undefined),
      recordAbandonedIdempotency: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock('@/lib/workflows/log-tool-run', () => ({
      logToolRun: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].toolCallId).toBe('tc_call_001')
    expect(typeof body.results[0].result).toBe('string')
    expect(body.results[0].result).toBe('Contact created. ID: cid_123')
  })

  it('Test 2: POST with unknown assistantId → returns 200 with result: "Service unavailable."', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: null, error: { code: 'PGRST116', message: 'Not found' } },
          { data: null, error: null }
        )
      ),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe('Service unavailable.')
  })

  it('Test 3: POST with known assistantId but unconfigured tool → returns 200 with result: "Tool not configured."', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: null, error: { code: 'PGRST116', message: 'Not found' } }
        )
      ),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe('Tool not configured.')
  })

  it('Test 4: POST where GHL executor throws → returns 200 with toolConfig.fallback_message', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: workflowRow, error: null }
        )
      ),
    }))
    vi.doMock('@/lib/crypto', () => ({
      decrypt: vi.fn().mockResolvedValue('decrypted-api-key'),
    }))
    vi.doMock('@/lib/action-engine/execute-action', () => ({
      executeAction: vi.fn().mockRejectedValue(new Error('GHL API error 500')),
    }))
    // Phase 133: the route now guards side-effecting calls with the shared
    // idempotency helpers, which build their OWN service-role client rather
    // than the one mocked above. Stub the module so these tests keep asserting
    // what they were written for — the route's action-dispatch contract — while
    // the guard's own behavior is covered by tests/vapi-tools-idempotency.test.ts
    // and tests/idempotency-ingress-key.test.ts.
    vi.doMock('@/lib/agent-runtime/idempotency', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()),
      checkIdempotency: vi.fn().mockResolvedValue({ status: 'fresh' }),
      recordIdempotency: vi.fn().mockResolvedValue(undefined),
      recordAbandonedIdempotency: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock('@/lib/workflows/log-tool-run', () => ({
      logToolRun: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe(FALLBACK_MESSAGE)
  })

  it('Test 5: POST with invalid JSON body → returns 200 with results: []', async () => {
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: 'not-valid-json{{{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([])
  })

  it('Test 6: logToolRun is called via after() — NOT awaited inline before the Response is returned', async () => {
    const afterMock = vi.fn()
    const logToolRunMock = vi.fn().mockResolvedValue(null)

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: workflowRow, error: null }
        )
      ),
    }))
    vi.doMock('@/lib/crypto', () => ({
      decrypt: vi.fn().mockResolvedValue('decrypted-api-key'),
    }))
    vi.doMock('@/lib/action-engine/execute-action', () => ({
      executeAction: vi.fn().mockResolvedValue('Contact created.'),
    }))
    // Phase 133: the route now guards side-effecting calls with the shared
    // idempotency helpers, which build their OWN service-role client rather
    // than the one mocked above. Stub the module so these tests keep asserting
    // what they were written for — the route's action-dispatch contract — while
    // the guard's own behavior is covered by tests/vapi-tools-idempotency.test.ts
    // and tests/idempotency-ingress-key.test.ts.
    vi.doMock('@/lib/agent-runtime/idempotency', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/agent-runtime/idempotency')>()),
      checkIdempotency: vi.fn().mockResolvedValue({ status: 'fresh' }),
      recordIdempotency: vi.fn().mockResolvedValue(undefined),
      recordAbandonedIdempotency: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock('@/lib/workflows/log-tool-run', () => ({
      logToolRun: logToolRunMock,
    }))
    vi.doMock('next/server', () => ({
      after: afterMock,
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    // after() must be called exactly once (to schedule async logging)
    expect(afterMock).toHaveBeenCalledTimes(1)
    // logToolRun must NOT have been directly awaited before the response
    // (it is passed as a callback to after(), so logToolRun itself is not called yet)
    expect(logToolRunMock).not.toHaveBeenCalled()
  })
})
