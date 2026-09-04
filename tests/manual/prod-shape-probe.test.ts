import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const fp = (v: string) => `sha256:${createHash('sha256').update(v).digest('hex').slice(0, 12)} len=${v.length}`
it('prod webhook: secret x payload shape', async () => {
  const s = createServiceRoleClient()
  const { data, error } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'vapi').maybeSingle()
  if (error || !data) { console.log('### integ error:', error?.message); return }
  const key = await decrypt(data.encrypted_api_key)
  const a = await (await fetch('https://api.vapi.ai/assistant/99518fa7-09f1-4c76-b7c8-58cd8a92105c', { headers: { Authorization: `Bearer ${key}` } })).json() as any
  const tool = (a.model?.tools ?? []).find((t: any) => t.function?.name === 'list_services')
  const secret: string | undefined = tool?.server?.secret
  console.log('### vapi tool secret present:', !!secret, secret ? fp(secret) : '')
  if (!secret) return
  const call = { id: 'shape-' + Date.now(), assistantId: '99518fa7-09f1-4c76-b7c8-58cd8a92105c', customer: { number: '+15088018190' } }
  const flat = { message: { type: 'tool-calls', call, toolCallList: [{ id: 'tc_flat', name: 'list_services', arguments: {} }] } }
  const nested = { message: { type: 'tool-calls', call, toolCallList: [{ id: 'tc_nested', type: 'function', function: { name: 'list_services', arguments: '{}' } }] } }
  for (const [label, body] of [['FLAT', flat], ['NESTED', nested]] as const) {
    const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify(body) })
    const j = await r.json() as any
    console.log(`### ${label}: HTTP ${r.status} | results=${j.results?.length ?? 'n/a'} | ${JSON.stringify(j.results?.[0] ?? null).slice(0, 160)}`)
  }
  const bad = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': 'definitely-wrong' }, body: JSON.stringify(flat) })
  console.log('### WRONG-SECRET control: results=', ((await bad.json()) as any).results?.length)
}, 120000)
