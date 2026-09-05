// Measures each READ tool through the production /api/vapi/tools endpoint,
// exactly as Vapi calls it (nested shape, real secret), two runs each. No
// writes. Prints latency only.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('production per-tool latency', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const secret: string = list.map((a) => a.server?.headers?.['x-vapi-secret']).find(Boolean)
  const cases: Array<[string, Record<string, unknown>]> = [
    ['lookup_customer', { phone: '+15088018190' }],
    ['business_info', {}],
    ['list_services', {}],
    ['get_quote', { serviceIds: '333' }],
    ['check_availability', { serviceIds: '333', date: '2026-09-08' }],
  ]
  for (const [name, args] of cases) {
    const ms: number[] = []; let last = ''
    for (let i = 0; i < 2; i++) {
      const call = { id: `lat-${name}-${i}-${Date.now()}`, assistantId: ASSISTANT_ID, customer: { number: '+15088018190' } }
      const tc = { id: `toolu_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
      const t = Date.now()
      const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls', call, toolCallList: [tc] } }) })
      const j = (await r.json()) as any
      ms.push(Date.now() - t); last = String(j.results?.[0]?.result ?? '').slice(0, 80).replace(/\n/g, ' ')
    }
    console.log(`### ${name} :: ${ms.join('/')}ms :: ${last}`)
  }
}, 180000)
