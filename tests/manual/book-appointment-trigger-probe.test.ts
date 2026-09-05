// Read-only: the trigger node of the live book_appointment definition, to
// see the exact shape an input_schema field takes. Excluded from the glob.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps the trigger', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('current_version_id').eq('org_id', ORG_ID).eq('tool_name', 'book_appointment').is('deleted_at', null).maybeSingle()
  const { data: v } = await s.from('workflow_versions').select('id, definition').eq('id', wf!.current_version_id!).maybeSingle()
  const def = v?.definition as Record<string, any>
  console.log('### VID ' + v?.id)
  console.log('### TRIGGER ' + JSON.stringify(def.trigger))
  const nodes = def.nodes as any[]
  console.log('### NODES ' + JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, action_type: n.config?.action_type ?? n.action_type, argKeys: Object.keys(n.config?.args ?? n.config?.params ?? n.args ?? {}) }))))
  const action = nodes.find((n) => JSON.stringify(n).includes('xkedule_create_booking'))
  console.log('### ACTION_NODE ' + JSON.stringify(action).slice(0, 1500))
}, 60000)
