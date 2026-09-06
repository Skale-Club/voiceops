import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { callerChoseTime } from '@/lib/vapi/clock-choice'

export type BookingOperation = 'create' | 'reschedule' | 'cancel'
/** Context comes only from the verified ingress, never from model arguments. */
export interface VoiceBookingContext {
  callId: string
  messages: Array<{ role: string; content: string }>
}
export const CONFIRMATION_QUESTION = "Anything else you'd like to change?"
const MAX_AGE_MS = 10 * 60_000

export function voiceMessages(artifact: unknown): VoiceBookingContext['messages'] {
  if (!artifact || typeof artifact !== 'object') return []
  const a = artifact as Record<string, unknown>
  const raw = Array.isArray(a.messagesOpenAIFormatted) && a.messagesOpenAIFormatted.length ? a.messagesOpenAIFormatted : a.messages
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const role = m.role === 'bot' ? 'assistant' : m.role
    const content = m.content ?? m.message
    return (role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()
      ? [{ role, content: content.trim() }] : []
  })
}

/** Ignore punctuation/case, not words, numbers, negations or extra statements. */
export function normalizeReadBack(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\ba\.\s*m\./g, 'am').replace(/\bp\.\s*m\./g, 'pm')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function tokenMac(operation: BookingOperation, org: string, call: string, params: Record<string, unknown>, summary: string, nonce: string): string {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw new Error('Booking confirmation signing unavailable')
  const entries = Object.entries(params).filter(([k]) => !['confirmed', 'confirmationToken'].includes(k)).sort(([a], [b]) => a.localeCompare(b))
  const hash = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  // v2 invalidates old tokens. The operation is chosen by the executor, never inferred from params.
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify(['voice-booking-v2', operation, org, call, hash, normalizeReadBack(summary), nonce]))
    .digest('base64url').slice(0, 27)
}

export function checkVoiceBookingConfirmation(
  params: Record<string, unknown>, orgId: string, ctx: VoiceBookingContext,
  operation: BookingOperation, summary: string,
): { allowed: true } | { allowed: false; instruction: string } {
  const prefix = operation === 'cancel' ? 'NOT CANCELLED YET.' : operation === 'reschedule' ? 'NOT MOVED YET.' : 'NOT BOOKED YET.'
  const users = ctx.messages.flatMap((m, index) => m.role === 'user' ? [index] : [])
  if (!orgId || !ctx.callId || !users.length || !summary.trim()) return { allowed: false,
    instruction: `${prefix} Conversation or appointment details could not be verified. Explain nothing was changed and offer to take a message.` }
  const token = typeof params.confirmationToken === 'string' ? params.confirmationToken : ''
  const [turnPart, atPart, mac, extra] = token.split('.')
  const turn = Number(turnPart)
  const at = parseInt(atPart, 36)
  const validShape = /^\d+$/.test(turnPart ?? '') && /^[a-z\d]+$/.test(atPart ?? '') && Boolean(mac) && !extra
  // Evaluate the choice before the proposal: later read-back/consent must not become a new choice.
  const choiceHistory = validShape && turn > 0 && turn <= users.length ? ctx.messages.slice(0, users[turn - 1] + 1) : ctx.messages
  if (operation !== 'cancel' && !callerChoseTime(String(params.startTime ?? ''), choiceHistory)) return { allowed: false,
    instruction: `${prefix} The chosen time is ambiguous or does not match the caller's choice. Ask the customer to say their chosen exact time including AM or PM, then prepare again. Never pick a time for them.` }
  const spoken = `${summary} ${CONFIRMATION_QUESTION}`
  if (validShape && turn > 0 && Number.isInteger(turn) && Number.isFinite(at)) {
    const expected = Buffer.from(tokenMac(operation, orgId, ctx.callId, params, spoken, `${turnPart}.${atPart}`))
    const received = Buffer.from(mac)
    if (expected.length === received.length && timingSafeEqual(expected, received)
      && users.length === turn + 1 && Date.now() >= at && Date.now() - at <= MAX_AGE_MS) {
      const between = ctx.messages.slice(users[turn - 1] + 1, users[turn])
      const readBack = between.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ')
      const answer = normalizeReadBack(ctx.messages[users[turn]].content)
        .replace(/^nope(?= )/, 'no').replace(/ (?:thanks|thank you)$/, '')
      const nothingElse = /^(no|nope|no thanks|no thank you|nothing else|no that s it|no that s all|no that is it|no that is all|that s it|that s all|that is it|that is all|no i m good)$/.test(answer)
      const canonical = normalizeReadBack(spoken)
      // A rejected premature tool attempt may make the model repeat the SAME
      // read-back before the caller answers. Repetition preserves its meaning;
      // any differing word, number or extra statement still fails closed.
      const chunks = normalizeReadBack(readBack).split(canonical)
      const exactReadBack = chunks.length > 1 && chunks.every((chunk) => !chunk.trim())
      if (params.confirmed === true && nothingElse && exactReadBack) return { allowed: true }
    }
  }
  const nonce = `${users.length}.${Date.now().toString(36)}`
  return { allowed: false, instruction: `${prefix} Say EXACTLY the following, without adding or omitting words or numbers: "${spoken}" Then STOP and wait for a NEW customer reply. Only no / that's all authorizes this operation. A yes means they want a change. Copy the same arguments with confirmed:true and confirmationToken: ${nonce}.${tokenMac(operation, orgId, ctx.callId, params, spoken, nonce)}. Never speak the token. A changed detail requires a new preparation.` }
}
