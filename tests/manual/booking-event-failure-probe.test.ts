import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('looks for emitter failures and dispatches', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 40 * 60e3).toISOString()
  for (const table of ['system_logs', 'activity_logs', 'logs', 'audit_logs']) {
    const { data, error } = await s.from(table as never).select('*').eq('org_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: false }).limit(8)
    if (error) { console.log('### ' + table + ' ERR ' + error.message.slice(0, 80)); continue }
    for (const r of (data ?? []) as Record<string, unknown>[]) console.log('### ' + table + ' ' + JSON.stringify({ at: r.created_at, type: r.event_type ?? r.type, source: r.source, status: r.status, err: r.error_message }).slice(0, 220))
  }
  const { data: ev } = await s.from('event_dispatches').select('id, event_type, dispatched_at, workflow_ids').eq('org_id', ORG_ID).like('event_type', 'meeting.%').order('id', { ascending: false }).limit(3)
  console.log('### MEETING_DISPATCHES ' + JSON.stringify(ev))
}, 60000)
