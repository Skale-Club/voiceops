// Tenant data: the model invented "unknown@example.com" in a rehearsal.
// Describe customerEmail (and customerName) so both channels stop guessing.
// New workflow version, append-only. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
it.skipIf(!ORG_ID)('describes customerEmail', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('id, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', 'book_appointment').is('deleted_at', null).maybeSingle()
  const { data: cur } = await s.from('workflow_versions').select('definition').eq('id', wf!.current_version_id!).maybeSingle()
  const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
  const schema = def.trigger.config.input_schema as Record<string, any>
  console.log('### customerEmail now ' + JSON.stringify(schema.customerEmail))
  schema.customerEmail = { type: 'string', description: 'Only if the customer explicitly gave an email address. Otherwise omit it entirely. Never invent or guess one.' }
  schema.customerName = { ...(schema.customerName ?? { type: 'string', required: true }), description: 'The customer\'s full name exactly as they gave it or as lookup_customer returned it. Never invent.' }
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { data: latest } = await s.from('workflow_versions').select('version_number').eq('workflow_id', wf!.id).order('version_number', { ascending: false }).limit(1)
  const { data: nv, error } = await s.from('workflow_versions').insert({ workflow_id: wf!.id, version_number: (latest?.[0]?.version_number ?? 1) + 1, definition: def, notes: 'customerEmail/customerName: never invented.' }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf!.id)
  console.log('### APPLIED')
}, 60000)
