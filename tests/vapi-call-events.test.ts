// Covers the two pieces that make a Vapi-native number a first-class citizen:
//   1. resolveOrgForCall — tenant resolution when the assistant isn't mapped and
//      only the number identifies the org.
//   2. emitVapiCallEndedEvent — the `vapi.call.ended` workflow trigger, which was
//      offered in the flow builder but never emitted by anything.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runFlowSyncMock, runFlowMock, definitionHasWaitMock, resumeMatchingWaitsMock } = vi.hoisted(
  () => ({
    runFlowSyncMock: vi.fn(async () => ({ status: 'succeeded' })),
    runFlowMock: vi.fn(async () => ({ runId: 'run-1', status: 'succeeded' })),
    definitionHasWaitMock: vi.fn(() => false),
    resumeMatchingWaitsMock: vi.fn(async () => undefined),
  }),
)

vi.mock('@/lib/workflows/run-flow-sync', () => ({ runFlowSync: runFlowSyncMock }))
vi.mock('@/lib/flows/engine', () => ({
  runFlow: runFlowMock,
  definitionHasWait: definitionHasWaitMock,
}))
vi.mock('@/lib/flows/resume-waits', () => ({ resumeMatchingWaits: resumeMatchingWaitsMock }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    throw new Error('tests always pass an explicit client')
  },
}))

import { resolveOrgForCall } from '@/lib/vapi/end-of-call'
import {
  buildVapiCallEventPayload,
  emitVapiCallEndedEvent,
  VAPI_CALL_ENDED_EVENT,
} from '@/lib/vapi/events'
import { TRIGGERS } from '@/lib/workflows/spec'

type Row = Record<string, unknown>
interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

interface SpyConfig {
  assistantMapping?: Row | null
  /** Row returned when looking up twilio_phone_numbers by vapi_phone_number_id. */
  numberByVapiId?: Row | null
  /** Row returned when looking up twilio_phone_numbers by vapi_assistant_id. */
  numberByAssistant?: Row | null
  phoneScopeRow?: Row | null
  contactRow?: Row | null
  workflowsResult?: Row[]
  versionsResult?: Row[]
}

function createSpyClient(config: SpyConfig = {}) {
  const calls: RecordedCall[] = []

  function makeQuery(table: string) {
    // Which twilio_phone_numbers lookup this is depends on the column filtered on.
    let phoneLookupColumn: string | null = null

    const q: Record<string, unknown> = {
      select(...args: unknown[]) {
        calls.push({ table, method: 'select', args })
        return q
      },
      eq(...args: unknown[]) {
        calls.push({ table, method: 'eq', args })
        if (table === 'twilio_phone_numbers' && typeof args[0] === 'string') {
          if (args[0] === 'vapi_phone_number_id' || args[0] === 'vapi_assistant_id') {
            phoneLookupColumn = args[0]
          }
        }
        return q
      },
      contains(...args: unknown[]) {
        calls.push({ table, method: 'contains', args })
        return q
      },
      order(...args: unknown[]) {
        calls.push({ table, method: 'order', args })
        return q
      },
      limit(...args: unknown[]) {
        calls.push({ table, method: 'limit', args })
        return q
      },
      in(...args: unknown[]) {
        calls.push({ table, method: 'in', args })
        return q
      },
      insert(row: Row) {
        calls.push({ table, method: 'insert', args: [row] })
        return q
      },
      async maybeSingle() {
        if (table === 'assistant_mappings') return { data: config.assistantMapping ?? null, error: null }
        if (table === 'contacts') return { data: config.contactRow ?? null, error: null }
        if (table === 'twilio_phone_numbers') {
          if (phoneLookupColumn === 'vapi_phone_number_id') {
            return { data: config.numberByVapiId ?? null, error: null }
          }
          if (phoneLookupColumn === 'vapi_assistant_id') {
            return { data: config.numberByAssistant ?? null, error: null }
          }
          // buildPhoneScope filters on id.
          return { data: config.phoneScopeRow ?? null, error: null }
        }
        return { data: null, error: null }
      },
      async single() {
        if (table === 'event_dispatches') return { data: { id: 'disp-1' }, error: null }
        return { data: null, error: null }
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (table === 'workflows') {
          resolve({ data: config.workflowsResult ?? [], error: null })
          return
        }
        if (table === 'workflow_versions') {
          resolve({ data: config.versionsResult ?? [], error: null })
          return
        }
        resolve({ data: null, error: null })
      },
    }
    return q
  }

  return { client: { from: (table: string) => makeQuery(table) }, calls }
}

