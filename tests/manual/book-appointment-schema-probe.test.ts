// Read-only: the live book_appointment workflow's input_schema, to see whether
// the customerAddress field Phase 138 depends on exists in the tenant's
// definition at all. Excluded from the default glob.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getWorkflowInputSchema } from '@/lib/workflows/derive-input-schema'

const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'

it('dumps the live book_appointment input schema', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('id, tool_name, kind, current_version_id').eq('org_id', ORG_ID).eq('tool_name', 'book_appointment').is('deleted_at', null).maybeSingle()
  console.log('### WF ' + JSON.stringify(wf))
  const { data: v } = await s.from('workflow_versions').select('definition').eq('id', wf!.current_version_id!).maybeSingle()
  const schema = getWorkflowInputSchema(v?.definition ?? null)
  console.log('### INPUT_SCHEMA_KEYS ' + Object.keys(schema).join(','))
  console.log('### HAS_customerAddress ' + ('customerAddress' in schema))
  const def = v?.definition as Record<string, unknown>
  console.log('### DEF_TOP_KEYS ' + Object.keys(def ?? {}).join(','))
  const actionNode = JSON.stringify(def).match(/"action_type":"([a-z_]+)"/g)
  console.log('### ACTION_TYPES ' + JSON.stringify(actionNode))
}, 60000)
