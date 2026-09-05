// End-to-end proof of the booking notification in PRODUCTION: books a real
// appointment through /api/vapi/tools exactly as the phone robot does, for
// the operator's own phone, then watches workflow_runs for the
// "Booking request received" run and reports its status. Creates a real
// booking in the demo calendar (cancel it afterwards). Requires APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const PHONE = process.env.TEST_SMS_TO ?? '+15087402109'
it.skipIf(process.env.APPLY !== '1')('books and watches for the request-received run', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const secret: string = list.map((a) => a.server?.headers?.['x-vapi-secret']).find(Boolean)
  const since = new Date().toISOString()
  const args = { serviceIds: '335', bookingDate: '2026-09-08', startTime: '11:40', customerName: 'Paul Joiner', customerPhone: PHONE, notes: 'SMS notification proof (test)' }
  const tc = { id: 'toolu_proof', type: 'function', function: { name: 'book_appointment', arguments: JSON.stringify(args) } }
  const t = Date.now()
  const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls', call: { id: 'proof-' + Date.now(), assistantId: ASSISTANT_ID, customer: { number: PHONE } }, toolCallList: [tc] } }) })
  const j = (await r.json()) as any
  console.log(`### BOOK ${r.status} | ${Date.now() - t}ms | ${String(j.results?.[0]?.result ?? '').slice(0, 120)}`)
  for (let i = 0; i < 12; i++) {
    await new Promise((res) => setTimeout(res, 5000))
    const { data: runs } = await s.from('workflow_runs').select('created_at, status, trigger_type, error_message, workflows(name)').eq('org_id', ORG_ID).gte('created_at', since).neq('trigger_type', 'vapi').order('created_at', { ascending: false }).limit(5)
    if (runs && runs.length > 0) { for (const x of runs) console.log('### RUN ' + JSON.stringify({ wf: (x as any).workflows?.name, status: x.status, error: x.error_message }).slice(0, 220)); if (runs.some((x) => x.status !== 'running' && x.status !== 'queued')) break }
  }
}, 180000)
