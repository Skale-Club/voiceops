// Proves production /api/vapi/tools accepts the webhook secret the sibling
// assistants carry at assistant level, by sending one read-only tool call
// (lookup_customer) in the nested shape Vapi uses. Prints only fingerprints.
import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const fp = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 12)
it('production accepts the account-level secret', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const secret: string | undefined = list.map((a) => a.server?.headers?.['x-vapi-secret']).find(Boolean)
  if (!secret) throw new Error('no assistant-level secret found in the account')
  console.log('### SECRET_FP ' + fp(secret) + ' len=' + secret.length)
  const call = { id: 'chk-' + Date.now(), assistantId: '99518fa7-09f1-4c76-b7c8-58cd8a92105c', customer: { number: '+15088018190' } }
  const tc = { id: 'toolu_chk', type: 'function', function: { name: 'lookup_customer', arguments: JSON.stringify({ phone: '+15088018190' }) } }
  for (const [label, hdr] of [['with-secret', secret], ['wrong-secret', 'nope']] as const) {
    const t = Date.now()
    const r = await fetch('https://xphere.app/api/vapi/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': hdr }, body: JSON.stringify({ message: { type: 'tool-calls', call, toolCallList: [tc] } }) })
    const j = (await r.json()) as any
    console.log(`### ${label}: HTTP ${r.status} | ${Date.now() - t}ms | results=${j.results?.length ?? 'n/a'} | ${String(j.results?.[0]?.result ?? '').slice(0, 100)}`)
  }
}, 120000)
