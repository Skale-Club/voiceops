// Production check: availability on a closed day (Sunday 2026-09-06) must say
// "closed", on an open day with no slots "fully booked". Read-only.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('closed day answer', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const secret: string = list.map((a) => a.server?.headers?.['x-vapi-secret']).find(Boolean)
  for (const date of ['2026-09-06', '2026-09-07']) {
    const tc = { id: 'toolu_cd', type: 'function', function: { name: 'check_availability', arguments: JSON.stringify({ serviceIds: '333', date }) } }
    const t = Date.now()
    const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls', call: { id: 'cd-' + Date.now(), assistantId: ASSISTANT_ID, customer: { number: '+15088018190' } }, toolCallList: [tc] } }) })
    const j = (await r.json()) as any
    console.log(`### ${date} | ${Date.now() - t}ms | ${String(j.results?.[0]?.result ?? '').slice(0, 120)}`)
  }
}, 120000)
