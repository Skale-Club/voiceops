// Hits the PRODUCTION widget chat route for the Cuts & Culture org with one
// message and reports the reply, its latency, and whether any tenant-fact
// token leaked into it. Costs one inference. Excluded from the default glob.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const MESSAGE = process.env.WIDGET_MESSAGE ?? 'Hi, where are you located and what are your hours?'
it('production widget turn', async () => {
  const s = createServiceRoleClient()
  const { data: org } = await s.from('organizations').select('widget_token').eq('id', ORG_ID).maybeSingle()
  if (!org?.widget_token) throw new Error('org has no widget_token')
  const t = Date.now()
  const r = await fetch(`https://xphere.app/api/chat/${org.widget_token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: MESSAGE }) })
  const text = await r.text()
  let reply = text
  try { const j = JSON.parse(text); reply = j.reply ?? j.text ?? j.message ?? text } catch {}
  console.log(`### HTTP ${r.status} | ${Date.now() - t}ms | leaked=${/{{business_/.test(String(reply))}`)
  console.log('### REPLY ' + String(reply).slice(0, 500).replace(/\n/g, ' '))
}, 120000)
