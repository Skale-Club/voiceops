// Read-only: full stored prompts of the entry orchestrator and the
// availability specialist, to see how a handoff is supposed to carry the
// service the customer already named.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps two prompts', async () => {
  const s = createServiceRoleClient()
  for (const slug of ['cc-entry-orchestrator', 'cc-availability-specialist']) {
    const { data: a } = await s.from('agents').select('active_prompt_version_id').eq('organization_id', ORG_ID).eq('slug', slug).maybeSingle()
    const { data: pv } = await s.from('agent_prompt_versions').select('system_prompt').eq('id', a!.active_prompt_version_id!).maybeSingle()
    console.log(`### ${slug} >>>\n${pv?.system_prompt}\n<<< end ${slug}`)
  }
  const { data: edges } = await s.from('agent_partners').select('invocation_description, partner_agent_id, agents!agent_partners_partner_agent_id_fkey(slug)').eq('organization_id', ORG_ID)
  console.log('### EDGES ' + JSON.stringify(edges).slice(0, 1500))
}, 60000)
