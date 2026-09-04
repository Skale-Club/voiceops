import { it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('updates the Vapi assistant prompt and first-message mode', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG).eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const prompt = readFileSync(process.env.PROMPT_PATH!, 'utf8')
  const cur = await (await fetch(`https://api.vapi.ai/assistant/${ID}`, { headers: { Authorization: `Bearer ${key}` } })).json() as any
  const model = { ...cur.model, messages: [{ role: 'system', content: prompt }] }
  const r = await fetch(`https://api.vapi.ai/assistant/${ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, firstMessageMode: 'assistant-speaks-first-with-model-generated-message' }),
  })
  console.log('PATCH', r.status)
  const j = await r.json() as any
  console.log('firstMessageMode:', j.firstMessageMode)
  console.log('tools kept:', (j.model?.tools ?? []).length)
  console.log('prompt len:', String(j.model?.messages?.[0]?.content ?? '').length)
  if (!r.ok) console.log(JSON.stringify(j).slice(0, 400))
}, 60000)
