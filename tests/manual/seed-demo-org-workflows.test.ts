// Installs the platform-default workflow seeds into the demo org through the
// product's own seedOrgWorkflows() (idempotent by slug), then lists what the
// org has. Dry run (lists only) unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { seedOrgWorkflows } from '@/lib/workflows/seed-org'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
it.skipIf(!ORG_ID)('seeds the demo org', async () => {
  const s = createServiceRoleClient()
  if (process.env.APPLY === '1') { await seedOrgWorkflows(ORG_ID!); console.log('### SEEDED') } else console.log('### DRY RUN')
  const { data } = await s.from('workflows').select('name, slug, kind, trigger_type, trigger_config, is_active').eq('org_id', ORG_ID!).is('deleted_at', null).eq('kind', 'flow').order('name')
  for (const w of data ?? []) console.log('### WF ' + JSON.stringify({ name: w.name, trigger: (w.trigger_config as any)?.event ?? w.trigger_type, active: w.is_active }))
}, 120000)
