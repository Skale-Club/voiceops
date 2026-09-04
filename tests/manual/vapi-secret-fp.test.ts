import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const fp = (v: string) => `sha256:${createHash('sha256').update(v).digest('hex').slice(0, 12)} len=${v.length}`
it('fingerprint of the secret Vapi sends per tool', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = await (await fetch('https://api.vapi.ai/assistant/99518fa7-09f1-4c76-b7c8-58cd8a92105c', { headers: { Authorization: `Bearer ${key}` } })).json() as any
  const secrets = new Set<string>()
  for (const t of a.model?.tools ?? []) if (t.server?.secret) secrets.add(String(t.server.secret))
  console.log('### distinct tool secrets:', secrets.size)
  for (const sec of secrets) console.log('### VAPI tool secret fp:', fp(sec))
  console.log('### tools with server.url:', (a.model?.tools ?? []).filter((t: any) => t.server?.url).length, '/', (a.model?.tools ?? []).length)
}, 60000)
