export interface ClockTime { hour: number; minute: number; explicit: boolean }

/** Limited clock grammar. Anything ambiguous is clarified, never guessed. */
export function clocksIn(text: string): ClockTime[] {
  const units = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  let s = text.toLowerCase().replace(/[‐‑–—-]/g, ' ').replace(/\ba\.?\s*m\.?/g, 'am').replace(/\bp\.?\s*m\.?/g, 'pm')
  s = s.replace(/\b(twenty|thirty|forty|fifty)(?: (one|two|three|four|five|six|seven|eight|nine))?\b/g,
    (_, t: string, u: string) => String(({ twenty: 20, thirty: 30, forty: 40, fifty: 50 } as Record<string, number>)[t] + (u ? units.indexOf(u) : 0)))
  s = s.replace(new RegExp('\\b(' + units.slice(1).join('|') + ')\\b', 'g'), (word) => String(units.indexOf(word)))
    .replace(/\b(?:oh|o) (\d)\b/g, '$1').replace(/o'clock/g, '')
    .replace(/(?:a )?quarter (to|of|past) (\d{1,2})/g, (_, relation, h) => `${relation === 'past' ? Number(h) : (Number(h) + 11) % 12 || 12}:${relation === 'past' ? '15' : '45'}`)
    .replace(/half past (\d{1,2})/g, '$1:30')
    .replace(/in the (morning|afternoon|evening)/g, (_, p) => p === 'morning' ? 'am' : 'pm')
  const out: ClockTime[] = []
  const re = /(?<![\d$:/])(\d{1,2})(?::(\d{2})|\s+(\d{1,2}))?\s*(am|pm)?\b/g
  for (const m of s.matchAll(re)) {
    let hour = Number(m[1]); const minute = Number(m[2] ?? m[3] ?? 0)
    if (hour > 23 || minute > 59 || (m[4] && (hour < 1 || hour > 12))) continue
    if (m[4]) hour = hour % 12 + (m[4] === 'pm' ? 12 : 0)
    out.push({ hour, minute, explicit: Boolean(m[4]) || Number(m[1]) > 12 || Number(m[1]) === 0 })
  }
  return out
}

export function callerChoseTime(startTime: string, messages: Array<{ role: string; content: string }>): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return false
  const expected = Number(match[1]) * 60 + Number(match[2])
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const answer = messages[i].content
    // Do not interpret a rejection/correction as selection of the rejected time.
    if (/\b(?:not|don't|do not|instead|rather)\b/i.test(answer)) return false
    const previous = messages.slice(0, i).findLast((m) => m.role === 'assistant')?.content ?? ''
    const offered = clocksIn(previous)
    const explicit = clocksIn(answer)
    const ordinal = /\b(first|second|third|last) (?:one|time|option|slot)\b/i.exec(answer)?.[1]?.toLowerCase()
    let choice: ClockTime | undefined
    if (ordinal) {
      choice = offered[ordinal === 'last' ? offered.length - 1 : ['first', 'second', 'third'].indexOf(ordinal)]
    } else if (explicit.length > 0) {
      if (explicit.length !== 1) return false
      choice = explicit[0]
      if (!choice.explicit) {
        const matches = offered.filter((t) => t.explicit && t.hour % 12 === choice!.hour % 12 && t.minute === choice!.minute)
        if (matches.length !== 1) return false
        choice = matches[0]
      }
    } else continue
    return Boolean(choice?.explicit && choice.hour * 60 + choice.minute === expected)
  }
  return false
}
