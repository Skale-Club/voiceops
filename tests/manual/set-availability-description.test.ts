// Tenant data: check_availability's tool description tells the model to call
// it only for a day the caller named, and now also how to ask for the next
// opening (VOICE-CALL-4-PLAN.md item C: "how soon" must use the range shape,
// not a guessed single date). Mirrors into the canary JSON. APPLY=1 writes.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const GRAPH = '.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json'
const SUFFIX = ' Call it ONLY for a date the customer named out loud, one date per call - never for today, tomorrow or a guessed day on your own, and never before the customer answered "what day works for you?". The date of an existing booking returned by lookup_customer is not a date the customer named. For "how soon", "earliest" or "first opening", pass startDate=today and endDate=today+14 instead of date.'
// The marker below is the newest clause added to SUFFIX -- checking for it
// (not the older "existing booking" clause) keeps this idempotent across
// this exact revision without falsely reporting "unchanged" for a
// description that still carries only the pre-range-shape wording.
const UNCHANGED_MARKER = 'startDate=today and endDate=today+14'
it.skipIf(!ORG_ID)('sets the availability description', async () => {
  const s = createServiceRoleClient()
  const { data: wf } = await s.from('workflows').select('id, description').eq('org_id', ORG_ID!).eq('tool_name', 'check_availability').is('deleted_at', null).maybeSingle()
  console.log('### now: ' + wf!.description)
  if (wf!.description?.includes(UNCHANGED_MARKER)) { console.log('### unchanged'); return }
  const next = (wf!.description ?? 'Check available time slots for a service on a date.').replace(/ Call it ONLY for a date[\s\S]*$/, '').trim() + SUFFIX
  console.log('### next: ' + next)
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { error } = await s.from('workflows').update({ description: next }).eq('id', wf!.id)
  if (error) throw new Error(error.message)
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'))
  const w = graph.workflows.find((x: { tool_name: string }) => x.tool_name === 'check_availability')
  if (w) w.description = next
  writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n')
  console.log('### APPLIED')
}, 60000)
