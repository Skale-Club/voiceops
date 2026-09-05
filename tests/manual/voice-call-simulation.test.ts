// A desk rehearsal of a real call: the live Vapi assistant's own system
// prompt, model and function schemas, driven turn by turn through OpenRouter
// exactly as Vapi drives it, with every tool executed against PRODUCTION
// /api/vapi/tools (reads + forced-false preparation only). Confirmed bookings
// run through the real local consent guard with a mocked provider. No other
// production writes are allowed. Reports each
// turn's model latency, tool calls and the spoken reply, and checks the
// conversation rules the operator asked for. What it cannot exercise: audio,
// transcription, TTS and endpointing.
import { it, expect, vi } from 'vitest'
vi.mock('@/lib/xkedule/client', () => ({ xkeduleFetchJson: vi.fn(), WRITE_TIMEOUT_MS: 60000 }))
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'
import { voiceMessages } from '@/lib/vapi/booking-confirmation'
import { readFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const CALLER = process.env.SIM_CALLER ?? '+15088018190'

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
const SCRIPT: string[] = process.env.SIM_SCRIPT ? JSON.parse(process.env.SIM_SCRIPT) : [
  'a haircut',
  'just the signature haircut',
  'ok',
  'anyone is fine',
  'tomorrow',
  'monday then',
  'nine',
  'yes',
  'yes please',
]

it('simulates a full call against the live assistant config', async () => {
  const s = createServiceRoleClient()
  const { data: vapi } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const { data: orr } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'openrouter').maybeSingle()
  const vapiKey = await decrypt(vapi!.encrypted_api_key)
  const orKey = await decrypt(orr!.encrypted_api_key)
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: { Authorization: `Bearer ${vapiKey}` } })).json()) as any
  const secret: string = a.server?.headers?.['x-vapi-secret'] ?? a.model?.tools?.[0]?.server?.secret
  const model: string = a.model?.model
  const temperature: number = a.model?.temperature ?? 0.3
  const todayNy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t: string) => todayNy.find((p) => p.type === t)?.value ?? ''
  let system: string = String(a.model?.messages?.[0]?.content ?? '')
    .replaceAll('{{customer.number}}', CALLER)
    .replaceAll('{{now}}', new Date().toISOString())
    // Vapi resolves this Liquid expression per call; the rehearsal does it here.
    .replace(/\{\{"now" \| date: "[^"]*", "[^"]*"\}\}/g, `${get('weekday')}, ${get('year')}-${get('month')}-${get('day')}`)
  const tools = (a.model?.tools ?? []).map((t: any) => ({ type: 'function', function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters } }))
  if (process.env.SIM_PREDEPLOY === '1') {
    const template = readFileSync('.planning/workstreams/omnichannel-agent-orchestration/canary/vapi-receptionist-prompt.md', 'utf8')
    system = system.replace(/## The last three turns[\s\S]*?## When you did not understand/, template.match(/## The last three turns[\s\S]*?## When you did not understand/)![0])
    system = system.replace(/## Ending[\s\S]*?## Hard rules/, template.match(/## Ending[\s\S]*?## Hard rules/)![0])
    const booking = tools.find((t: any) => t.function.name === 'book_appointment')
    booking.function.parameters.properties.confirmationToken = { type: 'string', description: 'Copy from the unconfirmed preparation response, only after a later explicit yes.' }
    booking.function.parameters.properties.confirmed.description = 'Omit or false to prepare; true only after the customer explicitly says yes to the read-back, with the returned confirmationToken.'
  }
  console.log(`### CONFIG model=${model} temp=${temperature} voice=${a.voice?.provider}/${a.voice?.voiceId} transcriber=${a.transcriber?.provider}/${a.transcriber?.model} firstMode=${a.firstMessageMode} tools=${tools.length} prompt=${system.length}ch`)
  const callId = 'sim-' + Date.now()

  async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
    // Confirmed calls never reach production. Exercise the local guard and
    // provider payload while preserving the production-issued signed proposal.
    if (name === 'book_appointment' && (process.env.SIM_PREDEPLOY === '1' || (args.confirmed !== undefined && args.confirmed !== false))) {
      vi.mocked(xkeduleFetchJson).mockResolvedValue({ id: 999, status: 'pending', bookingDate: args.bookingDate, startTime: args.startTime })
      return createXkeduleBooking({ ...args, customerPhone: CALLER }, { tenantBaseUrl: 'https://example.test', apiKey: 'mock', organizationId: ORG_ID }, undefined,
        { callId, messages: voiceMessages({ messages: toArtifactMessages(messages) }) })
    }
    // Deny every production write, including unexpected tools and non-boolean consent.
    if (!['book_appointment', 'get_quote', 'list_services', 'lookup_customer', 'business_info', 'check_availability'].includes(name)) throw new Error(`Unexpected tool: ${name}`)
    const safeArgs = name === 'book_appointment' ? { ...args, confirmed: false, confirmationToken: undefined } : args
    const tc = { id: 'toolu_sim_' + toolSequence++, type: 'function', function: { name, arguments: JSON.stringify(safeArgs) } }
    const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls', call: { id: callId, assistantId: ASSISTANT_ID, customer: { number: CALLER } }, artifact: { messages: toArtifactMessages(messages) }, toolCallList: [tc] } }) })
    const j = (await r.json()) as any
    return String(j.results?.[0]?.result ?? '')
  }

  const messages: any[] = [{ role: 'system', content: system }]
  let toolSequence = 0
  vi.mocked(xkeduleFetchJson).mockClear()
  const issues: string[] = []
  let turn = 0
  async function modelTurn(label: string): Promise<string> {
    // Loop tool calls until the model speaks, exactly like Vapi.
    let spoken = ''
    for (let hop = 0; hop < 4; hop++) {
      const t = Date.now()
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${orKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, temperature, max_tokens: 1000, tools, messages }) })
      const j = (await r.json()) as any
      const m = j.choices?.[0]?.message
      if (!m) { console.log(`### ${label} MODEL_ERROR ${JSON.stringify(j).slice(0, 200)}`); return '' }
      const ms = Date.now() - t
      if (m.tool_calls?.length) {
        messages.push({ role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls })
        for (const c of m.tool_calls) {
          const args = JSON.parse(c.function.arguments || '{}')
          const tt = Date.now()
          const result = await runTool(c.function.name, args)
          console.log(`### ${label} [model ${ms}ms] TOOL ${c.function.name}(${JSON.stringify({ ...args, confirmationToken: args.confirmationToken ? '[redacted]' : undefined })}) -> ${Date.now() - tt}ms :: ${result.slice(0, 90).replace(/\n/g, ' ')}`)
          messages.push({ role: 'tool', tool_call_id: c.id, content: result })
        }
        continue
      }
      spoken = String(m.content ?? '').trim()
      messages.push({ role: 'assistant', content: spoken })
      console.log(`### ${label} [model ${ms}ms] BOT: ${spoken.replace(/\n/g, ' ')}`)
      return spoken
    }
    return spoken
  }

  // Turn 0: the model speaks first (no user message yet).
  const opening = await modelTurn('T0')
  if (!process.env.SIM_SCRIPT && !/vanildo/i.test(opening)) issues.push('opening did not greet the known caller by name')
  if (/phone|number|account/i.test(opening)) issues.push('opening mentioned phone/number/account')
  if (!process.env.SIM_SCRIPT && !/which service/i.test(opening)) issues.push('opening did not ask which service')

  for (const line of SCRIPT) {
    turn += 1
    messages.push({ role: 'user', content: line })
    console.log(`### T${turn} USER: ${line}`)
    const reply = await modelTurn(`T${turn}`)
    const low = reply.toLowerCase()
    if (!reply) issues.push(`T${turn} empty reply`)
    if (process.env.SIM_SCRIPT) continue
    if (turn === 1 && /\$\d|dollar/.test(low)) issues.push('T1 read prices while naming options')
    if (turn === 1 && /three options|3 options/.test(low)) issues.push('T1 said "three options"')
    if (turn === 2 && !/38|thirty[- ]eight/.test(low)) issues.push('T2 did not state the $38 price')
    if (turn === 3 && !/anyone|particular|prefer|nina|tony/.test(low)) issues.push('T3 did not ask anyone/someone in particular before the calendar')
    if (turn === 4 && !/day/.test(low)) issues.push('T4 did not ask for the best day')
    if (turn === 5 && !/closed|sunday/.test(low)) issues.push('T5 (tomorrow = Sunday) did not say closed')
    if (turn === 5 && /fully booked/.test(low)) issues.push('T5 said fully booked for a closed day')
    if (turn === 7 && !/last name|full name|teste|still/.test(low)) issues.push('T7 did not confirm/ask the name')
    if (turn === 8 && !/shall i request/i.test(low)) issues.push('T8 did not ask explicit booking consent')
    if (turn === 9 && !/request|approval|shop.*confirm/.test(low)) issues.push('T9 did not explain pending business approval')
    for (const opener of ['perfect', 'great', 'sure thing', 'absolutely', 'got it']) if (low.startsWith(opener)) issues.push(`T${turn} filler opener "${opener}"`)
  }
  // Generic, script-independent gates.
  const bookIdx = messages.findIndex((m) => m.role === 'assistant' && m.tool_calls?.some((c: any) => c.function.name === 'book_appointment' && /"confirmed":\s*(true|"true")/.test(c.function.arguments)))
  const askIdx = messages.findIndex((m) => m.role === 'assistant' && typeof m.content === 'string' && /shall i request/i.test(m.content))
  if (bookIdx >= 0 && (askIdx < 0 || bookIdx < askIdx)) issues.push('GATE: book_appointment before the "anything else" question')
  if (bookIdx >= 0 && askIdx >= 0 && bookIdx > askIdx && !messages.slice(askIdx + 1, bookIdx).some((m) => m.role === 'user')) issues.push('GATE: book_appointment in the same turn as the read-back')
  const offered = messages.filter((m) => m.role === 'tool' && /Available slots/.test(String(m.content))).map((m) => String(m.content)).join(' ')
  const booked = bookIdx >= 0 ? JSON.parse(messages[bookIdx].tool_calls.find((c: any) => c.function.name === 'book_appointment').function.arguments).startTime : null
  if (booked && offered && !offered.includes(booked)) issues.push(`GATE: booked ${booked}, not a slot the tool listed`)
  console.log('### ISSUES ' + (issues.length ? JSON.stringify(issues) : 'none'))
  expect(issues).toEqual([])
  expect(xkeduleFetchJson, 'one simulated provider write, after real confirmation validation').toHaveBeenCalledTimes(1)
}, 600000)
