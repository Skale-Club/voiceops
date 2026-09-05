// Tenant data: the widget's Booking specialist must know the two-phase gate.
// Appends the rule to its active prompt as a new version and mirrors the
// canary JSON. Dry run unless APPLY=1.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const SLUG = 'cc-booking-specialist'
const GRAPH = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
const RULE = `
TWO-PHASE BOOKING (engine-enforced): book_appointment without confirmed: true does not book - it returns "NOT BOOKED YET" with the read-back. Call it with confirmed: true ONLY when the orchestrator's handoff states that the customer heard the read-back and answered "anything else?" with no. Otherwise call it without confirmed and relay the read-back it returns, word for word, so the orchestrator can ask. Never invent an email; leave customerEmail out unless one was given.`
it.skipIf(!ORG_ID)('updates the booking specialist prompt', async () => {
  const s = createServiceRoleClient()
  const { data: a } = await s.from('agents').select('id, active_prompt_version_id').eq('organization_id', ORG_ID!).eq('slug', SLUG).maybeSingle()
  const { data: cur } = await s.from('agent_prompt_versions').select('system_prompt').eq('id', a!.active_prompt_version_id!).maybeSingle()
  const before = cur!.system_prompt
  if (before.includes('TWO-PHASE BOOKING')) { console.log('### ALREADY'); return }
  const after = before.trimEnd() + '\n' + RULE + '\n'
  console.log('### APPEND ' + RULE.trim().slice(0, 80))
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { data: vs } = await s.from('agent_prompt_versions').select('version').eq('agent_id', a!.id).order('version', { ascending: false }).limit(1)
  const { data: nv, error } = await s.from('agent_prompt_versions').insert({ organization_id: ORG_ID!, agent_id: a!.id, version: (vs?.[0]?.version ?? 0) + 1, system_prompt: after }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  await s.from('agents').update({ active_prompt_version_id: nv.id }).eq('id', a!.id)
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
  const g = graph.agents.find((x: { slug: string }) => x.slug === SLUG)
  if (g) g.system_prompt = after
  writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n')
  console.log('### APPLIED')
}, 60000)
