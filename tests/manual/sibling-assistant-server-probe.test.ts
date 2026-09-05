// Read-only: the per-tool server blocks (URL, secret fingerprint) on the
// OTHER assistant in the same Vapi account, as a recovery source for the
// routing the push dropped. Prints fingerprints only, never the secret.
import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const fp = (v: string) => `sha256:${createHash('sha256').update(v).digest('hex').slice(0, 12)} len=${v.length}`
it('dumps sibling assistants server blocks', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  for (const a of list) {
    const tools = (a.model?.tools ?? []) as any[]
    const servers = tools.map((t) => t.server).filter(Boolean)
    const urls = new Set(servers.map((x) => x.url))
    const fps = new Set(servers.filter((x) => x.secret).map((x) => fp(String(x.secret))))
    console.log(`### ${a.id} "${a.name}" tools=${tools.length} withServer=${servers.length} urls=${JSON.stringify([...urls])} secretFps=${JSON.stringify([...fps])} assistantServer=${JSON.stringify(a.server ?? null)} timeout=${JSON.stringify(servers[0]?.timeoutSeconds ?? null)}`)
  }
}, 60000)
