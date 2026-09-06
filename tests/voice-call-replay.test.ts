// Every real call becomes a fixture (VOICE-CALL-4-PLAN item L). The artifact is
// replayed through the same voiceMessages() + guard the tools route runs, so a
// call that looped in production can never loop again silently.
//
// Call 4 (2026-09-05): the caller said "09:45" three times — Deepgram's spelling
// of the slot the bot had just offered — and the server answered "Nobody has
// said 09:45 out loud" three times. The customer hung up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkVoiceBookingConfirmation, voiceMessages, type VoiceBookingFacts } from '@/lib/vapi/booking-confirmation'
import { listedSlotsIn } from '@/lib/vapi/clock-choice'

interface ArtifactMessage {
  role: string
  message?: string
  content?: string
  time?: number
  secondsFromStart?: number
  name?: string
  result?: string
  toolCalls?: Array<{ function: { name: string; arguments: string } }>
}
interface CallFixture { id: string; messages?: ArtifactMessage[]; artifact?: { messages: ArtifactMessage[] } }

// tests/fixtures/calls/README.md: a fixture is one real call, messages only.
const call = JSON.parse(readFileSync('tests/fixtures/calls/call-4-2026-09-05.json', 'utf8')) as CallFixture
const artifact = call.messages ?? call.artifact?.messages ?? []
const start = artifact[0].time ?? 0
/** The prepare calls the model made, in order: 173s and 187s of the recording. */
const prepares = artifact.flatMap((m, index) => (m.toolCalls ?? [])
  .filter((tc) => tc.function.name === 'book_appointment')
  .map((tc) => ({ index, at: Math.round(((m.time ?? 0) - start) / 1000), args: JSON.parse(tc.function.arguments) as Record<string, unknown> })))

/** What the tools route sends the guard: everything the artifact holds up to this tool call. */
function contextAt(index: number) {
  return { callId: call.id, messages: voiceMessages({ messages: artifact.slice(0, index) }) }
}
// Provider facts for this booking, as buildVoiceBookingSummary resolves them
// (quote 38.00 USD for service 333, the known customer from the lookup).
const facts: VoiceBookingFacts = {
  services: ['Signature Haircut'], price: '38.00', currency: 'USD',
  date: '2026-09-12', time: '09:45', customerName: 'Vanildo Teste',
}
function guard(index: number, args: Record<string, unknown>) {
  return checkVoiceBookingConfirmation(args, 'org-1', contextAt(index), 'create', facts)
}
function tokenOf(result: ReturnType<typeof guard>) {
  if (result.allowed) throw new Error('Unexpected authorization')
  return result.instruction.match(/confirmationToken: ([A-Za-z\d_.-]+)/)![1].replace(/\.$/, '')
}

beforeEach(() => vi.stubEnv('ENCRYPTION_SECRET', 'ab'.repeat(32)))
afterEach(() => vi.unstubAllEnvs())

describe('call 4 replay (2026-09-05)', () => {
  it('reads the artifact the way the tools route does', () => {
    const messages = voiceMessages({ messages: artifact })
    expect(messages.filter((m) => m.role === 'tool').length).toBeGreaterThan(0)
    expect(messages.some((m) => m.role === 'user' && m.content === '09:45.')).toBe(true)
    expect(messages.some((m) => m.role === 'assistant' && m.content.includes('nine, 09:45, or 10:30'))).toBe(true)
    // The availability results are what disambiguates "09:45" and "nine".
    expect(listedSlotsIn(messages)).toContain('09:45')
    expect(listedSlotsIn(messages)).toContain('09:00')
  })

  it('accepts the caller\'s 09:45 at both prepares and issues a token', () => {
    expect(prepares.map((p) => p.at)).toEqual([173, 187])
    for (const prepare of prepares) {
      const result = guard(prepare.index, prepare.args)
      expect(result.allowed).toBe(false)
      if (result.allowed) return
      expect(result.instruction).not.toMatch(/not the one the customer said|ambiguous/i)
      expect(result.instruction).toContain('NOT BOOKED YET.')
      expect(result.instruction).toContain('9:45 AM')
      expect(result.instruction).toContain("Anything else you'd like to add to that?")
      expect(tokenOf(result).split('.')).toHaveLength(3)
    }
  })

  it('refuses a confirm that arrives in the same turn as its token', () => {
    const prepare = prepares[0]
    const token = tokenOf(guard(prepare.index, prepare.args))
    const confirmed = guard(prepare.index, { ...prepare.args, confirmed: true, confirmationToken: token })
    expect(confirmed.allowed).toBe(false)
    // No read-back was spoken and no new customer turn happened: prepare again.
    if (!confirmed.allowed) expect(confirmed.instruction).toContain('confirmationToken:')
  })
})
