import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { callerChoseTime, clocksIn, listedSlotsIn } from '@/lib/vapi/clock-choice'

export type BookingOperation = 'create' | 'reschedule' | 'cancel'
/** Context comes only from the verified ingress, never from model arguments. */
export interface VoiceBookingContext {
  callId: string
  /** `tool` entries are tool results: read for slot lists, ignored by the consent logic. */
  messages: Array<{ role: string; content: string }>
}

/**
 * Provider-verified facts the customer must hear before a write happens. The
 * wording is the model's; these are the things it may not get wrong.
 * `date`/`time` are the operative ones (the new appointment for create and
 * reschedule, the existing one for cancel).
 */
export interface VoiceBookingFacts {
  services: string[]
  /** Decimal string from the provider quote, create only. */
  price?: string
  currency?: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, 24h */
  time: string
  staffName?: string
  customerName?: string
  existing?: { date: string; time: string; services: string[]; staff?: string }
}

export const CREATE_QUESTION = "Anything else you'd like to add to that?"
export const RESCHEDULE_QUESTION = "Anything else you'd like to change?"
export const CANCEL_QUESTION = 'Anything else?'
export const CONFIRMATION_QUESTIONS: Record<BookingOperation, string> = {
  create: CREATE_QUESTION,
  reschedule: RESCHEDULE_QUESTION,
  cancel: CANCEL_QUESTION,
}
const MAX_AGE_MS = 10 * 60_000

/**
 * The call so far, in the two shapes Vapi sends. Tool results are kept as
 * `{ role: 'tool' }` because the availability slot list is the only thing that
 * can disambiguate an hour the caller said without AM/PM (clock-choice.ts).
 */
export function voiceMessages(artifact: unknown): VoiceBookingContext['messages'] {
  if (!artifact || typeof artifact !== 'object') return []
  const a = artifact as Record<string, unknown>
  const raw = Array.isArray(a.messagesOpenAIFormatted) && a.messagesOpenAIFormatted.length ? a.messagesOpenAIFormatted : a.messages
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    // Vapi native: 'bot' / 'tool_call_result' (+ `message` / `result`).
    // OpenAI shape: 'assistant' / 'tool' (+ `content`).
    const role = m.role === 'bot' ? 'assistant' : m.role === 'tool_call_result' ? 'tool' : m.role
    const content = m.content ?? m.message ?? m.result
    return (role === 'user' || role === 'assistant' || role === 'tool') && typeof content === 'string' && content.trim()
      ? [{ role, content: content.trim() }] : []
  })
}

/** Ignore punctuation/case, not words, numbers or negations. */
export function normalizeReadBack(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\ba\.\s*m\./g, 'am').replace(/\bp\.\s*m\./g, 'pm')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

const SMALL: Record<string, number> = Object.fromEntries(
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((w, i) => [w, i]))
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const NUMBER_WORDS = [...Object.keys(SMALL), ...Object.keys(TENS), 'hundred', 'thousand', 'and']
const NUMBER_PHRASE = new RegExp(`\\b(?:${NUMBER_WORDS.join('|')})(?:\\s+(?:${NUMBER_WORDS.join('|')}))*\\b`, 'g')

function evaluateWords(words: string[]): number | undefined {
  let total = 0
  let current = 0
  let seen = false
  for (const word of words) {
    if (word === 'and') continue
    if (word === 'hundred') { current = (current || 1) * 100; seen = true; continue }
    if (word === 'thousand') { total += (current || 1) * 1000; current = 0; seen = true; continue }
    if (word in TENS) { current += TENS[word]; seen = true; continue }
    if (word in SMALL) { current += SMALL[word]; seen = true; continue }
    return undefined
  }
  return seen ? total + current : undefined
}

/** "thirty eight" -> "38", for a price a receptionist speaks rather than reads (0-9999). */
export function numberWordsToDigits(text: string): string {
  return text.replace(NUMBER_PHRASE, (phrase) => {
    const value = evaluateWords(phrase.split(/\s+/))
    return value === undefined ? phrase : String(value)
  })
}

/**
 * Every number a run of number words can mean, including its sub-runs: a
 * receptionist says "at nine, thirty-eight dollars" and both 9 and 38 are in it.
 */
function spokenNumbers(text: string): Set<number> {
  const values = new Set<number>()
  for (const phrase of text.match(NUMBER_PHRASE) ?? []) {
    const words = phrase.split(/\s+/)
    for (let i = 0; i < words.length; i++) {
      for (let j = i; j < words.length; j++) {
        const value = evaluateWords(words.slice(i, j + 1))
        if (value !== undefined) values.add(value)
      }
    }
  }
  return values
}

