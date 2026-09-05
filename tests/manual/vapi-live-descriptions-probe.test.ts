// Read-only: the function descriptions and the location rule the live
// assistant carries right now. Excluded from the default glob.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'

it('reads back live descriptions', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: { Authorization: `Bearer ${key}` } })).json()) as Record<string, any>
  for (const t of a.model?.tools ?? []) console.log('### DESC ' + t.function?.name + ' :: ' + t.function?.description)
  const p: string = a.model?.messages?.[0]?.content ?? ''
  console.log('### HAS_STATIC_RULE ' + p.includes("Do not ask for the caller's address, ever"))
  console.log('### HAS_ENGINE_RULE ' + p.includes('Service location: this business does not travel to the customer'))
  console.log('### MODEL ' + JSON.stringify({ provider: a.model?.provider, model: a.model?.model, tools: (a.model?.tools ?? []).length }))
}, 60000)
