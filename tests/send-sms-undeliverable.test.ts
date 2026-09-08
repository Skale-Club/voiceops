// tests/send-sms-undeliverable.test.ts
//
// sendSms must separate "this destination can never receive an SMS" (a
// permanent Twilio rejection → SmsUndeliverableError, so the action engine
// can skip instead of failing the run) from "Twilio is unhappy right now"
// (plain Error, keeps failing the run so it is retried and alerted on).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(async () => JSON.stringify({ account_sid: 'ACxxx', auth_token: 'tok' })),
}))

import {
  sendSms,
  classifyTwilioRejection,
  SmsUndeliverableError,
  TWILIO_ACCOUNT_PROBLEM_PREFIX,
} from '@/lib/twilio/send-sms'

interface Integration {
  id: string
  encrypted_api_key: string
  health_status: string | null
  last_error: string | null
}

function makeSupabase(integration: Integration) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const results: Record<string, { data: unknown; error: unknown }> = {
    integrations: { data: integration, error: null },
    twilio_phone_numbers: { data: { e164: '+15550001111', capability_sms: true }, error: null },
  }
  const from = vi.fn((table: string) => {
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => results[table] ?? { data: null, error: null }
        }
        if (prop === 'update') {
          return (payload: Record<string, unknown>) => {
            updates.push({ table, payload })
            return new Proxy({}, handler)
          }
        }
        return () => new Proxy({}, handler)
      },
    }
    return new Proxy({}, handler)
  })
  return { supabase: { from }, updates }
}

const HEALTHY: Integration = { id: 'int-1', encrypted_api_key: 'enc', health_status: 'connected', last_error: null }

function twilioResponse(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response
}

describe('sendSms: permanent Twilio rejections become SmsUndeliverableError', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a value that cannot be an E.164 number before calling Twilio', async () => {
    const { supabase } = makeSupabase(HEALTHY)
    const err = await sendSms({ to: '{{contact.phone}}', body: 'hi' }, { organizationId: 'org-1', supabase } as never).catch((e) => e)
    expect(err).toBeInstanceOf(SmsUndeliverableError)
    expect((err as SmsUndeliverableError).kind).toBe('invalid_number')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('21211 (invalid To) → invalid_number, not an account problem', async () => {
    const { supabase } = makeSupabase(HEALTHY)
    fetchMock.mockResolvedValueOnce(
      twilioResponse(400, {
        code: 21211,
        message: "Invalid 'To' Phone Number: +1144392XXXX",
        more_info: 'https://www.twilio.com/docs/errors/21211',
        status: 400,
      }),
    )
    const err = await sendSms({ to: '+11443926128', body: 'hi' }, { organizationId: 'org-1', supabase } as never).catch((e) => e)
    expect(err).toBeInstanceOf(SmsUndeliverableError)
    const u = err as SmsUndeliverableError
    expect(u.kind).toBe('invalid_number')
    expect(u.twilioCode).toBe(21211)
    expect(u.accountConfig).toBe(false)
    expect(u.to).toBe('+11443926128')
    // The message masks the number the same way Twilio does, and stays on one line.
    expect(u.message).toContain('+1144392XXXX')
    expect(u.message).not.toContain('\n')
  })

  it('21408 (region not enabled) → region_not_enabled flagged as an ACCOUNT problem with a console hint', async () => {
    const { supabase } = makeSupabase(HEALTHY)
    fetchMock.mockResolvedValueOnce(
      twilioResponse(400, {
        code: 21408,
        message: "Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +551195348XXXX",
        status: 400,
      }),
    )
    const err = await sendSms({ to: '+5511953482575', body: 'hi' }, { organizationId: 'org-1', supabase } as never).catch((e) => e)
    expect(err).toBeInstanceOf(SmsUndeliverableError)
    const u = err as SmsUndeliverableError
    expect(u.kind).toBe('region_not_enabled')
    expect(u.accountConfig).toBe(true)
    expect(u.hint).toMatch(/Geo permissions/i)
  })

  it('a non-destination Twilio failure (5xx) still throws a plain Error so the run fails and retries', async () => {
    const { supabase } = makeSupabase(HEALTHY)
    fetchMock.mockResolvedValueOnce(twilioResponse(503, { code: 20503, message: 'Service unavailable', status: 503 }))
    const err = await sendSms({ to: '+14155552671', body: 'hi' }, { organizationId: 'org-1', supabase } as never).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(SmsUndeliverableError)
    expect((err as Error).message).toBe('Twilio error 503: {"code":20503,"message":"Service unavailable","status":503}')
  })

  it('an auth failure (401 / 20003) is not classified as undeliverable', () => {
    expect(classifyTwilioRejection(401, JSON.stringify({ code: 20003, message: 'Authenticate' }), '+14155552671')).toBeNull()
    expect(classifyTwilioRejection(400, 'not json', '+14155552671')).toBeNull()
  })

  it('success returns the single-line SID result and leaves a healthy integration alone', async () => {
    const { supabase, updates } = makeSupabase(HEALTHY)
    fetchMock.mockResolvedValueOnce(twilioResponse(201, { sid: 'SM123' }))
    const result = await sendSms({ to: '+14155552671', body: 'hi' }, { organizationId: 'org-1', supabase } as never)
    expect(result).toBe('SMS sent. SID: SM123')
    await Promise.resolve()
    expect(updates).toEqual([])
  })

  it('success clears a `degraded` mark that a previous account problem left on the integration', async () => {
    const { supabase, updates } = makeSupabase({
      ...HEALTHY,
      health_status: 'degraded',
      last_error: `${TWILIO_ACCOUNT_PROBLEM_PREFIX} SMS not sent: ... (Twilio 21408).`,
    })
    fetchMock.mockResolvedValueOnce(twilioResponse(201, { sid: 'SM124' }))
    await sendSms({ to: '+14155552671', body: 'hi' }, { organizationId: 'org-1', supabase } as never)
    await Promise.resolve()
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('integrations')
    expect(updates[0].payload).toMatchObject({ health_status: 'connected', last_error: null })
  })

  it('success does NOT clear a `degraded` mark owned by another check', async () => {
    const { supabase, updates } = makeSupabase({
      ...HEALTHY,
      health_status: 'degraded',
      last_error: 'Webhook registration failed',
    })
    fetchMock.mockResolvedValueOnce(twilioResponse(201, { sid: 'SM125' }))
    await sendSms({ to: '+14155552671', body: 'hi' }, { organizationId: 'org-1', supabase } as never)
    await Promise.resolve()
    expect(updates).toEqual([])
  })
})
