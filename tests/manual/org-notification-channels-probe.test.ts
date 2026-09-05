// Read-only: does the demo org have anything to send a booking confirmation
// with (SMS number, WhatsApp, email), and which booking-related workflows it
// has and whether they are active.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps channels and booking workflows', async () => {
  const s = createServiceRoleClient()
  const { data: ints } = await s.from('integrations').select('provider, is_active').eq('organization_id', ORG_ID)
  console.log('### INTEGRATIONS ' + JSON.stringify(ints))
  const { data: nums } = await s.from('phone_numbers').select('number, provider, is_active, capabilities').eq('organization_id', ORG_ID).limit(5)
  console.log('### PHONE_NUMBERS ' + JSON.stringify(nums))
  const { data: wfs } = await s.from('workflows').select('name, slug, kind, trigger_type, trigger_config, is_active').eq('org_id', ORG_ID).is('deleted_at', null).or('name.ilike.%confirm%,name.ilike.%booking%,slug.ilike.%booking%,trigger_type.ilike.%event%')
  for (const w of wfs ?? []) console.log('### WF ' + JSON.stringify({ name: w.name, slug: w.slug, kind: w.kind, trigger: w.trigger_type, cfg: JSON.stringify(w.trigger_config).slice(0, 120), active: w.is_active }))
  const { data: last } = await s.from('workflow_runs').select('created_at, status, trigger_type, workflow_id').eq('org_id', ORG_ID).order('created_at', { ascending: false }).limit(5)
  console.log('### LAST_RUNS ' + JSON.stringify(last))
}, 60000)