describe('resolveOrgForCall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves via assistant_mappings when the assistant is registered', async () => {
    const spy = createSpyClient({
      assistantMapping: { organization_id: 'org-1', entry_agent_id: 'agent-entry-1' },
    })

    const result = await resolveOrgForCall({ assistantId: 'asst-1' }, spy.client as never)

    expect(result).toEqual({
      organizationId: 'org-1',
      phoneNumberId: null,
      entryAgentId: 'agent-entry-1',
    })
  })

  it('preserves legacy routing when the active mapping has no entry agent', async () => {
    const spy = createSpyClient({
      assistantMapping: { organization_id: 'org-1', entry_agent_id: null },
    })

    const result = await resolveOrgForCall({ assistantId: 'asst-1' }, spy.client as never)

    expect(result).toEqual({ organizationId: 'org-1', phoneNumberId: null, entryAgentId: null })
  })

  it('resolves via the Vapi number when the assistant is not mapped', async () => {
    // The "customer owns their number in Vapi, never registered the assistant"
    // case — the number is the only tenant signal available.
    const spy = createSpyClient({
      assistantMapping: null,
      numberByVapiId: { id: 'pn-1', organization_id: 'org-2' },
    })

    const result = await resolveOrgForCall(
      { assistantId: 'asst-unknown', phoneNumberId: 'vapi-num-1' },
      spy.client as never,
    )

    expect(result).toEqual({
      organizationId: 'org-2',
      phoneNumberId: 'pn-1',
      entryAgentId: null,
    })
  })

  it('resolves with no assistant at all, from the number alone', async () => {
    const spy = createSpyClient({ numberByVapiId: { id: 'pn-9', organization_id: 'org-9' } })

    const result = await resolveOrgForCall({ phoneNumberId: 'vapi-num-9' }, spy.client as never)

    expect(result).toEqual({
      organizationId: 'org-9',
      phoneNumberId: 'pn-9',
      entryAgentId: null,
    })
  })

  it('attaches the number to a call whose assistant is mapped', async () => {
    const spy = createSpyClient({
      assistantMapping: { organization_id: 'org-1', entry_agent_id: null },
      numberByVapiId: { id: 'pn-1', organization_id: 'org-1' },
    })

    const result = await resolveOrgForCall(
      { assistantId: 'asst-1', phoneNumberId: 'vapi-num-1' },
      spy.client as never,
    )

    expect(result).toEqual({
      organizationId: 'org-1',
      phoneNumberId: 'pn-1',
      entryAgentId: null,
    })
  })

  it('ignores a number owned by a different org than the mapped assistant', async () => {
    // A misconfiguration; attributing the call to another tenant's number would
    // leak the call into their reporting and workflow triggers.
    const spy = createSpyClient({
      assistantMapping: { organization_id: 'org-1', entry_agent_id: 'agent-entry-1' },
      numberByVapiId: { id: 'pn-other', organization_id: 'org-other' },
    })

    const result = await resolveOrgForCall(
      { assistantId: 'asst-1', phoneNumberId: 'vapi-num-1' },
      spy.client as never,
    )

    expect(result).toEqual({
      organizationId: 'org-1',
      phoneNumberId: null,
      entryAgentId: 'agent-entry-1',
    })
  })

  it('falls back to the legacy per-number assistant override', async () => {
    const spy = createSpyClient({
      assistantMapping: null,
      numberByVapiId: null,
      numberByAssistant: { id: 'pn-legacy', organization_id: 'org-3' },
    })

    const result = await resolveOrgForCall({ assistantId: 'asst-legacy' }, spy.client as never)

    expect(result).toEqual({
      organizationId: 'org-3',
      phoneNumberId: 'pn-legacy',
      entryAgentId: null,
    })
  })

  it('returns nothing when neither signal identifies an org', async () => {
    const spy = createSpyClient()

    const result = await resolveOrgForCall({ assistantId: 'asst-x' }, spy.client as never)

    expect(result).toEqual({ organizationId: null, phoneNumberId: null, entryAgentId: null })
  })
})

