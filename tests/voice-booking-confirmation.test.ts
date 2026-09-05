import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkVoiceBookingConfirmation, voiceMessages, type VoiceBookingContext } from '@/lib/vapi/booking-confirmation'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'

const args = { serviceIds: '333', bookingDate: '2026-09-08', startTime: '09:00', customerName: 'Test Caller', customerPhone: '+15555550100' }
const creds = { tenantBaseUrl: 'https://example.test', apiKey: 'test', organizationId: 'org-1' }
const initial: VoiceBookingContext = { callId: 'call-1', messages: [{ role: 'assistant', content: 'Nine or ten?' }, { role: 'user', content: 'nine' }, { role: 'assistant', content: 'Still Test Caller?' }, { role: 'user', content: 'yes' }] }
const consent: VoiceBookingContext = { ...initial, messages: [...initial.messages,
  { role: 'assistant', content: 'Haircut, Tuesday at nine, under Test Caller. Shall I request that appointment?' },
  { role: 'user', content: 'yes please' }] }
function proposal() {
  const result = checkVoiceBookingConfirmation(args, 'org-1', initial)
  if (result.allowed) throw new Error('unexpected write')
  return result.instruction.match(/confirmationToken: ([A-Za-z\d_.-]+)/)![1].replace(/\.$/, '')
}
beforeEach(() => { vi.stubEnv('ENCRYPTION_SECRET', 'ab'.repeat(32)); vi.mocked(xkeduleFetchJson).mockReset() })
describe('voice booking consent', () => {
  it('a call with confirmed:true but no token cannot write; it gets the read-back and a token', async () => {
    const result = await createXkeduleBooking({ ...args, confirmed: true }, creds, undefined,
      { callId: 'call-1', messages: [{ role: 'user', content: 'Monday' }] })
    expect(result).toContain('NOT BOOKED YET')
    expect(result).toContain('Anything else')
    expect(result).toContain('confirmationToken:')
    expect(xkeduleFetchJson).not.toHaveBeenCalled()
  })
  it('a first call with confirmed true cannot write', async () => {
    expect(await createXkeduleBooking({ ...args, confirmed: true }, creds, undefined, initial)).toContain('NOT BOOKED YET')
    expect(xkeduleFetchJson).not.toHaveBeenCalled()
  })
  it('cannot use the name confirmation or a same-turn token to write', () => {
    expect(checkVoiceBookingConfirmation({ ...args, confirmed: true, confirmationToken: proposal() }, 'org-1', initial).allowed).toBe(false)
  })
  it('only later explicit consent with unchanged details writes, and pending is not called confirmed', async () => {
    vi.mocked(xkeduleFetchJson).mockResolvedValue({ id: 42, status: 'pending' })
    const result = await createXkeduleBooking({ ...args, confirmed: true, confirmationToken: proposal() }, creds, undefined, consent)
    expect(xkeduleFetchJson).toHaveBeenCalledTimes(1)
    expect(result).toContain('awaiting the business approval')
    expect(result).not.toContain('Booking confirmed.')
  })
  it.each(['startTime', 'bookingDate', 'serviceIds', 'customerName', 'customerPhone', 'notes'])('changed %s requires new consent', (field) => {
    expect(checkVoiceBookingConfirmation({ ...args, [field]: 'changed', confirmed: true, confirmationToken: proposal() }, 'org-1', consent).allowed).toBe(false)
  })
  it('rejects cross-call, cross-org, tampered and expired proposals', () => {
    const p = { ...args, confirmed: true, confirmationToken: proposal() }
    expect(checkVoiceBookingConfirmation(p, 'org-2', consent).allowed).toBe(false)
    expect(checkVoiceBookingConfirmation(p, 'org-1', { ...consent, callId: 'call-2' }).allowed).toBe(false)
    expect(checkVoiceBookingConfirmation({ ...p, confirmationToken: p.confirmationToken + 'x' }, 'org-1', consent).allowed).toBe(false)
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    expect(checkVoiceBookingConfirmation(p, 'org-1', consent).allowed).toBe(false)
    spy.mockRestore()
  })
  it.each(['no', 'yes but make it ten', 'no that is it', 'maybe', 'cancel it'])('does not mistake %s for consent', (content) => {
    expect(checkVoiceBookingConfirmation({ ...args, confirmed: true, confirmationToken: proposal() }, 'org-1', {
      ...consent, messages: [...consent.messages.slice(0, -1), { role: 'user', content }],
    }).allowed).toBe(false)
  })
  it('missing artifact fails closed', () => {
    expect(voiceMessages(undefined)).toEqual([])
    expect(checkVoiceBookingConfirmation(args, 'org-1', { callId: 'call-1', messages: [] }).allowed).toBe(false)
  })
  it('accepts native and OpenAI Vapi conversation artifacts without treating tool outputs as consent', () => {
    expect(voiceMessages({ messages: [{ role: 'bot', message: 'Shall I request that appointment?' }, { role: 'user', message: 'yes' }, { role: 'tool', result: 'yes' }] })).toEqual(consent.messages.slice(-2).map((m) => ({ ...m, content: m.role === 'user' ? 'yes' : 'Shall I request that appointment?' })))
    expect(voiceMessages({ messagesOpenAIFormatted: consent.messages })).toEqual(consent.messages)
  })
})
