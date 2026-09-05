import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Supplied by the verified Vapi envelope, never by tool arguments. */
export interface VoiceBookingContext {
  callId: string
  messages: Array<{ role: string; content: string }>
}

const MAX_AGE_MS = 10 * 60_000

export function voiceMessages(artifact: unknown): VoiceBookingContext['messages'] {
  if (!artifact || typeof artifact !== 'object') return []
  const a = artifact as Record<string, unknown>
  const raw = Array.isArray(a.messagesOpenAIFormatted) ? a.messagesOpenAIFormatted : a.messages
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const role = m.role === 'bot' ? 'assistant' : m.role
    const content = m.content ?? m.message
    return (role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()
      ? [{ role, content: content.trim() }] : []
  })
}

function signature(payload: string): string {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw new Error('Booking confirmation signing unavailable')
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(`voice-booking-v1:${payload}`).digest('base64url')
}

function detailsHash(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([k]) => k !== 'confirmed' && k !== 'confirmationToken')
  return createHash('sha256').update(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}

/** No database/network work. A signed proposal survives process restarts and replicas.
 * It binds the exact arguments to this org/call and requires a later user turn.
 * Missing transcript or ambiguous consent fails closed, with a recovery question.
 */
export function checkVoiceBookingConfirmation(
  params: Record<string, unknown>, orgId: string, ctx: VoiceBookingContext,
): { allowed: true } | { allowed: false; instruction: string } {
  const userCount = ctx.messages.filter((m) => m.role === 'user').length
  if (!ctx.callId || !userCount) {
    return { allowed: false, instruction: 'NOT BOOKED YET. I cannot verify the conversation right now. Explain that the appointment has not been booked and offer to take a message. Do not retry the booking.' }
  }
  const hash = detailsHash(params)
  // The exact time is bound by the token's details hash and spoken in the
  // read-back the customer consents to; "the second one" is a legitimate
  // choice a caller makes, so no clock-time utterance is required here.
  const token = typeof params.confirmationToken === 'string' ? params.confirmationToken : ''
  const [payload, mac, extra] = token.split('.')
  if (payload && mac && !extra) {
    try {
      const expected = Buffer.from(signature(payload))
      const received = Buffer.from(mac)
      if (expected.length === received.length && timingSafeEqual(expected, received)) {
        const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
        const lastUser = ctx.messages.findLastIndex((m) => m.role === 'user')
        const userIndices = ctx.messages.flatMap((m, index) => m.role === 'user' ? [index] : [])
        const proposalTurn = userIndices[p.turn - 1] ?? lastUser
        const question = ctx.messages.slice(proposalTurn + 1, lastUser).findLast((m) => m.role === 'assistant')?.content ?? ''
        const answer = ctx.messages[lastUser]?.content.toLowerCase().replace(/[.,!?]/g, '').trim() ?? ''
        const askedToBook = /(?:shall|can|may) i (?:book|request|go ahead)|would you like me to (?:book|request)|go ahead and (?:book|request)/i.test(question)
        const askedAnythingElse = /anything else/i.test(question)
        const asked = askedToBook || askedAnythingElse
        const yes = /^(yes|yeah|yep|yup|sure|ok|okay|correct|please do|go ahead|book it|yes please|yes go ahead|yes book it|that is correct|that's correct|sounds good|perfect|that works)$/.test(answer)
        // "Anything else?" answered with "no, that's all" is consent to proceed;
        // "yes" to that question means an addition and is NOT consent.
        const nothingElse = /^(no|nope|nah|no thanks|no thank you|nothing|nothing else|no that's it|no that's all|no that is it|no that is all|that's it|that's all|that is it|that is all|that'll be all|that will be all|all good|i'm good|im good|we're good|no i'm good|no im good|no that's everything|that's everything)$/.test(answer)
        const affirmative = askedToBook ? yes : nothingElse
        if (p.org === orgId && p.call === ctx.callId && p.hash === hash && Number.isInteger(p.turn)
          && userCount > p.turn && Date.now() >= p.at && Date.now() - p.at <= MAX_AGE_MS
          && affirmative && asked && params.confirmed === true) return { allowed: true }
      }
    } catch { /* An invalid/expired proposal can only produce a new read-back. */ }
  }
  const next = Buffer.from(JSON.stringify({ org: orgId, call: ctx.callId, hash, turn: userCount, at: Date.now() })).toString('base64url')
  return { allowed: false, instruction: `${readBack(params)} Only when they answer no / that's all in a later turn, call this tool with exactly the same arguments, confirmed: true, and confirmationToken: ${next}.${signature(next)}. Never speak the token. If they add or change anything, read back again.` }
}

/** The read-back the model must speak before consent, per write kind. */
function readBack(params: Record<string, unknown>): string {
  const id = params.bookingId ?? params.booking_id
  if (id != null && params.bookingDate == null) {
    return `NOT CANCELLED YET. Read back which appointment you are cancelling (booking ${id}) in one sentence, then ask exactly "Anything else?" and STOP for the customer's answer.`
  }
  if (id != null) {
    return `NOT MOVED YET. Read back that you are moving booking ${id} to ${params.bookingDate} at ${params.startTime} in one sentence, then ask exactly "Anything else you'd like to change?" and STOP for the customer's answer.`
  }
  return `NOT BOOKED YET. Read back the service name, quoted price, ${params.bookingDate} at ${params.startTime}, and ${params.customerName} in one sentence, then ask exactly "Anything else you'd like to add to that?" and STOP for the customer's answer.`
}
