// Read-only: Vapi's own tool timeout on the live assistant (if it is shorter
// than our write timeout, Vapi gives up while the booking still completes),
// and whether the legacy widget agent has been invoked recently.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const LEGACY_AGENT = 'a971fa69-e975-41c1-acbc-e9a85e2dbd68'
it('dumps timeouts and legacy agent usage', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: { Authorization: `Bearer ${key}` } })).json()) as Record<string, any>
  console.log('### ASSISTANT_SERVER ' + JSON.stringify(a.server ?? null))
  console.log('### SERVER_URL_LEGACY ' + JSON.stringify({ serverUrl: a.serverUrl ?? null, serverUrlSecret: a.serverUrlSecret ? '(set)' : null }))
  for (const t of a.model?.tools ?? []) console.log('### TOOL_SERVER ' + t.function?.name + ' :: ' + JSON.stringify(t.server ?? null) + ' async=' + JSON.stringify(t.async ?? null))
  console.log('### MODEL_MISC ' + JSON.stringify({ toolIds: a.model?.toolIds ?? null, maxTokens: a.model?.maxTokens ?? null, temperature: a.model?.temperature ?? null }))
  console.log('### TRANSCRIBER ' + JSON.stringify(a.transcriber ?? null))
  console.log('### VOICE ' + JSON.stringify({ provider: a.voice?.provider, voiceId: a.voice?.voiceId }))
  console.log('### MISC ' + JSON.stringify({ firstMessageMode: a.firstMessageMode, firstMessage: a.firstMessage ?? null, silenceTimeoutSeconds: a.silenceTimeoutSeconds, maxDurationSeconds: a.maxDurationSeconds, backgroundSound: a.backgroundSound, startSpeakingPlan: a.startSpeakingPlan ?? null, stopSpeakingPlan: a.stopSpeakingPlan ?? null }))
  const since = new Date(Date.now() - 7 * 86400e3).toISOString()
  const { count } = await s.from('agent_invocations').select('id', { count: 'exact', head: true }).eq('agent_id', LEGACY_AGENT).gte('created_at', since)
  console.log('### LEGACY_AGENT_INVOCATIONS_7D ' + count)
}, 60000)
