// The voice consent gate, after VOICE-CALL-4-PLAN item I: the server verifies
// that the customer HEARD the provider-verified facts and answered "no, that's
// all" in a later turn. The wording is the model's own — a receptionist does not
// read a canonical sentence aloud, and every paraphrase used to loop the call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CANCEL_QUESTION, CONFIRMATION_QUESTIONS, CREATE_QUESTION, RESCHEDULE_QUESTION,
  checkVoiceBookingConfirmation, voiceMessages, type BookingOperation, type VoiceBookingFacts,
} from '@/lib/vapi/booking-confirmation'
import { callerChoseTime, clocksIn, listedSlotsIn } from '@/lib/vapi/clock-choice'
import { clearMemo } from '@/lib/cache/ttl-memo'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'
import { cancelXkeduleBooking } from '@/lib/xkedule/actions/cancel-booking'
import { rescheduleXkeduleBooking } from '@/lib/xkedule/actions/reschedule-booking'

const args = { serviceIds: '333', bookingDate: '2026-09-08', startTime: '09:00', customerName: 'Test Caller', customerPhone: '+15555550100' }
const creds = { tenantBaseUrl: 'https://example.test', apiKey: 'mock', organizationId: 'org-1' }
// 2026-09-08 is a Tuesday; the quote is the provider's, not the model's.
const facts: VoiceBookingFacts = {
  services: ['Signature Haircut'], price: '38.00', currency: 'USD',
  date: '2026-09-08', time: '09:00', customerName: 'Test Caller',
}
const initial = { callId: 'call-1', messages: [{ role: 'assistant', content: 'Nine AM or ten AM?' }, { role: 'user', content: 'nine' }, { role: 'assistant', content: 'Still Test Caller?' }, { role: 'user', content: 'yes' }] }
/** A read-back a person would actually say — nothing about it is canonical. */
const readBack = `Perfect — a Signature Haircut for Test Caller, Tuesday, September 8th at nine, thirty-eight dollars. ${CREATE_QUESTION}`
const consent = { ...initial, messages: [...initial.messages, { role: 'assistant', content: readBack }, { role: 'user', content: "no, that's all" }] }
function check(p = args as Record<string, unknown>, ctx = initial, op: BookingOperation = 'create', f = facts, org = 'org-1') {
  return checkVoiceBookingConfirmation(p, org, ctx, op, f)
}
function token(result: ReturnType<typeof check>) {
  if (result.allowed) throw new Error('Unexpected authorization')
  return result.instruction.match(/confirmationToken: ([A-Za-z\d_.-]+)/)![1].replace(/\.$/, '')
}
function said(content: string, ctx = consent) {
  return { ...ctx, messages: [...initial.messages, { role: 'assistant', content }, { role: 'user', content: "no, that's all" }] }
}
function refusal(result: ReturnType<typeof check>) {
  if (result.allowed) throw new Error('Unexpected authorization')
  return result.instruction
}
beforeEach(() => { vi.stubEnv('ENCRYPTION_SECRET', 'ab'.repeat(32)); vi.mocked(xkeduleFetchJson).mockReset(); clearMemo() })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('server-bound voice consent', () => {
  it('first-call true never authorizes, and the token stays compact', () => {
    const r = check({ ...args, confirmed: true })
    expect(r.allowed).toBe(false)
    expect(token(r).length).toBeLessThan(55)
    expect(refusal(r)).toContain(CREATE_QUESTION)
  })
  it('gives the model the facts and the exact question, not a sentence to recite', () => {
    const instruction = refusal(check())
    expect(instruction).toContain('Signature Haircut')
    expect(instruction).toContain('38.00 USD')
    expect(instruction).toContain('Tuesday, September 8, 2026')
    expect(instruction).toContain('9:00 AM')
    expect(instruction).toContain('Test Caller')
    expect(instruction).toContain(`ask exactly "${CREATE_QUESTION}"`)
    expect(instruction).toMatch(/in your own words/i)
  })
  it('authorizes a read-back in the model\'s own words and the immediately following no', () => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, consent).allowed).toBe(true)
  })
  it.each([
    'That is a Signature Haircut, 38 dollars, Tuesday at 9:00 AM for Test Caller. Anything else you\'d like to add to that?',
    'Booking Test Caller a Signature Haircut on September 8th at nine forty... sorry, at 9 AM, for $38.00. Anything else?',
    'Signature Haircut with us on the 8th at nine in the morning, thirty eight dollars, under Test Caller — anything else you want to add?',
    'So: Test Caller, signature haircut, Tuesday 09:00, thirty-eight dollars. ANYTHING ELSE?',
  ])('accepts a paraphrase that carries every fact: %s', (content) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, said(content)).allowed).toBe(true)
  })
  it.each(["nope that's all", 'no that\'s all thank you', 'nothing else thanks', 'nothing', 'no', "that's it"])('accepts an unambiguous no: %s', (content) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, { ...consent, messages: [...consent.messages.slice(0, -1), { role: 'user', content }] }).allowed).toBe(true)
  })
  it('allows an identical repeated read-back', () => {
    const p = { ...args, confirmed: true, confirmationToken: token(check()) }
    const ctx = { ...initial, messages: [...initial.messages, { role: 'assistant', content: readBack }, { role: 'assistant', content: readBack }, { role: 'user', content: 'no' }] }
    expect(check(p, ctx).allowed).toBe(true)
  })
  it.each([
    ['the price', 'A Signature Haircut for Test Caller on Tuesday at nine. Anything else?'],
    ["the customer's name", 'A Signature Haircut on Tuesday at nine, thirty-eight dollars. Anything else?'],
    ['the service', 'That is booked for Test Caller Tuesday at nine, thirty-eight dollars. Anything else?'],
    ['the day', 'A Signature Haircut for Test Caller at nine, thirty-eight dollars. Anything else?'],
    ['the time', 'A Signature Haircut for Test Caller on Tuesday, thirty-eight dollars. Anything else?'],
    ['the question', 'A Signature Haircut for Test Caller on Tuesday at nine, thirty-eight dollars. Shall I book it?'],
  ])('refuses a read-back missing %s and says which fact was missed', (fact, content) => {
    const instruction = refusal(check({ ...args, confirmed: true, confirmationToken: token(check()) }, said(content)))
    expect(instruction).toContain('The customer never heard')
    expect(instruction).toContain(fact)
    expect(instruction).toContain('confirmationToken:') // a fresh token, so the call can recover
  })
  it('refuses a read-back that changed a fact', () => {
    const changed = `Perfect — a Signature Haircut for Test Caller, Wednesday, September 9th at ten, thirty-eight dollars. ${CREATE_QUESTION}`
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, said(changed)).allowed).toBe(false)
  })
  it.each(['cancel', 'reschedule'] as const)('create consent cannot authorize %s even with identical arguments', (op) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, consent, op).allowed).toBe(false)
  })
  it.each(['startTime', 'bookingDate', 'serviceIds', 'customerName', 'customerPhone', 'notes'])('rejects changed %s', (field) => {
    expect(check({ ...args, [field]: 'changed', confirmed: true, confirmationToken: token(check()) }, consent).allowed).toBe(false)
  })
  it('rejects a token minted for different facts', () => {
    const stale = token(check(args, initial, 'create', { ...facts, price: '25.00' }))
    expect(check({ ...args, confirmed: true, confirmationToken: stale }, consent).allowed).toBe(false)
  })
  it.each(['yes', 'maybe', 'no but make it ten', 'cancel it', 'no actually change the day'])('rejects additions or ambiguous consent: %s', (content) => {
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, { ...consent, messages: [...consent.messages.slice(0, -1), { role: 'user', content }] }).allowed).toBe(false)
  })
  it('rejects same turn, cross-call, cross-org, expired and tampered tokens', () => {
    const p = { ...args, confirmed: true, confirmationToken: token(check()) }
    expect(check(p, initial).allowed).toBe(false)
    expect(check(p, { ...consent, callId: 'other' }).allowed).toBe(false)
    expect(check(p, consent, 'create', facts, 'other').allowed).toBe(false)
    expect(check({ ...p, confirmationToken: p.confirmationToken + 'x' }, consent).allowed).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    expect(check(p, consent).allowed).toBe(false)
  })
  it('does not reuse consent after an intervening user turn', () => {
    const ctx = { ...consent, messages: [...consent.messages, { role: 'assistant', content: readBack }, { role: 'user', content: 'no' }] }
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, ctx).allowed).toBe(false)
  })
  it('fails closed without evidence, and without verifiable facts', () => {
    expect(check(args, { callId: 'call-1', messages: [] }).allowed).toBe(false)
    expect(refusal(check(args, initial, 'create', { ...facts, services: [] }))).toContain('could not be verified')
    expect(refusal(check(args, initial, 'cancel', { ...facts, existing: undefined }))).toContain('could not be verified')
  })
  it('carries tool results through both Vapi artifact formats, without letting them speak', () => {
    expect(voiceMessages({ messagesOpenAIFormatted: initial.messages })).toEqual(initial.messages)
    const native = voiceMessages({ messages: [
      { role: 'bot', message: 'Nine AM?' }, { role: 'user', message: 'yes' },
      { role: 'tool_call_result', name: 'check_availability', result: 'Available slots on 2026-09-08: 09:00' },
    ] })
    expect(native).toEqual([
      { role: 'assistant', content: 'Nine AM?' }, { role: 'user', content: 'yes' },
      { role: 'tool', content: 'Available slots on 2026-09-08: 09:00' },
    ])
    const openai = voiceMessages({ messagesOpenAIFormatted: [
      { role: 'assistant', content: 'Nine AM?' }, { role: 'user', content: 'yes' },
      { role: 'tool', content: 'Available slots on 2026-09-08: 09:00', tool_call_id: 'x' },
    ] })
    expect(openai.filter((m) => m.role === 'tool')).toHaveLength(1)
    // A tool result is never a read-back and never a consent answer.
    const ctx = { ...initial, messages: [...initial.messages, { role: 'assistant', content: readBack }, { role: 'tool', content: 'Available slots on 2026-09-08: 09:00' }, { role: 'user', content: 'no' }] }
    expect(check({ ...args, confirmed: true, confirmationToken: token(check()) }, ctx).allowed).toBe(true)
  })
  it('exports one question per operation', () => {
    expect(CONFIRMATION_QUESTIONS).toEqual({ create: CREATE_QUESTION, reschedule: RESCHEDULE_QUESTION, cancel: CANCEL_QUESTION })
    expect([CREATE_QUESTION, RESCHEDULE_QUESTION, CANCEL_QUESTION]).toEqual([
      "Anything else you'd like to add to that?", "Anything else you'd like to change?", 'Anything else?'])
  })
})

