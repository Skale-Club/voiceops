// Simulates what Vapi does when a call is answered - a status-update at
// in-progress to /api/vapi/calls - then, a few seconds later, the
// lookup_customer tool call to /api/vapi/tools, exactly as the model would
// make it. Proves the warm-up in production: the tool call should come back
// in well under a second instead of 3-4.5s. Read-only against the provider.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const PHONE = '+15088018190'
it('status-update warms the lookup the tool call then finds', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const secret: string = list.map((a) => a.server?.headers?.['x-vapi-secret']).find(Boolean)
  const callId = 'warm-' + Date.now()
  const H = { 'content-type': 'application/json', 'x-vapi-secret': secret }

  const t0 = Date.now()
  const su = await fetch('https://xphere.app/api/vapi/calls', { method: 'POST', headers: H, body: JSON.stringify({ message: { type: 'status-update', status: 'in-progress', call: { id: callId, assistantId: ASSISTANT_ID, customer: { number: PHONE } } } }) })
  console.log(`### status-update HTTP ${su.status} in ${Date.now() - t0}ms`)

  await new Promise((r) => setTimeout(r, 6000))

  const t1 = Date.now()
  const tc = { id: 'toolu_warm', type: 'function', function: { name: 'lookup_customer', arguments: JSON.stringify({ phone: PHONE }) } }
  const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: H, body: JSON.stringify({ message: { type: 'tool-calls', call: { id: callId, assistantId: ASSISTANT_ID, customer: { number: PHONE } }, toolCallList: [tc] } }) })
  const j = (await r.json()) as any
  console.log(`### lookup_customer after warm-up: HTTP ${r.status} | ${Date.now() - t1}ms | ${String(j.results?.[0]?.result ?? '').slice(0, 80)}`)
}, 120000)
