// Measures the orchestrator's decision latency by model: the real entry
// orchestrator prompt (rendered) plus five delegation tools, one representative
// caller message, through OpenRouter, three runs each. The trace of the last
// widget turns showed 8-9s between the orchestrator starting and the first
// specialist starting - that is this call. Read-only against Xphere; spends a
// few cents of OpenRouter credit.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const MODELS = ['anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5', 'openai/gpt-4.1-mini', 'google/gemini-2.5-flash']
const TOOLS = ['services', 'pricing', 'availability', 'customer', 'booking'].map((n) => ({
  type: 'function',
  function: { name: `handoff_to_${n}`, description: `Hand the request to the ${n} specialist.`, parameters: { type: 'object', properties: { request: { type: 'string', description: 'What the specialist should do, in one sentence.' } }, required: ['request'] } },
}))
it('benchmarks orchestrator decision latency per model', async () => {
  const s = createServiceRoleClient()
  const { data: agent } = await s.from('agents').select('id').eq('organization_id', ORG_ID).eq('slug', 'cc-entry-orchestrator').single()
  const resolved = await resolveAgent(agent!.id, ORG_ID, 'web_widget')
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'openrouter').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const user = 'Do you have anything open on September 8th for a signature haircut?'
  for (const model of MODELS) {
    const times: number[] = []
    let last = ''
    for (let i = 0; i < 3; i++) {
      const t = Date.now()
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 300, temperature: 0.3, tools: TOOLS, messages: [{ role: 'system', content: resolved!.systemPrompt }, { role: 'user', content: user }] }),
        })
        const j = (await r.json()) as any
        const m = j.choices?.[0]?.message
        last = m?.tool_calls?.[0]?.function?.name ?? ('TEXT:' + String(m?.content ?? j.error?.message ?? '').slice(0, 60))
      } catch (e) { last = 'ERR ' + String(e) }
      times.push(Date.now() - t)
    }
    console.log(`### ${model} :: ${times.join('/')}ms :: ${last}`)
  }
}, 180000)
