// src/lib/vapi/clock-choice.ts
// One clock grammar for the whole voice path, and one rule for resolving an
// hour a caller said without AM/PM: the slots the availability tool listed in
// THIS call decide it, never the model and never a bare AM/PM heuristic.
//
// Call 4 (2026-09-05) looped because Deepgram writes digital times with a
// leading zero ("09:45") and the guard only accepted `9:45` / `nine forty-five`
// with an explicit AM/PM. The caller said their time three times and the server
// refused it three times. Everything a caller can plausibly say for a time is
// parsed here, once, and disambiguated against the tool's own slot list.

export interface ClockTime { hour: number; minute: number; explicit: boolean }
/** Same shape as VoiceBookingContext['messages']; `tool` entries carry tool results. */
export interface ClockMessage { role: string; content: string }

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50 }

/** A time the caller rejected in the same breath ("not nine", "I can't do nine"). */
const NEGATION = /\b(?:not|never|cannot|don'?t|doesn'?t|didn'?t|can'?t|won'?t)\b/
/** A sentence that replaces an earlier time ("no, ten", "ten instead"). */
const CORRECTION = /\b(?:no|nope|nah|not|instead|rather|actually|change|different|meant|make it)\b/

/** Words a caller uses for clock times become digits; nothing else is touched. */
function digitize(text: string): string {
  let s = text.toLowerCase().replace(/[‘’]/g, "'")
    // Calendar dates are not clock times: "2026-09-12" must not become 09:12.
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    // Days of the month are not clock times either: "on the 8th" / "the 12th"
    // / "September 8" must not become 8:00 (rehearsal v39: an offer "on the
    // 8th ... nine, eleven, or three" made "the first one" resolve to 8:00).
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/g, ' ')
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+\d{1,2}(?:,?\s*\d{4})?\b/g, ' ')
    .replace(/[‐-―-]/g, ' ')
    .replace(/\ba\.?\s*m\.?(?![a-z])/g, 'am')
    .replace(/\bp\.?\s*m\.?(?![a-z])/g, 'pm')
  s = s.replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})(?:\\s+(${UNITS.slice(1, 10).join('|')}))?\\b`, 'g'),
    (_, tens: string, unit?: string) => String(TENS[tens] + (unit ? UNITS.indexOf(unit) : 0)))
  return s
    .replace(new RegExp(`\\b(${UNITS.slice(1).join('|')})\\b`, 'g'), (word) => String(UNITS.indexOf(word)))
    .replace(/\b(?:oh|o)\s+(\d)\b/g, ' $1')
    .replace(/\bo'?\s*clock\b/g, ' ')
    .replace(/\b(?:a\s+)?quarter\s+(to|of|till|til|before|past|after)\s+(\d{1,2})\b/g,
      (_, relation: string, hour: string) => ['past', 'after'].includes(relation)
        ? `${hour}:15` : `${(Number(hour) + 11) % 12 || 12}:45`)
    .replace(/\bhalf\s+past\s+(\d{1,2})\b/g, '$1:30')
    .replace(/\bin the morning\b/g, ' am')
    .replace(/\bin the (?:afternoon|evening)\b/g, ' pm')
}

// hh:mm · h mm · hmm/hhmm (a bare 3-4 digit number only when it decomposes into
// a real time) · optional am/pm. The lookbehind and `(?!\d)` keep phone numbers,
// prices and ids out: a longer digit run never yields a time.
const TIME_RE = /(?<![\d$:./])(\d{1,4})(?::([0-5]\d)|\s+([0-5]?\d)\b)?(?!\d)\s*(am|pm)?/g

interface LocatedTime extends ClockTime { index: number }

function scanClocks(digitized: string): LocatedTime[] {
  const out: LocatedTime[] = []
  for (const m of digitized.matchAll(TIME_RE)) {
    const raw = m[1]
    const suffix = m[4]
    let hour: number
    let minute: number
    if (m[2] !== undefined || m[3] !== undefined) {
      if (raw.length > 2) continue
      hour = Number(raw)
      minute = Number(m[2] ?? m[3])
    } else if (raw.length <= 2) {
      hour = Number(raw)
      minute = 0
    } else {
      hour = Math.floor(Number(raw) / 100)
      minute = Number(raw) % 100
    }
    if (hour > 23 || minute > 59) continue
    if (suffix && (hour < 1 || hour > 12)) continue
    // A leading zero is 24-hour notation ("09:45"), which needs no AM/PM.
    const explicit = Boolean(suffix) || hour > 12 || hour === 0 || /^0\d/.test(raw)
    if (suffix) hour = (hour % 12) + (suffix === 'pm' ? 12 : 0)
    out.push({ hour, minute, explicit, index: m.index ?? 0 })
  }
  return out
}

/** Every clock time named in a piece of speech, in the order it was said. */
export function clocksIn(text: string): ClockTime[] {
  return scanClocks(digitize(text)).map(({ hour, minute, explicit }) => ({ hour, minute, explicit }))
}

function dedupe(times: ClockTime[]): ClockTime[] {
  const seen = new Map<string, ClockTime>()
  for (const t of times) if (!seen.has(`${t.hour}:${t.minute}`)) seen.set(`${t.hour}:${t.minute}`, t)
  return [...seen.values()]
}

function parseSlot(slot: string): ClockTime | undefined {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(slot.trim())
  if (!m || Number(m[1]) > 23) return undefined
  return { hour: Number(m[1]), minute: Number(m[2]), explicit: true }
}

// Both shapes a tool result can carry a day's slots in:
//   "Available slots on 2026-09-12: 09:00, 09:45, 10:30"          (24h)
//   "Available times on 2026-09-12: 9:00 AM, 9:45 AM, 10:30 AM"   (spoken)
// plus the range result, whose every line starts with its own date, and the
// includeStaff shape, whose times sit on the lines below the date header.
const SLOT_HEADER = /(?:^|\n)[ \t]*(?:available (?:slots|times) on[ \t]+)?(\d{4}-\d{2}-\d{2})[^\n:]*:/gi
const SLOT_TIME = /\b(\d{1,2}):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?/gi

/** The HH:MM slots the availability tool actually returned earlier in this call. */
export function listedSlotsIn(messages: readonly ClockMessage[]): string[] {
  const out = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue
    const text = message.content
    const headers = [...text.matchAll(SLOT_HEADER)]
    for (let i = 0; i < headers.length; i++) {
      const start = (headers[i].index ?? 0) + headers[i][0].length
      const end = i + 1 < headers.length ? headers[i + 1].index ?? text.length : text.length
      for (const t of text.slice(start, end).matchAll(SLOT_TIME)) {
        let hour = Number(t[1])
        const minute = Number(t[2])
        const suffix = t[3]?.toLowerCase().replace(/\./g, '')
        if (suffix) {
          if (hour < 1 || hour > 12) continue
          hour = (hour % 12) + (suffix === 'pm' ? 12 : 0)
        }
        if (hour > 23) continue
        out.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
      }
    }
  }
  return [...out].sort()
}

type Answer =
  | { kind: 'none' }
  | { kind: 'rejected' }
  | { kind: 'ambiguous' }
  | { kind: 'time'; time: ClockTime }

/** What a single caller turn says about the clock, corrections included. */
function readAnswer(answer: string): Answer {
  const digitized = digitize(answer)
  const times = scanClocks(digitized)
  if (!times.length) return { kind: 'none' }
  const kept: LocatedTime[] = []
  let previousEnd = 0
  for (const time of times) {
    const before = digitized.slice(previousEnd, time.index)
    previousEnd = time.index
    if (!NEGATION.test(before)) kept.push(time)
  }
  if (!kept.length) return { kind: 'rejected' }
  const unique = dedupe(kept)
  if (unique.length === 1) return { kind: 'time', time: unique[0] }
  // "no, ten", "ten instead": the last time named replaces the earlier ones.
  // "nine or ten" without a correction is two options, not a choice.
  return CORRECTION.test(digitized) ? { kind: 'time', time: kept[kept.length - 1] } : { kind: 'ambiguous' }
}

/** Bare numbers are clocks only when answering an actual clock question. */
function isClockQuestion(text: string): boolean {
  if (/\b(?:what|which)\s+time\b|\bwhat time works\b|\bwhich (?:one|slot)\b|\bmorning or (?:afternoon|evening)\b|\b(?:time|slot) works\b/i.test(text)) return true
  const clocks = clocksIn(text)
  // A multi-option offer can be declarative (call 4: "I can do nine,
  // 9:45, or 10:30."). A short single-time question can be a confirmation
  // ("Nine oh five AM?"). Do not treat a full booking read-back ending in
  // "Anything else?" as another clock question.
  return clocks.length >= 2 || (clocks.length === 1 && text.includes('?') && text.trim().split(/\s+/).length <= 8)
}

/**
 * Resolve an hour said without AM/PM. The slots the availability tool listed in
 * this call decide it; with no slot list at all, the previous offer decides it.
 * Two candidates (09:00 and 21:00 both open) is a question, never a guess.
 */
function resolve(choice: ClockTime, slots: ClockTime[], offered: ClockTime[]): ClockTime | undefined {
  if (choice.explicit) return choice
  const matches = (list: ClockTime[]) =>
    dedupe(list.filter((t) => t.hour % 12 === choice.hour % 12 && t.minute === choice.minute))
  const candidates = slots.length ? matches(slots) : matches(offered.filter((t) => t.explicit))
  return candidates.length === 1 ? candidates[0] : undefined
}

/**
 * Did the caller choose this exact time out loud?
 *
 * @param startTime   HH:MM the model wants to write.
 * @param messages    The call so far (user/assistant/tool entries).
 * @param listedSlots HH:MM slots the availability tool returned in this call;
 *                    defaults to the slots found in the artifact's tool results.
 */
export function callerChoseTime(
  startTime: string,
  messages: readonly ClockMessage[],
  listedSlots?: readonly string[],
): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(String(startTime))
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return false
  const expected = Number(match[1]) * 60 + Number(match[2])
  const slots = (listedSlots ?? listedSlotsIn(messages))
    .map(parseSlot).filter((t): t is ClockTime => Boolean(t))

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const answer = messages[i].content
    const offered = clocksIn(messages.slice(0, i).findLast((m) => m.role === 'assistant')?.content ?? '')
    const ordinal = /\b(first|second|third|last)\s+(?:one|time|option|slot)\b/i.exec(answer)?.[1]?.toLowerCase()
    let choice: ClockTime | undefined
    if (ordinal) {
      choice = offered[ordinal === 'last' ? offered.length - 1 : ['first', 'second', 'third'].indexOf(ordinal)]
      if (!choice) return false
    } else {
      const said = readAnswer(answer)
      if (said.kind === 'rejected' || said.kind === 'ambiguous') return false
      if (said.kind === 'none') continue // "yeah" to the name question is not a new choice
      choice = said.time
      // "just one" in a complaint after the read-back is not 1:00. A time
      // with AM/PM/24h is self-identifying; a bare hour/minute must directly
      // answer a question that asked the caller to choose a clock time.
      if (!choice.explicit && !isClockQuestion(messages.slice(0, i).findLast((m) => m.role === 'assistant')?.content ?? '')) continue
    }
    const resolved = resolve(choice, slots, offered)
    if (resolved) return resolved.hour * 60 + resolved.minute === expected
    // An ordinal points at one item of the offer rather than reading a clock:
    // with no slot list to resolve it against, the offer itself is the evidence
    // and only AM/PM is open, so match the model's time modulo 12 hours.
    return Boolean(ordinal && !slots.length
      && choice.hour % 12 === Math.floor(expected / 60) % 12 && choice.minute === expected % 60)
  }
  return false
}
