// Tenant data: book_appointment gains a `confirmed` boolean the engine gates
// on (two-phase booking: first call returns the read-back, second call with
// confirmed=true writes). Mirrors into the canary JSON. Dry run unless APPLY=1.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const GRAPH = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
const DESC = 'Set to true ONLY after the customer heard the full read-back (service, price, day, time, name) and answered the "anything else?" question with no. Leave it out on the first call: the tool then returns the read-back for you to say.'
it.skipIf(!ORG_ID)('adds confirmed', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('id, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', 'book_appointment').is('deleted_at', null).maybeSingle()
  const { data: cur } = await s.from('workflow_versions').select('definition').eq('id', wf!.current_version_id!).maybeSingle()
  const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
  const schema = def.trigger.config.input_schema as Record<string, any>
  console.log('### confirmed now ' + JSON.stringify(schema.confirmed))
  schema.confirmed = { type: 'boolean', description: DESC }
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { data: latest } = await s.from('workflow_versions').select('version_number').eq('workflow_id', wf!.id).order('version_number', { ascending: false }).limit(1)
  const { data: nv, error } = await s.from('workflow_versions').insert({ workflow_id: wf!.id, version_number: (latest?.[0]?.version_number ?? 1) + 1, definition: def, notes: 'confirmed: two-phase booking gate.' }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf!.id)
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
  const w = graph.workflows.find((x: { tool_name: string }) => x.tool_name === 'book_appointment')
  if (w) w.input_schema.confirmed = { type: 'boolean', description: DESC, required: false }
  writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n')
  console.log('### APPLIED')
}, 60000)
