import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const WF = '94e99787-4f8b-4e4a-a19c-dd847dfae991'
it('run and sms of the request-received workflow', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 20 * 60e3).toISOString()
  const { data: runs } = await s.from('workflow_runs').select('created_at, status, trigger_type, error_message, org_id').eq('workflow_id', WF).gte('created_at', since).order('created_at', { ascending: false }).limit(3)
  console.log('### RUNS ' + JSON.stringify(runs))
  const { data: logs } = await s.from('event_logs').select('created_at, event_type, status, payload, error_message').eq('org_id', ORG_ID).gte('created_at', since).in('event_type', ['action.executed', 'action.completed', 'action.failed']).order('created_at', { ascending: false }).limit(4)
  for (const l of logs ?? []) console.log('### ACTION ' + String(l.created_at).slice(11, 19) + ' ' + l.event_type + ' ' + l.status + ' ' + JSON.stringify(l.payload).slice(0, 260))
}, 60000)
