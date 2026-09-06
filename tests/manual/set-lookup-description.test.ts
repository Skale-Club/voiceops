// Tenant data: lookup_customer's description and its `phone` field tell the
// model the server binds the lookup to the number on the line. Dry run unless
// APPLY=1. Mirrors into the canary JSON.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const GRAPH = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
const DESCRIPTION = 'Looks up the customer calling, by the number on the line, and lists their upcoming appointments with services and staff. Only ever the caller: it cannot look up anyone else, and no argument is needed on a phone call. Never asks for or reads out a phone number, email or address.'
const PHONE_FIELD = 'Ignored on phone calls: the server uses the number the customer is calling from. Leave it out.'
it.skipIf(!ORG_ID)('sets the lookup description', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('id, description, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', 'lookup_customer').is('deleted_at', null).maybeSingle()
  const { data: cur } = await s.from('workflow_versions').select('version_number, definition').eq('id', wf!.current_version_id!).maybeSingle()
  const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
  const schema = def.trigger.config.input_schema as Record<string, any>
  console.log(`### description now: ${wf!.description}`)
  console.log(`### phone field now: ${JSON.stringify(schema.phone)}`)
  const descChanged = wf!.description !== DESCRIPTION
  const fieldChanged = schema.phone && schema.phone.description !== PHONE_FIELD
  if (!descChanged && !fieldChanged) { console.log('### unchanged'); return }
  if (schema.phone) { schema.phone = { ...schema.phone, description: PHONE_FIELD, required: false } }
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  if (descChanged) {
    const { error } = await s.from('workflows').update({ description: DESCRIPTION }).eq('id', wf!.id)
    if (error) throw new Error(error.message)
  }
  if (fieldChanged) {
    const { data: nv, error } = await s.from('workflow_versions').insert({ workflow_id: wf!.id, version_number: cur!.version_number + 1, definition: def, notes: 'phone field: bound to the caller on the server.' }).select('id').single()
    if (error || !nv) throw new Error(error?.message)
    await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf!.id)
    console.log(`### -> v${cur!.version_number + 1}`)
  }
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
  const w = graph.workflows.find((x: { tool_name: string }) => x.tool_name === 'lookup_customer')
  if (w) { w.description = DESCRIPTION; if (w.input_schema?.phone) w.input_schema.phone = { ...w.input_schema.phone, description: PHONE_FIELD, required: false } }
  writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n')
  console.log('### APPLIED')
}, 60000)
