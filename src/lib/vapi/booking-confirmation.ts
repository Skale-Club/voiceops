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
  // The caller chooses the time, never the model. A time nobody said out loud
  // (offered by the assistant or spoken by the caller) cannot be prepared,
  // let alone booked. "The second one" still works: the assistant offered it.
  if (typeof params.startTime === 'string' && params.bookingDate != null && !timeWasSpoken(params.startTime, ctx.messages)) {
    return { allowed: false, instruction: `NOT BOOKED YET. Nobody has said ${params.startTime} out loud in this call, so the customer has not chosen it. Offer up to three of the times the availability tool listed, spoken naturally, and let the customer pick. Then call this tool again with the time they chose.` }
  }
  const hash = detailsHash(params)
  const token = typeof params.confirmationToken === 'string' ? params.confirmationToken : ''
  // Token shape: `<turn>.<issued-at base36>.<mac>`. Org, call id and the
  // arguments hash are inside the MAC rather than the token, which keeps it
  // ~40 characters: Vapi's model output is capped (maxTokens), and a long
  // token was truncating the tool-call arguments mid-JSON (rehearsal, v27).
  const [turnPart, atPart, mac, extra] = token.split('.')
  if (turnPart && atPart && mac && !extra) {
    try {
      const expected = Buffer.from(tokenMac(orgId, ctx.callId, hash, `${turnPart}.${atPart}`))
      const received = Buffer.from(mac)
      if (expected.length === received.length && timingSafeEqual(expected, received)) {
        const p = { turn: Number(turnPart), at: parseInt(atPart, 36) }
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
        if (Number.isInteger(p.turn) && Number.isFinite(p.at)
          && userCount > p.turn && Date.now() >= p.at && Date.now() - p.at <= MAX_AGE_MS
          && affirmative && asked && params.confirmed === true) return { allowed: true }
      }
    } catch { /* An invalid/expired proposal can only produce a new read-back. */ }
  }
  const next = `${userCount}.${Date.now().toString(36)}`
  return { allowed: false, instruction: `${readBack(params)} Only when they answer no / that's all in a later turn, call this tool with exactly the same arguments, confirmed: true, and confirmationToken: ${next}.${tokenMac(orgId, ctx.callId, hash, next)}. Never speak the token. If they add or change anything, read back again.` }
}

/** 160-bit MAC over org, call, the arguments hash and the token's own turn/time. */
function tokenMac(orgId: string, callId: string, hash: string, next: string): string {
  return signature(`${orgId}|${callId}|${hash}|${next}`).slice(0, 27)
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

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty']
const MINUTE_WORD = '(?:o ?five|oh ?five|fifteen|twenty|thirty|forty|fifty|ten|five)'

function minuteWords(m: number): string {
  if (m < 20) return NUM[m]
  const tens = TENS[Math.floor(m / 10)]
  return m % 10 ? `${tens} ${NUM[m % 10]}` : tens
}

/**
 * Whether an HH:MM time was uttered in the conversation, in any of the ways
 * people say it on the phone: "9:45", "nine forty-five", "quarter to ten",
 * "one" for 13:00, "half past ten". A bare hour ("nine") counts only when it
 * is not the start of a longer time ("nine forty-five"). Unparseable input
 * is not judged here (the action's own validation reports it).
 */
export function timeWasSpoken(startTime: string, messages: VoiceBookingContext['messages']): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim())
  if (!m) return true
  const h24 = Number(m[1])
  const min = Number(m[2])
  if (h24 > 23 || min > 59) return true
  const h12 = h24 % 12 || 12
  const next12 = (h12 % 12) + 1
  const text = messages.map((x) => x.content).join(' | ').toLowerCase().replace(/[‐-―-]/g, ' ').replace(/\s+/g, ' ')
  const hours = [...new Set([String(h24), String(h12), NUM[h12], NUM[h24] ?? ''])].filter(Boolean)
  const patterns: RegExp[] = []
  for (const h of hours) {
    patterns.push(new RegExp(`\\b${h}:${m[2]}\\b`))
    if (min === 0) {
      // "nine", "9", "nine o'clock", "9 am" - but not "nine forty five" / "9:45"
      patterns.push(new RegExp(`\\b${h}\\b(?![:.]\\d)(?! ?${MINUTE_WORD}\\b)(?! \\d{2}\\b)`))
    } else {
      patterns.push(new RegExp(`\\b${h} ${minuteWords(min)}\\b`))
      patterns.push(new RegExp(`\\b${h} ${m[2]}\\b`))
      if (min < 10) patterns.push(new RegExp(`\\b${h} (?:o|oh) ${NUM[min]}\\b`))
      if (min === 30) patterns.push(new RegExp(`\\bhalf past ${h}\\b`))
      if (min === 15) patterns.push(new RegExp(`\\b(?:a )?quarter past ${h}\\b`))
    }
  }
  if (min === 45) for (const n of [String(next12), NUM[next12]]) patterns.push(new RegExp(`\\b(?:a )?quarter (?:to|of|til|till) ${n}\\b`))
  patterns.push(new RegExp(`\\b${h24}${m[2]}\\b`))
  return patterns.some((p) => p.test(text))
}
