// Read-only: the assistant configuration Vapi actually used on the last call
// (system prompt as rendered, transcriber, speaking plans, voice).
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('dumps the last call config', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const calls = (await (await fetch(`https://api.vapi.ai/call?assistantId=${ASSISTANT_ID}&limit=1`, { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const c = calls[0]
  const a = c.assistant ?? {}
  const sys = String(a.model?.messages?.[0]?.content ?? '')
  const idx = sys.indexOf("caller's number")
  console.log('### SYS_NUMBER_LINE ' + sys.slice(Math.max(0, idx - 40), idx + 90).replace(/\n/g, ' '))
  console.log('### SYS_HAS_RAW_TOKEN ' + sys.includes('{{customer.number}}') + ' has_real_number=' + sys.includes(String(c.customer?.number ?? '---')))
  console.log('### TRANSCRIBER ' + JSON.stringify(a.transcriber ?? null))
  console.log('### PLANS ' + JSON.stringify({ start: a.startSpeakingPlan ?? null, stop: a.stopSpeakingPlan ?? null, silence: a.silenceTimeoutSeconds ?? null, idle: a.messagePlan ?? null }))
  console.log('### VOICE ' + JSON.stringify(a.voice ?? null))
  console.log('### MODEL ' + JSON.stringify({ provider: a.model?.provider, model: a.model?.model, temperature: a.model?.temperature }))
  const sysMsg = (c.messages ?? []).find((m: any) => m.role === 'system')
  console.log('### CALL_SYS_HAS_TOKEN ' + (sysMsg ? String(sysMsg.message ?? sysMsg.content ?? '').includes('{{customer.number}}') : 'no system msg in call log'))
  const sm = sysMsg ? String(sysMsg.message ?? sysMsg.content ?? '') : ''
  const j = sm.indexOf("caller's number"); if (j >= 0) console.log('### CALL_SYS_LINE ' + sm.slice(j, j + 80))
}, 60000)
