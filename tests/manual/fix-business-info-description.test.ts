// One-off tenant data fix: the business_info workflow's description still
// said "INACTIVE until the xkedule_business_info action ships" — the action
// shipped long ago (measured at 0.15-1.9s in this workstream), and that text
// now reaches the Vapi assistant as the function description, where it would
// steer the model away from calling it. Excluded from the default glob.

import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID

it.skipIf(!ORG_ID)('replaces the stale business_info description', async () => {
  const s = createServiceRoleClient()
  const { data: before } = await s
    .from('workflows')
    .select('id, tool_name, description')
    .eq('org_id', ORG_ID!)
    .eq('tool_name', 'business_info')
    .is('deleted_at', null)
  console.log('### BEFORE ' + JSON.stringify(before))
  if (!before || before.length !== 1) throw new Error('expected exactly one business_info workflow')

  const { error } = await s
    .from('workflows')
    .update({
      description:
        'Opening hours, address, and cancellation/no-show policy. Use it when the caller asks where the business is, when it is open, or what happens if they cancel or miss an appointment.',
    })
    .eq('id', before[0].id)
  if (error) throw error

  const { data: after } = await s.from('workflows').select('tool_name, description').eq('id', before[0].id)
  console.log('### AFTER ' + JSON.stringify(after))
}, 60000)
