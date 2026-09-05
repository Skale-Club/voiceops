// Sets the Vapi assistant's model (provider stays openrouter). Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const MODEL = process.env.VAPI_MODEL ?? 'anthropic/claude-sonnet-4.6'
it('sets the model', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: H })).json()) as any
  console.log('### NOW ' + JSON.stringify({ provider: a.model?.provider, model: a.model?.model, temperature: a.model?.temperature }))
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const r = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { method: 'PATCH', headers: H, body: JSON.stringify({ model: { ...a.model, model: MODEL, temperature: 0.3 } }) })
  console.log('### PATCH ' + r.status + (r.ok ? '' : ' ' + (await r.text()).slice(0, 200)))
}, 60000)
