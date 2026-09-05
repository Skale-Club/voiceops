// Sets the mesh agents' models (tenant data) and mirrors them into the canary
// JSON so the template carries the same choice. Dry run unless APPLY=1.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const GRAPH = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
const PLAN: Record<string, string> = {
  'cc-entry-orchestrator': 'openai/gpt-5.1',
  'cc-voice-receptionist': 'openai/gpt-5.1',
  'cc-services-specialist': 'openai/gpt-5.1',
  'cc-pricing-specialist': 'openai/gpt-5.1',
  'cc-availability-specialist': 'openai/gpt-5.1',
  'cc-customer-specialist': 'openai/gpt-5.1',
  'cc-booking-specialist': 'openai/gpt-5.1',
}
it('sets agent models', async () => {
  const s = createServiceRoleClient()
  const { data: agents } = await s.from('agents').select('id, slug, model').eq('organization_id', ORG_ID).eq('is_active', true)
  for (const a of agents ?? []) console.log(`### ${a.slug}: ${a.model} -> ${PLAN[a.slug] ?? '(unchanged)'}`)
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  for (const a of agents ?? []) { if (PLAN[a.slug]) { const { error } = await s.from('agents').update({ model: PLAN[a.slug] }).eq('id', a.id); if (error) throw new Error(error.message) } }
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
  for (const g of graph.agents) if (PLAN[g.slug]) g.model = PLAN[g.slug]
  writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n')
  console.log('### APPLIED')
}, 60000)
