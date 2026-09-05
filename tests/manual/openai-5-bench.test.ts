// Lists OpenRouter's GPT-5-family ids and measures a voice-style decision
// (real receptionist prompt + the 8 functions, one caller line) per model.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('gpt-5 family bench', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'openrouter').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const models = (await (await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } })).json()) as any
  const ids = (models.data ?? []).map((m: any) => m.id as string).filter((id: string) => /^openai\/gpt-5/.test(id)).sort()
  console.log('### GPT5_IDS ' + JSON.stringify(ids))
  const { data: agent } = await s.from('agents').select('id').eq('organization_id', ORG_ID).eq('slug', 'cc-voice-receptionist').single()
  const resolved = await resolveAgent(agent!.id, ORG_ID, 'voice')
  const tools = ['lookup_customer', 'list_services', 'get_quote', 'check_availability', 'book_appointment'].map((n) => ({ type: 'function', function: { name: n, description: n, parameters: { type: 'object', properties: { phone: { type: 'string' }, serviceIds: { type: 'string' }, date: { type: 'string' } } } } }))
  const candidates = (process.env.BENCH_MODELS ? process.env.BENCH_MODELS.split(',') : ids.filter((id: string) => /gpt-5(\.\d)?(-mini|-nano)?$/.test(id)).slice(0, 6))
  for (const model of candidates) {
    const times: number[] = []; let last = ''
    for (let i = 0; i < 2; i++) {
      const t = Date.now()
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 200, tools, ...(process.env.NO_REASONING_OVERRIDE ? {} : { reasoning: { effort: 'minimal' } }), messages: [{ role: 'system', content: resolved!.systemPrompt.replace('{{customer.number}}', '+15088018190') }, { role: 'assistant', content: 'Hi there! Thanks for calling. Which service would you like to book today?' }, { role: 'user', content: 'a haircut please' }] }) })
        const j = (await r.json()) as any
        const m = j.choices?.[0]?.message
        last = m?.tool_calls?.[0]?.function?.name ?? ('TEXT:' + String(m?.content ?? j.error?.message ?? '').slice(0, 50))
      } catch (e) { last = 'ERR ' + String(e).slice(0, 60) }
      times.push(Date.now() - t)
    }
    console.log(`### ${model} :: ${times.join('/')}ms :: ${last}`)
  }
}, 240000)