function payload(overrides: Partial<Parameters<typeof emitVapiCallEndedEvent>[1]> = {}) {
  return {
    callId: 'call-row-1',
    vapiCallId: 'vapi-call-1',
    phoneNumberId: 'pn-1',
    orgNumber: '+14155550100',
    customerNumber: '+14155550199',
    customerName: 'Jane',
    direction: 'inbound' as const,
    durationSeconds: 42,
    endedReason: 'customer-ended-call',
    successEvaluation: 'true',
    summary: 'Booked a visit.',
    recordingUrl: 'https://storage.vapi.ai/rec.mp3',
    assistantId: 'asst-1',
    ...overrides,
  }
}

describe('emitVapiCallEndedEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is registered in the workflow spec so the flow builder can offer it', () => {
    const trigger = TRIGGERS.find((t) => t.type === `event:${VAPI_CALL_ENDED_EVENT}`)
    expect(trigger).toBeDefined()
    expect(trigger?.variables).toContain('call.*')
    expect(trigger?.variables).toContain('phone.*')
  })

  it('matches workflows on the vapi.call.ended event', async () => {
    const spy = createSpyClient()
    await emitVapiCallEndedEvent('org-1', payload(), { supabase: spy.client as never })

    const contains = spy.calls.find((c) => c.table === 'workflows' && c.method === 'contains')
    expect(contains?.args[1]).toEqual({ event: VAPI_CALL_ENDED_EVENT })
  })

  it('runs a workflow scoped to the number the call landed on', async () => {
    const spy = createSpyClient({
      workflowsResult: [
        { id: 'wf-1', current_version_id: 'ver-1', trigger_config: { event: VAPI_CALL_ENDED_EVENT, phone_number_id: 'pn-1' } },
      ],
      versionsResult: [{ id: 'ver-1', definition: { nodes: [] } }],
    })

    const result = await emitVapiCallEndedEvent('org-1', payload(), { supabase: spy.client as never })

    expect(result.dispatched).toBe(1)
    expect(runFlowSyncMock).toHaveBeenCalledTimes(1)
  })

  it('skips a workflow scoped to a different number', async () => {
    const spy = createSpyClient({
      workflowsResult: [
        { id: 'wf-1', current_version_id: 'ver-1', trigger_config: { event: VAPI_CALL_ENDED_EVENT, phone_number_id: 'pn-other' } },
      ],
      versionsResult: [{ id: 'ver-1', definition: { nodes: [] } }],
    })

    const result = await emitVapiCallEndedEvent('org-1', payload(), { supabase: spy.client as never })

    expect(result.dispatched).toBe(0)
    expect(runFlowSyncMock).not.toHaveBeenCalled()
  })

  it('runs an unscoped workflow for any number', async () => {
    const spy = createSpyClient({
      workflowsResult: [
        { id: 'wf-1', current_version_id: 'ver-1', trigger_config: { event: VAPI_CALL_ENDED_EVENT } },
      ],
      versionsResult: [{ id: 'ver-1', definition: { nodes: [] } }],
    })

    const result = await emitVapiCallEndedEvent('org-1', payload({ phoneNumberId: null }), {
      supabase: spy.client as never,
    })

    expect(result.dispatched).toBe(1)
  })

  it('exposes the call and the number to the workflow scope', async () => {
    const spy = createSpyClient({
      phoneScopeRow: {
        id: 'pn-1',
        e164: '+14155550100',
        provider: 'vapi',
        friendly_name: 'Front desk',
        inbox_label: null,
        business_purpose: null,
        vapi_assistant_id: 'asst-1',
        forward_to_number: '+14155550111',
        responsible_user_id: null,
        is_default: false,
        capability_sms: false,
        capability_voice: true,
        capability_mms: false,
      },
      workflowsResult: [
        { id: 'wf-1', current_version_id: 'ver-1', trigger_config: { event: VAPI_CALL_ENDED_EVENT } },
      ],
      versionsResult: [{ id: 'ver-1', definition: { nodes: [] } }],
    })

    await emitVapiCallEndedEvent('org-1', payload(), { supabase: spy.client as never })

    const calls = runFlowSyncMock.mock.calls as unknown as Array<
      [{ triggerInput: { call: Record<string, unknown>; phone: Record<string, unknown> } }]
    >
    const arg = calls[0][0]
    expect(arg.triggerInput.call.recording_url).toBe('https://storage.vapi.ai/rec.mp3')
    expect(arg.triggerInput.call.org_number).toBe('+14155550100')
    expect(arg.triggerInput.phone.forward_to_number).toBe('+14155550111')
  })

  it('records the dispatch against the calls row', async () => {
    const spy = createSpyClient()
    await emitVapiCallEndedEvent('org-1', payload(), { supabase: spy.client as never })

    const insert = spy.calls.find((c) => c.table === 'event_dispatches' && c.method === 'insert')
    const row = insert?.args[0] as Row
    expect(row.source_table).toBe('calls')
    expect(row.source_id).toBe('call-row-1')
    expect(row.event_type).toBe(VAPI_CALL_ENDED_EVENT)
  })

  it('never throws when the query layer fails', async () => {
    const brokenClient = {
      from: () => {
        throw new Error('db down')
      },
    }

    await expect(
      emitVapiCallEndedEvent('org-1', payload(), { supabase: brokenClient as never }),
    ).resolves.toEqual({ dispatched: 0, dispatch_id: null })
  })
})