describe('chosen clock, not a mentioned clock', () => {
  const offer = 'For next Saturday I can do nine, 09:45, or 10:30.'
  it.each([
    // The call-4 spellings: Deepgram writes digital times with a leading zero.
    ['09:45', offer, '09:45', true],
    ['09:45', offer, '9:45', true],
    ['09:45', offer, '945', true],
    ['09:45', offer, '9 45', true],
    ['09:45', offer, 'nine forty five', true],
    ['09:45', offer, 'nine forty-five', true],
    ['09:45', offer, 'I said 09:45', true],
    ['09:45', offer, 'the second one', true],
    ['10:30', offer, 'the last one', true],
    ['09:00', offer, 'the second one', false],
    ['09:45', 'Nine forty-five AM?', 'quarter to ten am', true],
    ['10:30', 'Ten thirty AM?', 'half past ten am', true],
    ['09:05', 'Nine oh five AM?', 'nine oh five', true],
    ['09:00', 'Nine AM or ten AM?', "nine o'clock", true],
    ['09:00', 'Nine AM or ten AM?', 'nine in the morning', true],
    ['10:00', 'Nine AM or ten AM?', 'ten', true],
    ['09:00', 'Nine AM or ten AM?', 'ten', false],
    ['10:00', 'Nine AM or ten AM?', 'the second one', true],
    ['13:00', 'One PM or two PM?', 'one am', false],
    ['13:00', 'One PM or two PM?', 'one', true],
    ['09:00', 'Nine or ten?', 'nine', false],
    ['09:00', 'Nine AM or ten AM?', 'not nine', false],
    ['10:00', 'Nine AM or ten AM?', 'no, ten', true],
    ['09:00', 'Nine AM or ten AM?', 'no, ten', false],
    ['09:00', 'Nine AM or ten AM?', 'nine or ten', false],
    ['09:00', 'What day?', 'Monday', false],
  ])('%s after "%s" / "%s" -> %s', (time, previous, answer, expected) => {
    expect(callerChoseTime(time, [{ role: 'assistant', content: previous }, { role: 'user', content: answer }])).toBe(expected)
  })

  it.each([
    ['09:00', 'nine', ['09:00', '09:45', '10:30'], true],
    ['09:00', 'nine', ['09:00', '21:00'], false],
    ['21:00', 'nine', ['09:00', '21:00'], false],
    ['21:00', 'nine PM', ['09:00', '21:00'], true],
    ['13:00', 'one', ['13:00'], true],
    ['13:00', 'one', [], false],
    ['09:45', 'nine forty five', ['09:00', '09:45'], true],
  ])('%s said as "%s" against listed slots %j -> %s', (time, answer, slots, expected) => {
    const messages = [{ role: 'assistant', content: 'What time works?' }, { role: 'user', content: answer }]
    expect(callerChoseTime(time, messages, slots)).toBe(expected)
  })

  it('takes the slot list from the availability tool results in the call', () => {
    const messages = [
      { role: 'tool', content: 'Available slots on 2026-09-12: 09:00, 09:45, 10:30' },
      { role: 'assistant', content: 'Nine, nine forty-five or ten thirty?' },
      { role: 'user', content: '09:45' },
    ]
    expect(listedSlotsIn(messages)).toEqual(['09:00', '09:45', '10:30'])
    expect(callerChoseTime('09:45', messages)).toBe(true)
  })
  it.each([
    ['old digital list', 'Available slots on 2026-09-12: 09:00, 09:45, 10:30', ['09:00', '09:45', '10:30']],
    ['spoken list', 'Available times on 2026-09-12: 9:00 AM, 9:45 AM, 10:30 AM', ['09:00', '09:45', '10:30']],
    ['afternoon spoken list', 'Available times on 2026-09-12: 12:00 PM, 1:30 PM and 5:15 PM', ['12:00', '13:30', '17:15']],
    ['range result', 'Next openings from 2026-09-12:\n2026-09-12 (Saturday): 9:00 AM, 10:30 AM\n2026-09-14 (Monday): 2:15 PM (+3 more)', ['09:00', '10:30', '14:15']],
    ['older range result', 'Next available: 2026-09-12 at 9:00 AM.\n2026-09-12: 09:00, 10:30\n2026-09-14: 14:15 (+3 more)', ['09:00', '10:30', '14:15']],
    ['with staff', 'Available slots on 2026-09-12 (with who can take them):\n09:00 — Nina Alvarez\n15:45 — Tony Alvarez', ['09:00', '15:45']],
  ])('parses the %s slot format', (_name, content, expected) => {
    expect(listedSlotsIn([{ role: 'tool', content }])).toEqual(expected)
  })
  it('does not manufacture clock times from malformed input', () => {
    expect(callerChoseTime('25:99', initial.messages)).toBe(false)
    expect(clocksIn('I am good')).toEqual([])
    expect(clocksIn('Signature Haircut, $38.00, on 2026-09-12')).toEqual([])
    expect(clocksIn('call me on +15088018190')).toEqual([])
    // Only a tool result lists slots; an assistant claim is not evidence.
    expect(listedSlotsIn([{ role: 'assistant', content: 'Available slots on 2026-09-12: 09:00' }])).toEqual([])
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
  function answered(content: string) {
    return { ...initial, messages: [...initial.messages, { role: 'assistant', content }, { role: 'user', content: 'no' }] }
  }
  it('create uses the provider facts and returns pending, with exactly one provider write', async () => {
    setup()
    const prepared = await createXkeduleBooking(args, creds, undefined, initial)
    expect(prepared).toContain('Signature Haircut')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([path]) => path === '/api/v1/bookings')).toBe(false)
    const out = await createXkeduleBooking(
      { ...args, confirmed: true, confirmationToken: token({ allowed: false, instruction: prepared }) }, creds, undefined,
      answered(`A Signature Haircut for Test Caller on Tuesday, September 8th at 9:00 AM, thirty-eight dollars. ${CREATE_QUESTION}`))
    expect(out).toContain('awaiting the business approval')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.filter(([path]) => path === '/api/v1/bookings')).toHaveLength(1)
  })
  it('a reschedule token cannot execute cancellation even when all extra arguments are retained', async () => {
    setup()
    const p = { bookingId: 471, bookingDate: '2026-09-07', startTime: '09:00' }
    const prepared = await rescheduleXkeduleBooking(p, creds, initial)
    expect(prepared).toContain(RESCHEDULE_QUESTION)
    const out = await cancelXkeduleBooking(
      { ...p, confirmed: true, confirmationToken: token({ allowed: false, instruction: prepared }) }, creds,
      answered(`Moving your Signature Haircut from Tuesday, September 8th at 10:30 AM to Monday, September 7th at 9:00 AM. ${RESCHEDULE_QUESTION}`))
    expect(out).toContain('NOT CANCELLED YET')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false)
  })
  it('reschedule needs both the old and the new appointment in the read-back', async () => {
    setup()
    const p = { bookingId: 471, bookingDate: '2026-09-07', startTime: '09:00' }
    const prepared = await rescheduleXkeduleBooking(p, creds, initial)
    const confirm = { ...p, confirmed: true, confirmationToken: token({ allowed: false, instruction: prepared }) }
    const partial = await rescheduleXkeduleBooking(confirm, creds,
      answered(`I will move you to Monday, September 7th at 9:00 AM. ${RESCHEDULE_QUESTION}`))
    expect(partial).toContain('The customer never heard')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.some(([path]) => path.endsWith('/reschedule'))).toBe(false)
    const out = await rescheduleXkeduleBooking(confirm, creds,
      answered(`Moving your Signature Haircut from Tuesday, September 8th at 10:30 AM to Monday, September 7th at 9:00 AM. ${RESCHEDULE_QUESTION}`))
    expect(vi.mocked(xkeduleFetchJson).mock.calls.filter(([path]) => path.endsWith('/reschedule'))).toHaveLength(1)
    expect(out).toContain('rescheduled')
  })
  it('cancel reads back the existing appointment and asks its own question', async () => {
    setup()
    const prepared = await cancelXkeduleBooking({ bookingId: 471 }, creds, initial)
    expect(prepared).toContain(CANCEL_QUESTION)
    expect(prepared).toContain('Tuesday, September 8, 2026')
    const out = await cancelXkeduleBooking(
      { bookingId: 471, confirmed: true, confirmationToken: token({ allowed: false, instruction: prepared }) }, creds,
      answered(`I will cancel your Signature Haircut on Tuesday, September 8th at 10:30 AM. ${CANCEL_QUESTION}`))
    expect(out).toContain('999')
    expect(vi.mocked(xkeduleFetchJson).mock.calls.filter(([path]) => path.endsWith('/cancel'))).toHaveLength(1)
  })
})