function dayFacts(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(d)
  return {
    weekday: part({ weekday: 'long' }),
    long: part({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    month: part({ month: 'long' }),
    day: Number(date.slice(8, 10)),
    monthNumber: Number(date.slice(5, 7)),
  }
}

/** "09:45" -> "9:45 AM" — the way the read-back should sound. */
export function spokenTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
function validDay(date: unknown, time: unknown): boolean {
  if (typeof date !== 'string' || !DATE_RE.test(date) || typeof time !== 'string' || !TIME_RE.test(time)) return false
  const d = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
}

function factsAreUsable(operation: BookingOperation, f: VoiceBookingFacts | undefined): f is VoiceBookingFacts {
  if (!f || !validDay(f.date, f.time)) return false
  if (operation === 'create') return f.services.length > 0 && Boolean(f.customerName?.trim())
  return Boolean(f.existing && f.existing.services.length && validDay(f.existing.date, f.existing.time))
}

/** The caller must hear the time; "nine forty-five", "9:45 AM" and "09:45" all count. */
function mentionsTime(text: string, time: string): boolean {
  const [hour, minute] = time.split(':').map(Number)
  return clocksIn(text).some((t) => t.minute === minute && t.hour % 12 === hour % 12)
}

/** The weekday name, or the date in any form a person says it. */
function mentionsDate(text: string, date: string): boolean {
  const { weekday, month, day, monthNumber } = dayFacts(date)
  const n = normalizeReadBack(text)
  const dayToken = new RegExp(`\\b${day}(?:st|nd|rd|th)?\\b`)
  return new RegExp(`\\b${weekday.toLowerCase()}\\b`).test(n)
    || (n.includes(month.toLowerCase()) && dayToken.test(n))
    || new RegExp(`\\b${day}(?:st|nd|rd|th)\\b`).test(n)
    || new RegExp(`\\b${monthNumber}\\s+${day}\\b`).test(n)
    || n.includes(normalizeReadBack(date))
}

function mentionsPrice(text: string, price: string): boolean {
  const dollars = Math.trunc(Number(price))
  if (!Number.isFinite(dollars)) return true
  const normalized = normalizeReadBack(text)
  return new RegExp(`\\b${dollars}\\b`).test(normalized) || spokenNumbers(normalized).has(dollars)
}

/** Names of the facts the read-back left out; empty means the customer heard everything. */
export function missingReadBackFacts(operation: BookingOperation, f: VoiceBookingFacts, readBack: string): string[] {
  const missing: string[] = []
  const normalized = normalizeReadBack(readBack)
  const existing = f.existing
  if (operation === 'create') {
    if (!mentionsTime(readBack, f.time)) missing.push(`the time (${spokenTime(f.time)})`)
    if (!mentionsDate(readBack, f.date)) missing.push(`the day (${dayFacts(f.date).long})`)
    for (const service of f.services) {
      if (!normalized.includes(normalizeReadBack(service))) missing.push(`the service (${service})`)
    }
    const firstName = String(f.customerName ?? '').trim().split(/\s+/)[0]
    if (firstName && !new RegExp(`\\b${normalizeReadBack(firstName)}\\b`).test(normalized)) missing.push(`the customer's name (${firstName})`)
    if (f.price && !mentionsPrice(readBack, f.price)) missing.push(`the price (${Number(f.price).toFixed(2)}${f.currency ? ` ${f.currency}` : ''})`)
    return missing
  }
  if (existing) {
    if (!mentionsDate(readBack, existing.date)) missing.push(`the day of the existing appointment (${dayFacts(existing.date).long})`)
    if (!mentionsTime(readBack, existing.time)) missing.push(`the time of the existing appointment (${spokenTime(existing.time)})`)
  }
  if (operation === 'reschedule') {
    if (!mentionsDate(readBack, f.date)) missing.push(`the new day (${dayFacts(f.date).long})`)
    if (!mentionsTime(readBack, f.time)) missing.push(`the new time (${spokenTime(f.time)})`)
  }
  return missing
}

function factList(operation: BookingOperation, f: VoiceBookingFacts): string {
  const services = f.services.join(' and ')
  const staff = f.staffName ? `, with ${f.staffName}` : ''
  if (operation === 'create') {
    const price = f.price ? `, ${Number(f.price).toFixed(2)} ${f.currency ?? ''}`.trimEnd() : ''
    return `${services}${price}, ${dayFacts(f.date).long} at ${spokenTime(f.time)}${staff}, for ${f.customerName}`
  }
  const e = f.existing!
  const current = `${e.services.join(' and ')}${e.staff ? ` with ${e.staff}` : ''} on ${dayFacts(e.date).long} at ${spokenTime(e.time)}`
  return operation === 'cancel'
    ? `cancelling ${current}`
    : `moving ${current} to ${dayFacts(f.date).long} at ${spokenTime(f.time)}${staff}`
}

function factsKey(f: VoiceBookingFacts): string {
  return JSON.stringify([f.services, f.price ?? '', f.currency ?? '', f.date, f.time, f.staffName ?? '', f.customerName ?? '',
    f.existing ? [f.existing.date, f.existing.time, f.existing.services, f.existing.staff ?? ''] : ''])
}

function tokenMac(operation: BookingOperation, org: string, call: string, params: Record<string, unknown>, facts: string, nonce: string): string {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw new Error('Booking confirmation signing unavailable')
  const entries = Object.entries(params).filter(([k]) => !['confirmed', 'confirmationToken'].includes(k)).sort(([a], [b]) => a.localeCompare(b))
  const hash = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  // v3 invalidates older tokens (facts replaced the verbatim sentence).
  // The operation is chosen by the executor, never inferred from params.
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify(['voice-booking-v3', operation, org, call, hash, facts, nonce]))
    .digest('base64url').slice(0, 27)
}

/**
 * Server-side consent: the customer heard the verified facts in the model's own
 * words, in a turn of its own, and answered "no, that's all" in a LATER turn.
 * Wording is free; facts, the question and the order are not.
 */
export function checkVoiceBookingConfirmation(
  params: Record<string, unknown>, orgId: string, ctx: VoiceBookingContext,
  operation: BookingOperation, facts: VoiceBookingFacts,
): { allowed: true } | { allowed: false; instruction: string } {
  const prefix = operation === 'cancel' ? 'NOT CANCELLED YET.' : operation === 'reschedule' ? 'NOT MOVED YET.' : 'NOT BOOKED YET.'
  const question = CONFIRMATION_QUESTIONS[operation]
  const users = ctx.messages.flatMap((m, index) => m.role === 'user' ? [index] : [])
  if (!orgId || !ctx.callId || !users.length || !factsAreUsable(operation, facts)) return { allowed: false,
    instruction: `${prefix} Conversation or appointment details could not be verified. Explain nothing was changed and offer to take a message.` }
  const token = typeof params.confirmationToken === 'string' ? params.confirmationToken : ''
  const [turnPart, atPart, mac, extra] = token.split('.')
  const turn = Number(turnPart)
  const at = parseInt(atPart, 36)
  const validShape = /^\d+$/.test(turnPart ?? '') && /^[a-z\d]+$/.test(atPart ?? '') && Boolean(mac) && !extra
  // Evaluate the choice before the proposal: later read-back/consent must not become a new choice.
  const choiceHistory = validShape && turn > 0 && turn <= users.length ? ctx.messages.slice(0, users[turn - 1] + 1) : ctx.messages
  if (operation !== 'cancel'
    && !callerChoseTime(String(params.startTime ?? ''), choiceHistory, listedSlotsIn(ctx.messages))) return { allowed: false,
    instruction: `${prefix} The chosen time is not the one the customer said. Offer the times the availability tool listed, spoken naturally, and let the customer pick one; if they said an hour that could be morning or evening, ask which. Then prepare again. Never pick a time for them.` }
  let missing: string[] = []
  if (validShape && turn > 0 && Number.isInteger(turn) && Number.isFinite(at)) {
    const expected = Buffer.from(tokenMac(operation, orgId, ctx.callId, params, factsKey(facts), `${turnPart}.${atPart}`))
    const received = Buffer.from(mac)
    if (expected.length === received.length && timingSafeEqual(expected, received)
      && users.length === turn + 1 && Date.now() >= at && Date.now() - at <= MAX_AGE_MS) {
      const between = ctx.messages.slice(users[turn - 1] + 1, users[turn])
      const readBack = between.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ')
      const answer = normalizeReadBack(ctx.messages[users[turn]].content)
        .replace(/^nope(?= |$)/, 'no').replace(/ (?:thanks|thank you)$/, '')
      const nothingElse = /^(no|nope|nothing|no thanks|no thank you|nothing else|no that s it|no that s all|no that is it|no that is all|that s it|that s all|that is it|that is all|no i m good)$/.test(answer)
      if (params.confirmed === true && nothingElse) {
        // The wording is the model's; every fact and the question must be in it.
        // A repeated identical read-back is fine — repetition preserves meaning.
        missing = missingReadBackFacts(operation, facts, readBack)
        if (!/anything else/i.test(readBack)) missing = [...missing, `the question "${question}"`]
        if (!missing.length) return { allowed: true }
      }
    }
  }
  const nonce = `${users.length}.${Date.now().toString(36)}`
  const correction = missing.length ? `The customer never heard ${missing.join(', ')}. Say it this time. ` : ''
  return { allowed: false, instruction: `${prefix} ${correction}Read these facts back in ONE natural sentence, in your own words: ${factList(operation, facts)}. `
    + `Then ask exactly "${question}" and STOP. Wait for a NEW customer reply; only no / that's all authorizes this operation, and a yes means they want a change. `
    + `Then call this tool again with the same arguments plus confirmed:true and confirmationToken: ${nonce}.${tokenMac(operation, orgId, ctx.callId, params, factsKey(facts), nonce)}. `
    + `Never speak the token. A changed detail requires a new preparation.` }
}
