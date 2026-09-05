// Tenant data fix: `cuts-culture-booking-agent-en` is the pre-mesh single
// widget agent. The widget channel default points at the entry orchestrator
// now, so it serves nothing, yet it stays active holding all eight direct
// grants including the three Xkedule writes - and an active agent is what an
// org template captures. Deactivates it (reversible). Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const SLUG = 'cuts-culture-booking-agent-en'
it.skipIf(!ORG_ID)('deactivates the legacy widget agent', async () => {
  const s = createServiceRoleClient()
  const { data: a } = await s.from('agents').select('id, slug, is_active').eq('organization_id', ORG_ID!).eq('slug', SLUG).maybeSingle()
  console.log('### BEFORE ' + JSON.stringify(a))
  if (!a) throw new Error('agent not found')
  const { data: d } = await s.from('agent_channel_defaults').select('channel').eq('organization_id', ORG_ID!).eq('agent_id', a.id)
  if ((d ?? []).length > 0) throw new Error('refusing: agent is still a channel default for ' + JSON.stringify(d))
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { error } = await s.from('agents').update({ is_active: false }).eq('id', a.id)
  if (error) throw error
  console.log('### APPLIED is_active=false')
}, 60000)
