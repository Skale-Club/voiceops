// The full desk rehearsal matrix for the voice receptionist: many callers,
// many intents, tool failures injected, garbage transcription, mind changes.
// Same mechanics as voice-call-simulation.test.ts (live assistant prompt,
// model and schemas; read tools against production; writes intercepted and
// their ARGUMENTS validated), plus a humanity lint on every spoken line and
// per-scenario expectations. Prints one verdict line per scenario and a
// final table. Nothing is booked, moved or cancelled for real.
import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { checkVoiceBookingConfirmation, voiceMessages } from '@/lib/vapi/booking-confirmation'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const KNOWN = '+15088018190' // Vanildo Teste, has booking #471 on 2026-09-08 10:30
const NEW = '+15550009876'

type Expect = { mustSay?: RegExp[]; mustNotSay?: RegExp[]; mustCall?: string[]; mustNotCall?: string[]; maxTurnMs?: number }
type Scenario = { name: string; caller: string; script: string[]; failTool?: string; expect: Expect }

// Vapi's own artifact.messages shape: { role: 'user'|'bot', message: string }, in order.
// Tool entries and assistant turns with no spoken content (mid tool-call hops) are skipped.
function toArtifactMessages(msgs: Array<{ role: string; content?: unknown }>): Array<{ role: string; message: string }> {
  const out: Array<{ role: string; message: string }> = []
  for (const m of msgs) {
    if (m.role === 'user' && typeof m.content === 'string') out.push({ role: 'user', message: m.content })
    else if (m.role === 'assistant' && typeof m.content === 'string') out.push({ role: 'bot', message: m.content })
  }
  return out
}

const SCENARIOS: Scenario[] = [
  { name: 'known caller, straight booking', caller: KNOWN, script: ['a haircut', 'the signature haircut', 'ok', 'anyone', 'monday', 'nine forty-five', 'yes', "no that's all"], expect: { mustSay: [/hi vanildo/i, /thirty[- ]eight|38/i, /anyone|particular/i, /best day|what day|which day/i, /anything else/i], mustCall: ['lookup_customer', 'list_services', 'get_quote', 'check_availability', 'book_appointment'] } },
  { name: 'new caller wants cheapest with Tony on the 8th', caller: NEW, script: ['Paul', 'a haircut, whichever is cheapest', 'yes', 'Tony', 'the 8th', 'the first one', 'Joiner', 'no'], expect: { mustSay: [/who am i speaking|your name/i, /twenty[- ]five|25/i, /tony/i, /anything else/i], mustCall: ['get_quote', 'check_availability', 'book_appointment'] } },
  { name: 'asks hours and address only', caller: NEW, script: ['Maria', 'what time are you open and where are you?', "thanks, that's all"], expect: { mustSay: [/newbury/i, /monday|tuesday|open/i], mustCall: ['business_info'], mustNotCall: ['book_appointment', 'check_availability'] } },
  { name: 'asks price before choosing', caller: NEW, script: ['Sam', 'how much is a skin fade?', 'ok book it', 'anyone', 'wednesday', 'the last one', 'Lee', 'no'], expect: { mustSay: [/forty[- ]two|42/i, /anything else/i], mustCall: ['get_quote', 'book_appointment'] } },
  { name: 'known caller reschedules #471', caller: KNOWN, script: ['I need to move my appointment on the 8th', 'monday same time if you can', 'the first one', "no that's it", 'thanks bye'], expect: { mustSay: [/vanildo/i, /monday/i], mustCall: ['lookup_customer', 'check_availability', 'reschedule_appointment'], mustNotCall: ['book_appointment'] } },
  { name: 'known caller cancels #471', caller: KNOWN, script: ['I have to cancel my appointment', 'yes cancel it', 'no', 'thanks bye'], expect: { mustCall: ['lookup_customer', 'cancel_appointment'], mustNotCall: ['book_appointment', 'check_availability'], mustSay: [/cancel/i] } },
  { name: 'tomorrow is Sunday (closed)', caller: NEW, script: ['Ana', 'a buzz cut', 'yes', 'anyone', 'tomorrow', 'monday then', 'ten twenty', 'Silva', 'no'], expect: { mustSay: [/closed/i, /monday/i], mustNotSay: [/fully booked/i] } },
  { name: 'changes mind: adds beard after price', caller: NEW, script: ['Jon', 'a haircut', 'signature', 'actually can I add a beard trim too', 'yes', 'anyone', 'monday', 'nine', 'Doe', 'no'], expect: { mustCall: ['get_quote'], mustSay: [/anything else/i] } },
  { name: 'garbage transcription mid-flow', caller: NEW, script: ['Kim', 'a buzz cut', 'yes', 'anyone', 'monday', 'uh the yeah um', 'nine twenty', 'Park', 'no'], expect: { mustSay: [/didn.t catch|say (that )?again|repeat/i, /anything else/i] } },
  { name: 'declines the price', caller: NEW, script: ['Rob', 'a skin fade', "that's too much, anything cheaper?", 'ok the buzz cut then', 'yes', 'anyone', 'monday', 'nine', 'Cruz', 'no'], expect: { mustSay: [/twenty[- ]five|25|buzz/i, /anything else/i], mustCall: ['get_quote'] } },
  { name: 'availability tool fails', caller: NEW, script: ['Eve', 'a buzz cut', 'yes', 'anyone', 'monday', 'ok', 'bye'], failTool: 'check_availability', expect: { mustSay: [/can.t|cannot|unable|right now|message/i], mustNotCall: ['book_appointment'], mustNotSay: [/\b9|nine|ten|eleven\b/i] } },
  { name: 'time not offered', caller: NEW, script: ['Leo', 'a buzz cut', 'yes', 'anyone', 'monday', 'seven in the evening', 'ok nine then', 'Costa', 'no'], expect: { mustSay: [/anything else/i], mustCall: ['book_appointment'] } },
  { name: 'the model tries to book before the read-back', caller: NEW, script: ['Ana', 'a buzz cut', 'yes', 'anyone', 'monday', 'nine', 'Silva', 'yes', 'no'], expect: { mustSay: [/anything else/i], mustCall: ['book_appointment'] } },
]

