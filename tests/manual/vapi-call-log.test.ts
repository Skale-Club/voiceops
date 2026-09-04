import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const CALL = process.env.CALL_ID!
it('what Vapi actually sent and got back', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG).eq('provider', 'vapi').maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const H = { Authorization: `Bearer ${key}` }
  const call = await (await fetch(`https://api.vapi.ai/call/${CALL}`, { headers: H })).json() as any
  console.log('### call status:', call.status, '| endedReason:', call.endedReason)
  const msgs: any[] = call.messages ?? call.artifact?.messages ?? []
  console.log('### message roles:', msgs.map(m => m.role).join(' > '))
  for (const m of msgs) {
    if (m.role === 'tool_calls' || m.toolCalls) console.log('TOOL_CALL ->', JSON.stringify(m.toolCalls ?? m).slice(0, 300))
    if (m.role === 'tool_call_result' || m.role === 'tool') console.log('TOOL_RESULT <-', JSON.stringify({ name: m.name, result: m.result, error: m.error }).slice(0, 400))
  }
  const a = await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT}`, { headers: H })).json() as any
  const t0 = (a.model?.tools ?? [])[0]
  console.log('### tool[0].server:', JSON.stringify({ url: t0?.server?.url, hasSecret: !!t0?.server?.secret, timeoutSeconds: t0?.server?.timeoutSeconds }))
  console.log('### assistant.server:', JSON.stringify({ url: a.server?.url, hasSecret: !!a.server?.secret }))
  console.log('### assistant.serverMessages:', JSON.stringify(a.serverMessages ?? null))
  if (call.analysis) console.log('### analysis:', JSON.stringify(call.analysis).slice(0, 300))
}, 60000)
