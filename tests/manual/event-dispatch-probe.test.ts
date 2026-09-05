// Read-only: did the booking emit meeting.requested (event_dispatches), and
// did a workflow run follow?
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps recent dispatches and runs', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 15 * 60e3).toISOString()
  const { data: ev, error } = await s.from('event_dispatches').select('*').eq('org_id', ORG_ID).order('id', { ascending: false }).limit(5)
  if (error) console.log('### EV_ERR ' + error.message)
  for (const e of ev ?? []) { const o = e as Record<string, unknown>; console.log('### EV ' + JSON.stringify({ created_at: o.created_at, event: o.event ?? o.event_type, status: o.status, source_id: o.source_id, error: o.error ?? o.last_error, attempts: o.attempts }).slice(0, 300)) }
  const { data: runs } = await s.from('workflow_runs').select('created_at, status, trigger_type, error_message, workflows(name)').eq('org_id', ORG_ID).gte('created_at', since).neq('trigger_type', 'vapi').order('created_at', { ascending: false }).limit(6)
  for (const r of runs ?? []) console.log('### RUN ' + JSON.stringify({ at: r.created_at, wf: (r as any).workflows?.name, status: r.status, error: r.error_message }).slice(0, 240))
  console.log('### COUNTS ev=' + (ev?.length ?? 0) + ' runs=' + (runs?.length ?? 0))
}, 60000)
