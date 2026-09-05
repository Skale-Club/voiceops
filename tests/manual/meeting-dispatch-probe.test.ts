import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('latest meeting.* dispatches', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('event_dispatches').select('id, event_type, source_id, workflow_ids, dispatched_at, payload').eq('org_id', ORG_ID).like('event_type', 'meeting.%').order('id', { ascending: false }).limit(3)
  for (const e of data ?? []) console.log('### EV ' + JSON.stringify({ event: e.event_type, at: e.dispatched_at, wfs: e.workflow_ids, payload: JSON.stringify(e.payload).slice(0, 200) }))
  console.log('### COUNT ' + (data?.length ?? 0))
  const { data: c } = await s.from('contacts').select('id, first_name, last_name, phone, created_at').eq('org_id', ORG_ID).order('created_at', { ascending: false }).limit(2)
  console.log('### CONTACTS ' + JSON.stringify(c))
}, 60000)
