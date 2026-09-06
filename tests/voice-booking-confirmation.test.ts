import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkVoiceBookingConfirmation, CONFIRMATION_QUESTION, voiceMessages, type BookingOperation } from '@/lib/vapi/booking-confirmation'
import { callerChoseTime, clocksIn } from '@/lib/vapi/clock-choice'
import { clearMemo } from '@/lib/cache/ttl-memo'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'
import { cancelXkeduleBooking } from '@/lib/xkedule/actions/cancel-booking'
import { rescheduleXkeduleBooking } from '@/lib/xkedule/actions/reschedule-booking'

const args = { serviceIds: '333', bookingDate: '2026-09-08', startTime: '09:00', customerName: 'Test Caller', customerPhone: '+15555550100' }
const creds = { tenantBaseUrl: 'https://example.test', apiKey: 'mock', organizationId: 'org-1' }
const initial = { callId: 'call-1', messages: [{ role: 'assistant', content: 'Nine AM or ten AM?' }, { role: 'user', content: 'nine' }, { role: 'assistant', content: 'Still Test Caller?' }, { role: 'user', content: 'yes' }] }
const summary = 'I will request a haircut on Tuesday, September 8, 2026 at 9:00 AM, under Test Caller.'
const consent = { ...initial, messages: [...initial.messages, { role: 'assistant', content: `${summary} ${CONFIRMATION_QUESTION}` }, { role: 'user', content: "no, that's all" }] }
function check(p = args as Record<string, unknown>, ctx = initial, op: BookingOperation = 'create', text = summary, org = 'org-1') {
  return checkVoiceBookingConfirmation(p, org, ctx, op, text)
}
function token(result: ReturnType<typeof check>) {
  if (result.allowed) throw new Error('Unexpected authorization')
  return result.instruction.match(/confirmationToken: ([A-Za-z\d_.-]+)/)![1].replace(/\.$/, '')
}
beforeEach(() => { vi.stubEnv('ENCRYPTION_SECRET', 'ab'.repeat(32)); vi.mocked(xkeduleFetchJson).mockReset(); clearMemo() })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('server-bound voice consent', () => {
  it('first-call true never authorizes, and the token stays compact', () => {
    const r = check({ ...args, confirmed: true })
    expect(r.allowed).toBe(false)
    expect(token(r).length).toBeLessThan(55)
  })
  it('authorizes only the exact canonical read-back and the immediately following no', () => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, consent).allowed).toBe(true)
  })
  it.each(["nope that's all", "no that's all thank you", 'nothing else thanks'])('accepts an unambiguous no with politeness: %s', (content) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, { ...consent, messages: [...consent.messages.slice(0, -1), { role: 'user', content }] }).allowed).toBe(true)
  })
  it('allows an identical repeated read-back, but never a conflicting repetition', () => {
    const p = { ...args, confirmed: true, confirmationToken: token(check()) }
    const speech = `${summary} ${CONFIRMATION_QUESTION}`
    const ctx = { ...initial, messages: [...initial.messages, { role: 'assistant', content: speech }, { role: 'assistant', content: speech }, { role: 'user', content: 'no' }] }
    expect(check(p, ctx).allowed).toBe(true)
    ctx.messages[initial.messages.length].content = speech.replace('9:00', '10:00')
    expect(check(p, ctx).allowed).toBe(false)
  })
  it.each(['cancel', 'reschedule'] as const)('create consent cannot authorize %s even with identical arguments', (op) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, consent, op).allowed).toBe(false)
  })
  it.each(['startTime', 'bookingDate', 'serviceIds', 'customerName', 'customerPhone', 'notes'])('rejects changed %s', (field) => {
    expect(check({ ...args, [field]: 'changed', confirmed: true, confirmationToken: token(check()) }, consent).allowed).toBe(false)
  })
  it.each(['Anything else?', summary.replace('9:00', '10:00') + ' ' + CONFIRMATION_QUESTION, 'Do not proceed. ' + summary + ' ' + CONFIRMATION_QUESTION])('rejects missing, changed or contradicted summary: %s', (content) => {
    const ctx = { ...initial, messages: [...initial.messages, { role: 'assistant', content }, { role: 'user', content: 'no' }] }
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, ctx).allowed).toBe(false)
  })
  it.each(['yes', 'maybe', 'no but make it ten', 'cancel it', 'no actually change the day'])('rejects additions or ambiguous consent: %s', (content) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, { ...consent, messages: [...consent.messages.slice(0, -1), { role: 'user', content }] }).allowed).toBe(false)
  })
  it('rejects same turn, cross-call, cross-org, expired and tampered tokens', () => {
    const p = { ...args, confirmed: true, confirmationToken: token(check()) }
    expect(check(p, initial).allowed).toBe(false)
    expect(check(p, { ...consent, callId: 'other' }).allowed).toBe(false)
    expect(check(p, consent, 'create', summary, 'other').allowed).toBe(false)
    expect(check({ ...p, confirmationToken: p.confirmationToken + 'x' }, consent).allowed).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    expect(check(p, consent).allowed).toBe(false)
  })
  it('does not reuse consent after an intervening user turn', () => {
    const ctx = { ...consent, messages: [...consent.messages, { role: 'assistant', content: `${summary} ${CONFIRMATION_QUESTION}` }, { role: 'user', content: 'no' }] }
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, ctx).allowed).toBe(false)
  })
  it('fails closed without evidence; supports both Vapi transcript formats', () => {
    expect(check(args, { callId: 'call-1', messages: [] }).allowed).toBe(false)
    expect(voiceMessages({ messagesOpenAIFormatted: initial.messages })).toEqual(initial.messages)
    expect(voiceMessages({ messages: [{ role: 'bot', message: 'Nine AM?' }, { role: 'user', message: 'yes' }, { role: 'tool', result: 'no' }] })).toHaveLength(2)
  })
})

