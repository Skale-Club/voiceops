// Tenant data: the three write tools gain `confirmed` and `confirmationToken`
// in their trigger input_schema so Vapi renders them and the engine passes them
// through (voice consent gate, booking-confirmation.ts). Mirrors into the
// canary JSON. Dry run (prints current schemas) unless APPLY=1.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const GRAPH = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
const FIELDS: Record<string, Record<string, { type: string; description: string }>> = {
  book_appointment: {
    confirmed: { type: 'boolean', description: 'Set to true ONLY after the customer heard the full read-back (service, price, day, time, name) and answered the "anything else?" question with no. Leave it out on the first call: the tool then returns the read-back for you to say.' },
    confirmationToken: { type: 'string', description: 'Copy the confirmationToken from the previous NOT BOOKED YET response, with exactly the same other arguments. Never invent one, never say it aloud.' },
  },
  reschedule_appointment: {
    confirmed: { type: 'boolean', description: 'Set to true ONLY after the customer heard "moving your appointment to <day and time>" read back and answered "anything else?" with no. Leave it out on the first call: the tool then returns the read-back for you to say.' },
    confirmationToken: { type: 'string', description: 'Copy the confirmationToken from the previous NOT MOVED YET response, with exactly the same other arguments. Never invent one, never say it aloud.' },
  },
  cancel_appointment: {
    confirmed: { type: 'boolean', description: 'Set to true ONLY after the customer heard which appointment is being cancelled read back and answered "anything else?" with no. Leave it out on the first call: the tool then returns the read-back for you to say.' },
    confirmationToken: { type: 'string', description: 'Copy the confirmationToken from the previous NOT CANCELLED YET response, with exactly the same other arguments. Never invent one, never say it aloud.' },
  },
}
it.skipIf(!ORG_ID)('adds consent fields', async () => {
  const s = createServiceRoleClient()
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
  for (const [tool, fields] of Object.entries(FIELDS)) {
    const { data: wf } = await s.from('workflows').select('id, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', tool).is('deleted_at', null).maybeSingle()
    const { data: cur } = await s.from('workflow_versions').select('version_number, definition').eq('id', wf!.current_version_id!).maybeSingle()
    const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
    const schema = def.trigger.config.input_schema as Record<string, any>
    console.log(`### ${tool} v${cur!.version_number} schema keys: ${Object.keys(schema).join(', ')}`)
    let changed = false
    for (const [k, f] of Object.entries(fields)) {
      if (schema[k]?.description === f.description) continue
      schema[k] = { ...(schema[k] ?? {}), ...f }
      changed = true
    }
    const w = graph.workflows.find((x: { tool_name: string }) => x.tool_name === tool)
    if (w) for (const [k, f] of Object.entries(fields)) w.input_schema[k] = { ...f, required: false }
    if (!changed) { console.log(`###   unchanged`); continue }
    if (process.env.APPLY !== '1') continue
    const { data: nv, error } = await s.from('workflow_versions').insert({ workflow_id: wf!.id, version_number: cur!.version_number + 1, definition: def, notes: 'confirmed + confirmationToken: voice consent gate.' }).select('id').single()
    if (error || !nv) throw new Error(error?.message)
    await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf!.id)
    console.log(`###   -> v${cur!.version_number + 1}`)
  }
  if (process.env.APPLY === '1') { writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n'); console.log('### APPLIED') } else console.log('### DRY RUN')
}, 60000)
