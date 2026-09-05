// Tenant data: activates the entry orchestrator prompt from
// canary/entry-orchestrator-prompt.md as a new, append-only prompt version,
// caps its max_tokens, and mirrors the same text into the canary JSON so the
// template source and the live rows agree. Dry run unless APPLY=1.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const SLUG = 'cc-entry-orchestrator'
const PROMPT_FILE = '.planning/workstreams/omnichannel-agent-orchestration/canary/entry-orchestrator-prompt.md'
const GRAPH_FILE = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
it.skipIf(!ORG_ID)('activates the orchestrator prompt', async () => {
  const prompt = readFileSync(PROMPT_FILE, 'utf8').replace(/\r\n/g, '\n').trim()
  if (!prompt.includes('{{business_location}}')) throw new Error('prompt must carry the tenant token')
  const s = createServiceRoleClient()
  const { data: a } = await s.from('agents').select('id, max_tokens, active_prompt_version_id').eq('organization_id', ORG_ID!).eq('slug', SLUG).maybeSingle()
  if (!a) throw new Error('orchestrator not found')
  const { data: cur } = await s.from('agent_prompt_versions').select('system_prompt').eq('id', a.active_prompt_version_id!).maybeSingle()
  console.log('### CURRENT_HEAD ' + String(cur?.system_prompt).slice(0, 80))
  console.log('### NEW_HEAD ' + prompt.slice(0, 80) + ' | chars=' + prompt.length + ' | max_tokens now=' + a.max_tokens)
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { data: vs } = await s.from('agent_prompt_versions').select('version').eq('agent_id', a.id).order('version', { ascending: false }).limit(1)
  const next = (vs?.[0]?.version ?? 0) + 1
  const { data: nv, error } = await s.from('agent_prompt_versions').insert({ organization_id: ORG_ID!, agent_id: a.id, version: next, system_prompt: prompt }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  const FALLBACK = 'Sorry, our calendar is taking longer than usual right now. Please ask me again in a moment and I will check it for you.'
  const { error: e2 } = await s.from('agents').update({ active_prompt_version_id: nv.id, max_tokens: 500, fallback_message: FALLBACK, ...(process.env.ORCH_MODEL ? { model: process.env.ORCH_MODEL } : {}) }).eq('id', a.id)
  if (e2) throw new Error(e2.message)
  const graph = JSON.parse(readFileSync(GRAPH_FILE, 'utf8'))
  const entry = graph.agents.find((x: { slug: string }) => x.slug === SLUG)
  entry.system_prompt = prompt
  writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2) + '\n')
  console.log('### APPLIED version ' + next + ', max_tokens 500, canary JSON mirrored')
}, 60000)
