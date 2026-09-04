import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
it('do the tools have request-start messages?', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = await (await fetch('https://api.vapi.ai/assistant/99518fa7-09f1-4c76-b7c8-58cd8a92105c', { headers: { Authorization: `Bearer ${key}` } })).json() as any
  for (const t of a.model?.tools ?? []) {
    const msgs = (t.messages ?? []).map((m: any) => `${m.type}:"${String(m.content ?? '').slice(0, 60)}"`)
    console.log(`### ${String(t.function?.name).padEnd(24)} messages=${msgs.length ? msgs.join(' | ') : 'NONE'}`)
  }
}, 60000)
