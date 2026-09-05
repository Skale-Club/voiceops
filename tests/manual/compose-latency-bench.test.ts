// The step a caller actually waits on: after a tool result arrives, how long
// until the model produces the spoken reply. Real receptionist prompt, one
// tool exchange, three runs per model, through OpenRouter as Vapi calls it
// (no reasoning override unless REASONING_MINIMAL=1).
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const MODELS = (process.env.BENCH_MODELS ?? 'openai/gpt-5.1,openai/gpt-5.2-chat,openai/gpt-4.1,openai/gpt-5-mini,anthropic/claude-haiku-4.5').split(',')
it('compose latency after a tool result', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'openrouter').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const { data: agent } = await s.from('agents').select('id').eq('organization_id', ORG_ID).eq('slug', 'cc-voice-receptionist').single()
  const resolved = await resolveAgent(agent!.id, ORG_ID, 'voice')
  const tools = [{ type: 'function', function: { name: 'get_quote', description: 'quote', parameters: { type: 'object', properties: { serviceIds: { type: 'string' } } } } }]
  const messages = [
    { role: 'system', content: resolved!.systemPrompt.replace('{{customer.number}}', '+15088018190') },
    { role: 'assistant', content: 'Hi there! Thanks for calling. Which service would you like to book today?' },
    { role: 'user', content: 'a signature haircut please' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_quote', arguments: '{"serviceIds":"333"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'Quote: Signature Haircut: $38.00 Subtotal: $38.00 USD' },
  ]
  for (const model of MODELS) {
    const times: number[] = []; let last = ''
    for (let i = 0; i < 3; i++) {
      const t = Date.now()
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 150, temperature: 0.3, tools, ...(process.env.REASONING_MINIMAL ? { reasoning: { effort: 'minimal' } } : {}), messages }) })
        const j = (await r.json()) as any
        const m = j.choices?.[0]?.message
        last = (m?.content ? String(m.content).slice(0, 70) : 'TOOL:' + (m?.tool_calls?.[0]?.function?.name ?? j.error?.message ?? '?'))
      } catch (e) { last = 'ERR ' + String(e).slice(0, 60) }
      times.push(Date.now() - t)
    }
    console.log(`### ${model} :: ${times.join('/')}ms :: ${last}`)
  }
}, 300000)
