import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
it('book_appointment schema on the Vapi side', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = await (await fetch('https://api.vapi.ai/assistant/99518fa7-09f1-4c76-b7c8-58cd8a92105c', { headers: { Authorization: `Bearer ${key}` } })).json() as any
  const t = (a.model?.tools ?? []).find((x: any) => x.function?.name === 'book_appointment')
  console.log('### vapi book_appointment params: ' + Object.keys(t?.function?.parameters?.properties ?? {}).join(', '))
  console.log('### required: ' + JSON.stringify(t?.function?.parameters?.required ?? []))
}, 60000)
