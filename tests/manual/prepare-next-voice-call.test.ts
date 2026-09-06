// Scoped prompt publication. APPLY=1 appends a prompt version and syncs Vapi;
// default is read-only. Workflow guards and schemas must already be enabled.
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { pushAssistantConfig } from '@/lib/vapi/sync-assistant-config'

const org = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const assistant = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('prepares the next Cuts and Culture voice call', async () => {
  const s = createServiceRoleClient()
  const { data: d, error: de } = await s.from('agent_channel_defaults').select('agent_id').eq('organization_id', org).eq('channel', 'voice').single()
  if (de || !d) throw new Error(de?.message ?? 'No voice default')
  const { data: agent, error: ae } = await s.from('agents').select('id, slug, active_prompt_version_id').eq('organization_id', org).eq('id', d.agent_id).single()
  if (ae || !agent) throw new Error(ae?.message ?? 'No agent')
  expect(agent.slug).toBe('cc-voice-receptionist')
  for (const [tool, action] of [['book_appointment', 'xkedule_create_booking'], ['cancel_appointment', 'xkedule_cancel_booking'], ['reschedule_appointment', 'xkedule_reschedule_booking']]) {
    const { data: wf, error } = await s.from('workflows').select('current_version_id').eq('org_id', org).eq('tool_name', tool).is('deleted_at', null).single()
    if (error || !wf?.current_version_id) throw new Error(error?.message ?? 'Missing workflow')
    const { data: version, error: ve } = await s.from('workflow_versions').select('definition').eq('id', wf.current_version_id).single()
    if (ve || !version) throw new Error(ve?.message ?? 'Missing workflow version')
    const def = version.definition as any
    expect(def.trigger.config.input_schema.confirmed.type).toBe('boolean')
    expect(def.trigger.config.input_schema.confirmationToken.type).toBe('string')
    expect(def.nodes.find((n: any) => n.data?.action_type === action)?.data.config.require_voice_confirmation).toBe(true)
    console.log('### VERIFIED', tool, wf.current_version_id)
  }
  const prompt = readFileSync('.planning/workstreams/omnichannel-agent-orchestration/canary/vapi-receptionist-prompt.md', 'utf8').replace(/\r\n/g, '\n').trim()
  const { data: old, error: oe } = await s.from('agent_prompt_versions').select('system_prompt').eq('id', agent.active_prompt_version_id!).single()
  if (oe || !old) throw new Error(oe?.message ?? 'Missing active prompt')
  console.log('### PREPARED', { agent: agent.slug, changed: old.system_prompt.trim() !== prompt, apply: process.env.APPLY === '1' })
  if (process.env.APPLY !== '1') return
  if (old.system_prompt.trim() !== prompt) {
    const { data: latest, error: le } = await s.from('agent_prompt_versions').select('version').eq('agent_id', agent.id).order('version', { ascending: false }).limit(1)
    if (le) throw new Error(le.message)
    const version = (latest?.[0]?.version ?? 0) + 1
    const { data: nv, error } = await s.from('agent_prompt_versions').insert({ organization_id: org, agent_id: agent.id, version, system_prompt: prompt }).select('id').single()
    if (error || !nv) throw new Error(error?.message)
    const { data: updated, error: ue } = await s.from('agents').update({ active_prompt_version_id: nv.id }).eq('id', agent.id).eq('organization_id', org).eq('active_prompt_version_id', agent.active_prompt_version_id!).select('id').single()
    if (ue || !updated) throw new Error(ue?.message ?? 'Prompt changed concurrently; retry against current state')
    console.log('### PROMPT_VERSION', version)
  }
  const pushed = await pushAssistantConfig(s, org, assistant)
  expect(pushed.ok, JSON.stringify(pushed)).toBe(true)
  console.log('### PUSHED', { ok: pushed.ok, assistant })
}, 120000)
