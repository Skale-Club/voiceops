// Read-only: the orchestrator's generation settings and knowledge scope, and
// how many delegation edges / tools it is shown per turn.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps orchestrator config', async () => {
  const s = createServiceRoleClient()
  const { data: a } = await s.from('agents').select('id, slug, model, temperature, max_tokens, max_history, kb_scope, channel_overrides').eq('organization_id', ORG_ID).eq('slug', 'cc-entry-orchestrator').maybeSingle()
  console.log('### ORCH ' + JSON.stringify(a))
  const { count: edges } = await s.from('agent_partners').select('id', { count: 'exact', head: true }).eq('agent_id', a!.id)
  const { count: tools } = await s.from('agent_tools').select('id', { count: 'exact', head: true }).eq('agent_id', a!.id)
  const { count: docs } = await s.from('documents').select('id', { count: 'exact', head: true }).eq('organization_id', ORG_ID)
  console.log('### COUNTS ' + JSON.stringify({ edges, directTools: tools, orgDocuments: docs }))
  const { data: sp } = await s.from('agents').select('slug, model, temperature, max_tokens, kb_scope').eq('organization_id', ORG_ID).eq('is_active', true)
  console.log('### ALL ' + JSON.stringify(sp))
}, 60000)
