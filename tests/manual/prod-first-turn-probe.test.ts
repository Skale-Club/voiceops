import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
it('prod: the two calls a real conversation makes first, in the nested shape Vapi sends', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = await (await fetch('https://api.vapi.ai/assistant/99518fa7-09f1-4c76-b7c8-58cd8a92105c', { headers: { Authorization: `Bearer ${key}` } })).json() as any
  const secret: string = (a.model?.tools ?? []).find((t: any) => t.server?.secret)?.server.secret
  const call = { id: 'ft-' + Date.now(), assistantId: '99518fa7-09f1-4c76-b7c8-58cd8a92105c', customer: { number: '+15088018190' } }
  const nested = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  const cases: Array<[string, unknown]> = [
    ['lookup_customer', nested('toolu_1', 'lookup_customer', { phone: '+15088018190' })],
    ['check_availability', nested('toolu_2', 'check_availability', { serviceIds: [333], startDate: '2026-09-08', endDate: '2026-09-08' })],
  ]
  for (const [label, tc] of cases) {
    const t = Date.now()
    const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls', call, toolCallList: [tc] } }) })
    const j = await r.json() as any
    console.log(`### ${label}: HTTP ${r.status} | ${Date.now() - t}ms | results=${j.results?.length ?? 'n/a'} | id=${j.results?.[0]?.toolCallId} | ${String(j.results?.[0]?.result ?? '').slice(0, 140)}`)
  }
}, 120000)
