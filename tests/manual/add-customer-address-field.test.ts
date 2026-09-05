// Tenant data fix for Phase 138: the live book_appointment workflow's trigger
// input_schema has no customerAddress field, so applyServiceLocationMode()
// has nothing to require for an at_customer org and nothing to hide for an
// on_premises one - the modality rule was vacuous for this tenant, and every
// org installed from its template would inherit the gap. Adds the field as a
// NEW workflow_versions row (append-only, version_number = max + 1) and
// repoints current_version_id. The Xkedule create-booking action already
// forwards customerAddress as `address`. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const APPLY = process.env.APPLY === '1'

it.skipIf(!ORG_ID)('adds customerAddress to book_appointment input_schema', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('id, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', 'book_appointment').is('deleted_at', null).maybeSingle()
  if (!wf?.current_version_id) throw new Error('no book_appointment workflow / current version')

  const { data: cur } = await s.from('workflow_versions').select('id, version_number, definition').eq('id', wf.current_version_id).maybeSingle()
  const { data: latest } = await s.from('workflow_versions').select('version_number').eq('workflow_id', wf.id).order('version_number', { ascending: false }).limit(1)
  const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
  const schema = def.trigger?.config?.input_schema as Record<string, unknown>
  if (!schema) throw new Error('definition has no trigger.config.input_schema')
  console.log('### CURRENT version=' + cur!.version_number + ' keys=' + Object.keys(schema).join(','))
  if ('customerAddress' in schema) { console.log('### ALREADY PRESENT'); return }

  schema.customerAddress = {
    type: 'string',
    description: "Customer's service address. Only collected when this business travels to the customer; the engine decides whether to ask.",
  }
  const nextVersion = (latest?.[0]?.version_number ?? cur!.version_number) + 1
  console.log('### PLAN insert version ' + nextVersion + ' with keys=' + Object.keys(schema).join(','))
  if (!APPLY) { console.log('### DRY RUN, nothing written'); return }

  const { data: nv, error } = await s.from('workflow_versions').insert({
    workflow_id: wf.id, version_number: nextVersion, definition: def,
    notes: 'Phase 138: add customerAddress to input_schema so service_location_mode has a field to require or hide.',
  }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  const { error: e2 } = await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf.id)
  if (e2) throw new Error(e2.message)
  console.log('### APPLIED version ' + nextVersion + ' id=' + nv.id)
}, 60000)
