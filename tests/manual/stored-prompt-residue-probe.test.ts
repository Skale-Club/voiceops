// Read-only: which STORED (un-rendered) active prompts still carry tenant
// facts as literal text after tokenisation - anything left here would be
// copied verbatim into every org installed from this tenant's template.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('finds literal tenant facts in stored prompts', async () => {
  const s = createServiceRoleClient()
  const { data: agents } = await s.from('agents').select('id, slug, active_prompt_version_id').eq('organization_id', ORG_ID).eq('is_active', true)
  for (const a of agents ?? []) {
    const { data: pv } = await s.from('agent_prompt_versions').select('system_prompt').eq('id', a.active_prompt_version_id!).maybeSingle()
    const p = pv?.system_prompt ?? ''
    const hits = p.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /Newbury|Boston|02116|224\) 551|Cuts|Culture/i.test(l))
    console.log(`### ${a.slug} :: hits=${hits.length}`)
    for (const [n, l] of hits) console.log(`###   L${n}: ${l.slice(0, 160)}`)
  }
}, 60000)
