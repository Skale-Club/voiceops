// Read-only: everything the live assistant carries that a real call depends
// on - model, first-message mode, server messages, and every function's
// description + parameters as Vapi will present them to the model.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('dumps voice readiness', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: { Authorization: `Bearer ${key}` } })).json()) as Record<string, any>
  const { model, ...rest } = a
  const { tools, messages, ...modelRest } = model ?? {}
  console.log('### MODEL ' + JSON.stringify(modelRest))
  console.log('### TOP ' + JSON.stringify({ firstMessageMode: rest.firstMessageMode, firstMessage: rest.firstMessage, serverMessages: rest.serverMessages ?? null, clientMessages: rest.clientMessages ?? null, silenceTimeoutSeconds: rest.silenceTimeoutSeconds ?? null, maxDurationSeconds: rest.maxDurationSeconds ?? null, endCallMessage: rest.endCallMessage ?? null, voicemailDetection: rest.voicemailDetection ? 'set' : null, transcriber: rest.transcriber ?? null, voice: rest.voice ?? null, startSpeakingPlan: rest.startSpeakingPlan ?? null, hipaaEnabled: rest.hipaaEnabled ?? null }))
  console.log('### PROMPT_HEAD ' + String(messages?.[0]?.content ?? '').slice(0, 160).replace(/\n/g, ' | '))
  console.log('### PROMPT_HAS_TOKEN ' + /{{(business_|service_location)/.test(String(messages?.[0]?.content ?? '')))
  for (const t of tools ?? []) {
    const p = t.function?.parameters ?? {}
    const props = Object.entries(p.properties ?? {}).map(([k, v]: [string, any]) => `${k}:${v.type}${(p.required ?? []).includes(k) ? '!' : ''}`).join(' ')
    console.log(`### FN ${t.function?.name} :: desc="${String(t.function?.description ?? '').slice(0, 140)}" :: ${props}`)
  }
}, 60000)