const FILLERS = /^(perfect|great|sure thing|sure|absolutely|got it|awesome|no problem|no worries|alright)\b/i
function lintHuman(text: string): string[] {
  const out: string[] = []
  const t = text.trim()
  if (!t) return ['EMPTY REPLY']
  if (FILLERS.test(t)) out.push('filler opener')
  const questions = (t.match(/\?/g) ?? []).length
  if (questions > 1) out.push(`${questions} questions in one turn`)
  const words = t.split(/\s+/).length
  if (words > 45) out.push(`${words} words (long for a phone line)`)
  if (/\b(tool|system|api|assistant|ai|model|database)\b/i.test(t)) out.push('mentions tool/system/AI')
  if (/[*#_\[\]]/.test(t)) out.push('markdown characters')
  for (const m of t.matchAll(/\b(\d{1,2}):\d{2}\b/g)) {
    const hour = parseInt(m[1], 10)
    if (hour >= 13 && hour <= 23) { out.push('digital time (13:00) spoken'); break }
  }
  if (/\$\d/.test(t)) out.push('$ sign spoken')
  const sentences = t.split(/(?<=[.!?])\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 12)
  if (new Set(sentences).size !== sentences.length) out.push('repeated sentence')
  return out
}

it('runs the voice rehearsal matrix', async () => {
  const s = createServiceRoleClient()
  const { data: vapi } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const { data: orr } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'openrouter').maybeSingle()
  const vapiKey = await decrypt(vapi!.encrypted_api_key)
  const orKey = await decrypt(orr!.encrypted_api_key)
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: { Authorization: `Bearer ${vapiKey}` } })).json()) as any
  const secret: string = a.server?.headers?.['x-vapi-secret']
  const model: string = a.model?.model
  const temperature: number = a.model?.temperature ?? 0.3
  const tools = (a.model?.tools ?? []).map((t: any) => ({ type: 'function', function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters } }))
  const todayNy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t: string) => todayNy.find((p) => p.type === t)?.value ?? ''
  const baseSystem = String(a.model?.messages?.[0]?.content ?? '').replace(/\{\{"now" \| date: "[^"]*", "[^"]*"\}\}/g, `${get('weekday')}, ${get('year')}-${get('month')}-${get('day')}`)

  const only = process.env.MATRIX_ONLY ? new RegExp(process.env.MATRIX_ONLY, 'i') : null
  const summary: string[] = []
  const failures: string[] = []

  for (const sc of SCENARIOS) {
    if (only && !only.test(sc.name)) continue
    const system = baseSystem.replaceAll('{{customer.number}}', sc.caller)
    const callId = 'matrix-' + Date.now()
    const messages: any[] = [{ role: 'system', content: system }]
    const called: string[] = []
    const problems: string[] = []
    const lints: string[] = []
    let offered = ''
    let maxTurn = 0

    let toolSeq = 0
    async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
      called.push(name)
      if (sc.failTool === name) return 'Service unavailable.'
      if (name === 'book_appointment' && (args.confirmed === true || args.confirmed === 'true') && typeof args.confirmationToken === 'string') {
        // A confirmed booking with a token could pass production's real consent
        // check now that we send it a real artifact — never let that hit prod.
        // Run the exact same guard locally instead of posting to production.
        const ctx = { callId, messages: voiceMessages({ messages: toArtifactMessages(messages) }) }
        const result = checkVoiceBookingConfirmation(args, ORG_ID, ctx)
        if (!result.allowed) return result.instruction
        if (offered && typeof args.startTime === 'string' && !offered.includes(args.startTime)) problems.push(`booked ${args.startTime}, not an offered slot`)
        if (typeof args.customerEmail === 'string' && args.customerEmail.length > 0) problems.push(`invented email ${args.customerEmail}`)
        return `Booking confirmed. ID: 999 | ${args.bookingDate} at ${args.startTime} | Status: pending | Total: $0.00 (SIMULATED)`
      }
      if (name === 'reschedule_appointment' || name === 'cancel_appointment') {
        // Same consent gate production runs (require_voice_confirmation is on
        // for these workflows); the write itself is simulated. Never hits prod.
        const ctx = { callId, messages: voiceMessages({ messages: toArtifactMessages(messages) }) }
        const result = checkVoiceBookingConfirmation(args, ORG_ID, ctx)
        if (!result.allowed) return result.instruction
        if (String(args.bookingId) !== '471') problems.push(`${name} used bookingId ${args.bookingId}, expected 471 from lookup`)
        if (name === 'cancel_appointment') return 'Booking 471 is now cancelled. (SIMULATED)'
        if (offered && typeof args.startTime === 'string' && !offered.includes(args.startTime)) problems.push(`rescheduled to ${args.startTime}, not an offered slot`)
        return `Booking 471 rescheduled to ${args.bookingDate} at ${args.startTime}. (SIMULATED)`
      }
      const tc = { id: `toolu_${++toolSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
      const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls', call: { id: callId, assistantId: ASSISTANT_ID, customer: { number: sc.caller } }, artifact: { messages: toArtifactMessages(messages) }, toolCallList: [tc] } }) })
      const j = (await r.json()) as any
      const result = String(j.results?.[0]?.result ?? '')
      if (name === 'check_availability' && /Available slots/.test(result)) offered += ' ' + result
      return result
    }

    async function modelTurn(label: string): Promise<string> {
      const t0 = Date.now()
      for (let hop = 0; hop < 5; hop++) {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${orKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, temperature, max_tokens: 250, tools, messages }) })
        const j = (await r.json()) as any
        const m = j.choices?.[0]?.message
        if (!m) { problems.push(`${label} model error ${JSON.stringify(j).slice(0, 80)}`); return '' }
        if (m.tool_calls?.length) {
          messages.push({ role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls })
          for (const c of m.tool_calls) {
            let args: Record<string, unknown> = {}
            try { args = JSON.parse(c.function.arguments || '{}') } catch { problems.push(`${label} malformed tool args`) }
            const result = await runTool(c.function.name, args)
            console.log(`###   ${label} TOOL ${c.function.name}(${JSON.stringify(args).slice(0, 110)}) :: ${result.slice(0, 70).replace(/\n/g, ' ')}`)
            messages.push({ role: 'tool', tool_call_id: c.id, content: result })
          }
          continue
        }
        const spoken = String(m.content ?? '').trim()
        messages.push({ role: 'assistant', content: spoken })
        maxTurn = Math.max(maxTurn, Date.now() - t0)
        const l = lintHuman(spoken)
        if (l.length) lints.push(`${label}: ${l.join(', ')}`)
        console.log(`###   ${label} BOT: ${spoken.replace(/\n/g, ' ').slice(0, 220)}`)
        return spoken
      }
      problems.push(`${label} exceeded 5 tool hops without speaking`)
      return ''
    }

    console.log(`### === ${sc.name} (${sc.caller}) ===`)
    const spokenAll: string[] = []
    spokenAll.push(await modelTurn('T0'))
    let i = 0
    for (const line of sc.script) {
      i += 1
      messages.push({ role: 'user', content: line })
      console.log(`###   T${i} USER: ${line}`)
      spokenAll.push(await modelTurn(`T${i}`))
    }
    const all = spokenAll.join('\n')
    for (const re of sc.expect.mustSay ?? []) if (!re.test(all)) problems.push(`never said ${re}`)
    for (const re of sc.expect.mustNotSay ?? []) if (re.test(all)) problems.push(`said ${re}`)
    for (const t of sc.expect.mustCall ?? []) if (!called.includes(t)) problems.push(`never called ${t}`)
    for (const t of sc.expect.mustNotCall ?? []) if (called.includes(t)) problems.push(`called ${t}`)
    // Booking gate: a confirmed booking must come after an "anything else" question that the user answered.
    const bookIdx = messages.findIndex((m) => m.role === 'assistant' && m.tool_calls?.some((c: any) => c.function.name === 'book_appointment' && /"confirmed":\s*(true|"true")/.test(c.function.arguments)))
    const askIdx = messages.findIndex((m) => m.role === 'assistant' && typeof m.content === 'string' && /anything else/i.test(m.content))
    if (bookIdx >= 0 && (askIdx < 0 || bookIdx < askIdx)) problems.push('GATE: booked before "anything else"')
    if (bookIdx >= 0 && askIdx >= 0 && bookIdx > askIdx && !messages.slice(askIdx + 1, bookIdx).some((m) => m.role === 'user')) problems.push('GATE: booked in the read-back turn')
    const verdict = problems.length === 0 ? 'PASS' : 'FAIL'
    if (verdict === 'FAIL') failures.push(sc.name)
    summary.push(`${verdict} | ${sc.name} | slowest turn ${maxTurn}ms | ${problems.join('; ') || '-'} | lint: ${lints.join(' / ') || '-'}`)
    console.log(`### RESULT ${summary[summary.length - 1]}`)
  }
  console.log('### SUMMARY')
  for (const line of summary) console.log('### ' + line)
  expect(failures).toEqual([])
}, 3_000_000)