describe('buildVapiCallEventPayload', () => {
  const base = {
    type: 'end-of-call-report' as const,
    endedReason: 'customer-ended-call',
    startedAt: '2026-08-16T12:00:00.000Z',
    endedAt: '2026-08-16T12:00:42.000Z',
    call: {
      id: 'vapi-call-1',
      assistantId: 'asst-1',
      type: 'inboundPhoneCall',
      phoneNumberId: 'vapi-num-1',
      phoneNumber: { number: '+14155550100' },
      customer: { number: '+14155550199', name: 'Jane' },
    },
    artifact: { recordingUrl: 'https://storage.vapi.ai/rec.mp3' },
    analysis: { summary: 'Booked a visit.', successEvaluation: true },
  }

  it('derives duration from the report timestamps', () => {
    const result = buildVapiCallEventPayload(base as never, { callId: 'c1', phoneNumberId: 'pn-1' })
    expect(result.durationSeconds).toBe(42)
  })

  it('marks outbound campaign calls as outbound', () => {
    const result = buildVapiCallEventPayload(
      { ...base, call: { ...base.call, type: 'outboundPhoneCall' } } as never,
      { callId: 'c1', phoneNumberId: null },
    )
    expect(result.direction).toBe('outbound')
  })

  it('normalizes a boolean successEvaluation to a string', () => {
    const result = buildVapiCallEventPayload(base as never, { callId: 'c1', phoneNumberId: null })
    expect(result.successEvaluation).toBe('true')
  })

  it('falls back to the stereo recording when no mono URL is present', () => {
    const result = buildVapiCallEventPayload(
      { ...base, artifact: { stereoRecordingUrl: 'https://storage.vapi.ai/stereo.wav' } } as never,
      { callId: 'c1', phoneNumberId: null },
    )
    expect(result.recordingUrl).toBe('https://storage.vapi.ai/stereo.wav')
  })

  it('leaves duration null when timestamps are missing', () => {
    const result = buildVapiCallEventPayload(
      { ...base, startedAt: undefined, endedAt: undefined, call: { ...base.call, startedAt: undefined, endedAt: undefined } } as never,
      { callId: 'c1', phoneNumberId: null },
    )
    expect(result.durationSeconds).toBeNull()
  })
})
