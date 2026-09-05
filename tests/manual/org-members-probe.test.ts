import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('members of the demo org', async () => {
  const s = createServiceRoleClient()
  const { data, error } = await s.from('org_members').select('user_id, role, created_at').eq('organization_id', ORG_ID)
  console.log('### MEMBERS ' + (error ? 'ERR ' + error.message : JSON.stringify(data)))
  const { data: et } = await s.from('event_types').select('id, name, user_id, org_id').eq('org_id', ORG_ID).limit(5)
  console.log('### EVENT_TYPES ' + JSON.stringify(et))
}, 60000)
