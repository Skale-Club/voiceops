// Read-only probe: dump what the live Cuts & Culture Vapi assistant carries
// today (system prompt, per-tool spoken messages) alongside what Xphere would
// push (entry orchestrator's active prompt version, the org's booking
// modality). Nothing here writes: no PATCH, no UPDATE.
//
// Excluded from the default vitest glob; run via `npm run test:manual`.

import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'

it('dumps live assistant config and the DB-side prompt it would be replaced by', async () => {
  const s = createServiceRoleClient()

  const { data: org } = await s
    .from('organizations')
    .select('name, business_type, service_location_mode')
    .eq('id', ORG_ID)
    .maybeSingle()
  console.log('### ORG: ' + JSON.stringify(org))

  const { data: defaults } = await s
    .from('agent_channel_defaults')
    .select('channel, agent_id')
    .eq('organization_id', ORG_ID)
  console.log('### CHANNEL DEFAULTS: ' + JSON.stringify(defaults))

  const { data: modes } = await s
    .from('agent_channel_routing_modes')
    .select('channel, mode')
    .eq('organization_id', ORG_ID)
  console.log('### ROUTING MODES: ' + JSON.stringify(modes))

  const voice = (defaults ?? []).find((d) => d.channel === 'voice')
  const widget = (defaults ?? []).find((d) => d.channel === 'web_widget')
  const entryId = voice?.agent_id ?? widget?.agent_id
  console.log('### ENTRY AGENT: ' + entryId)

  if (entryId) {
    const { data: agent } = await s
      .from('agents')
      .select('slug, name, active_prompt_version_id')
      .eq('id', entryId)
      .maybeSingle()
    console.log('### ENTRY AGENT ROW: ' + JSON.stringify(agent))

    if (agent?.active_prompt_version_id) {
      const { data: pv } = await s
        .from('agent_prompt_versions')
        .select('system_prompt')
        .eq('id', agent.active_prompt_version_id)
        .maybeSingle()
      console.log('### DB PROMPT START >>>')
      console.log(pv?.system_prompt ?? '(none)')
      console.log('<<< DB PROMPT END')
    }
  }

  const { data: integration } = await s
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', ORG_ID)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  const key = await decrypt(integration!.encrypted_api_key)
  const res = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const a = (await res.json()) as Record<string, any>

  console.log('### LIVE PROMPT START >>>')
  console.log(a.model?.messages?.[0]?.content ?? '(none)')
  console.log('<<< LIVE PROMPT END')

  const tools = (a.model?.tools ?? []) as any[]
  console.log('### LIVE TOOL COUNT: ' + tools.length)
  for (const t of tools) {
    console.log(
      '### TOOL ' +
        t.function?.name +
        ' :: params=' +
        Object.keys(t.function?.parameters?.properties ?? {}).join(',') +
        ' :: required=' +
        JSON.stringify(t.function?.parameters?.required ?? []) +
        ' :: messages=' +
        JSON.stringify(t.messages ?? [])
    )
  }
}, 120000)
