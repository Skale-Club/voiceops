// Call 6 (2026-09-06) reached the correct read-back, but the real reply
// "No. All set." was rejected. A later complaint containing "just 1" then
// replaced the caller's original 5 PM choice with 1 PM. Replay the real
// artifact through the same message adapter and consent guard as production.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  checkVoiceBookingConfirmation,
  voiceMessages,
  type VoiceBookingFacts,
} from '@/lib/vapi/booking-confirmation'
import { callerChoseTime, listedSlotsIn } from '@/lib/vapi/clock-choice'

interface ArtifactMessage {
  role: string
  message?: string
  content?: string
  time?: number
  toolCalls?: Array<{ function: { name: string; arguments: string } }>
}
interface CallFixture {
  id: string
  customer: { number: string }
  messages?: ArtifactMessage[]
  artifact?: { messages: ArtifactMessage[] }
}

const call = JSON.parse(readFileSync(
  'tests/fixtures/calls/01a0773f-c173-7000-897b-d8842721cd5b.json',
  'utf8',
)) as CallFixture
const artifact = call.messages ?? call.artifact?.messages ?? []
const start = artifact[0]?.time ?? 0
const attempts = artifact.flatMap((message, index) => (message.toolCalls ?? [])
  .filter((toolCall) => toolCall.function.name === 'book_appointment')
  .map((toolCall) => ({
    index,
    at: Math.round(((message.time ?? start) - start) / 1000),
    args: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
  })))

const facts: VoiceBookingFacts = {
  services: ['Cut & Beard Combo'],
  price: '55.00',
  currency: 'USD',
  date: '2026-09-08',
  time: '17:00',
  staffName: 'Tony Alvarez',
  customerName: 'Vanildo Teste',
}

function contextAt(index: number) {
  return { callId: call.id, messages: voiceMessages({ messages: artifact.slice(0, index) }) }
}

function bound(args: Record<string, unknown>) {
  // The tools route replaces the model's empty phone with the verified inbound
  // caller number before the confirmation guard and executor receive it.
  return { ...args, customerPhone: call.customer.number }
}

function tokenOf(result: ReturnType<typeof checkVoiceBookingConfirmation>) {
  if (result.allowed) throw new Error('Expected preparation, not authorization')
  const token = result.instruction.match(/confirmationToken: ([A-Za-z\d_.-]+)/)?.[1]?.replace(/\.$/, '')
  if (!token) throw new Error('Preparation did not issue a token')
  return token
}

beforeEach(() => vi.stubEnv('ENCRYPTION_SECRET', 'ab'.repeat(32)))
afterEach(() => vi.unstubAllEnvs())

describe('call 6 replay (2026-09-06)', () => {
  it('captures the four production attempts and the caller\'s original choice', () => {
    expect(attempts.map((attempt) => attempt.at)).toEqual([127, 152, 179, 205])
    const messages = contextAt(attempts.at(-1)!.index).messages
    const slots = listedSlotsIn(messages)
    expect(slots).toContain('17:00')
    expect(callerChoseTime('17:00', messages, slots)).toBe(true)
    expect(callerChoseTime('13:00', messages, slots)).toBe(false)
  })

  it('accepts "No. All set." after one complete read-back', () => {
    const prepare = attempts[0]
    const confirmation = attempts[1]
    const prepared = checkVoiceBookingConfirmation(
      bound(prepare.args), 'org-1', contextAt(prepare.index), 'create', facts,
    )
    const token = tokenOf(prepared)
    const confirmed = checkVoiceBookingConfirmation(
      { ...bound(confirmation.args), confirmed: true, confirmationToken: token },
      'org-1', contextAt(confirmation.index), 'create', facts,
    )
    expect(confirmed).toEqual({ allowed: true })
  })
})
