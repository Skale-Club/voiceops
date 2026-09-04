import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

// Spoken the instant a tool call fires, by Vapi itself — not left to the model
// to remember. The failed 2026-09-04 call went silent because none existed.
const START: Record<string, string> = {
  list_services: 'Let me pull up what we offer.',
  business_info: 'One moment, let me check that.',
  get_quote: 'Let me get you the exact price.',
  lookup_customer: 'Let me look you up.',
  check_availability: 'Let me look at the book for you, one moment.',
  book_appointment: 'Alright, let me get that booked for you.',
  reschedule_appointment: 'Let me move that for you.',
  cancel_appointment: 'Let me take care of that cancellation.',
}
const FAILED: Record<string, string> = {
  book_appointment: "I'm sorry, I couldn't get that booked just now. Nothing was changed — would you like me to take a message?",
  reschedule_appointment: "I'm sorry, I couldn't move that appointment. It's unchanged — shall I take a message?",
  cancel_appointment: "I'm sorry, I couldn't cancel that. It's still on the book — shall I take a message?",
}
// The availability lookup measures 7.5-8.0s cold. Speak again while it runs.
const DELAYED: Record<string, { content: string; ms: number }> = {
  check_availability: { content: 'Still checking, bear with me.', ms: 4000 },
  get_quote: { content: 'Just working that out.', ms: 3500 },
}

it('gives every tool a spoken request-start, and the slow ones a delay line', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const url = 'https://api.vapi.ai/assistant/99518fa7-09f1-4c76-b7c8-58cd8a92105c'
  const cur = await (await fetch(url, { headers: H })).json() as any

  const tools = (cur.model?.tools ?? []).map((t: any) => {
    const name = t.function?.name as string
    const messages: any[] = []
    if (START[name]) messages.push({ type: 'request-start', content: START[name] })
    if (DELAYED[name]) messages.push({ type: 'request-response-delayed', content: DELAYED[name].content, timingMilliseconds: DELAYED[name].ms })
    if (FAILED[name]) messages.push({ type: 'request-failed', content: FAILED[name] })
    return messages.length ? { ...t, messages } : t
  })

  const r = await fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify({ model: { ...cur.model, tools } }) })
  const j = await r.json() as any
  console.log('### PATCH', r.status)
  if (!r.ok) { console.log(JSON.stringify(j).slice(0, 500)); expect(r.ok).toBe(true) }
  for (const t of j.model?.tools ?? []) {
    const m = (t.messages ?? []).map((x: any) => x.type).join(',')
    console.log(`### ${String(t.function?.name).padEnd(24)} ${m || 'NONE'}`)
  }
  expect((j.model?.tools ?? []).length).toBe(8)
}, 60000)