describe('chosen clock, not a mentioned clock', () => {
  it.each([
    ['09:00', 'Nine AM or ten AM?', 'ten', false],
    ['10:00', 'Nine AM or ten AM?', 'ten', true],
    ['10:00', 'Nine AM or ten AM?', 'the second one', true],
    ['09:00', 'Nine AM or ten AM?', 'the second one', false],
    ['13:00', 'One PM or two PM?', 'one am', false],
    ['13:00', 'One PM or two PM?', 'one', true],
    ['09:45', 'Nine AM or nine forty-five AM?', 'nine forty-five', true],
    ['09:00', 'Nine AM or nine forty-five AM?', 'nine forty-five', false],
    ['09:45', 'Nine forty-five AM?', 'quarter to ten am', true],
    ['10:30', 'Ten thirty AM?', 'half past ten am', true],
    ['09:00', 'Nine or ten?', 'nine', false],
    ['09:00', 'Nine AM or ten AM?', 'not nine', false],
    ['09:00', 'What day?', 'Monday', false],
  ])('%s after %s / %s -> %s', (time, offer, answer, expected) => {
    expect(callerChoseTime(time, [{ role: 'assistant', content: offer }, { role: 'user', content: answer }])).toBe(expected)
  })
  it('does not manufacture clock times from malformed input', () => {
    expect(callerChoseTime('25:99', initial.messages)).toBe(false)
    expect(clocksIn('I am good')).toEqual([])
  })
})

describe('provider boundary', () => {
  function setup() {
    vi.mocked(xkeduleFetchJson).mockImplementation(async (path) => {
      if (path === '/api/v1/quote') return { items: [{ serviceId: 333, serviceName: 'Signature Haircut' }], subtotal: '38', currency: 'USD' }
      if (path === '/api/v1/bookings/471') return { bookingDate: '2026-09-08', startTime: '10:30', items: [{ serviceId: 333, serviceName: 'Signature Haircut' }] }
      return { id: 999, status: 'pending' }
    })
  }
  function answered(instruction: string) {
    const speech = instruction.match(/numbers: "([\s\S]*?)" Then STOP/)![1]
    return { ...initial, messages: [...initial.messages, { role: 'assistant', content: speech }, { role: 'user', content: 'no' }] }
  }
  it('create uses the real canonical summary and returns pending, with exactly one provider write', async () => {
    setup()
    const prepared = await createXkeduleBooking(args, creds, undefined, initial)
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([path]) => path === '/api/v1/bookings')).toBe(false)
    const out = await createXkeduleBooking({ ...args, confirmed: true, confirmationToken: token({ allowed: false, instruction: prepared }) }, creds, undefined, answered(prepared))
    expect(out).toContain('awaiting the business approval')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.filter(([path]) => path === '/api/v1/bookings')).toHaveLength(1)
  })
  it('a reschedule token cannot execute cancellation even when all extra arguments are retained', async () => {
    setup()
    const p = { bookingId: 471, bookingDate: '2026-09-07', startTime: '09:00' }
    const prepared = await rescheduleXkeduleBooking(p, creds, initial)
    const out = await cancelXkeduleBooking({ ...p, confirmed: true, confirmationToken: token({ allowed: false, instruction: prepared }) }, creds, answered(prepared))
    expect(out).toContain('NOT CANCELLED YET')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false)
  })
})
