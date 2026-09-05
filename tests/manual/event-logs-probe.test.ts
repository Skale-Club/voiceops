import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('recent event_logs', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 45 * 60e3).toISOString()
  const { data, error } = await s.from('event_logs').select('*').eq('org_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: false }).limit(12)
  if (error) { console.log('### ERR ' + error.message); return }
  for (const r of (data ?? []) as Record<string, unknown>[]) console.log('### LOG ' + JSON.stringify({ at: String(r.created_at).slice(11, 19), type: r.event_type, source: r.source, status: r.status, sev: r.severity, err: r.error_message }).slice(0, 260))
  console.log('### COUNT ' + (data?.length ?? 0))
}, 60000)
