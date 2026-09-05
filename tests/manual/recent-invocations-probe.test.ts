// Read-only: where the time went in the last widget turns - per-agent
// invocation durations and per-tool latencies for this org, last 20 minutes.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps recent invocations and tool latencies', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 20 * 60e3).toISOString()
  const { data: inv, error } = await s.from('agent_invocations').select('*').eq('organization_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: true }).limit(40)
  if (error) console.log('### INV_ERR ' + error.message)
  const { data: agents } = await s.from('agents').select('id, slug').eq('organization_id', ORG_ID)
  const slug = new Map((agents ?? []).map((a) => [a.id, a.slug]))
  for (const r of inv ?? []) {
    const o = r as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => /duration|latency|ms|status|channel|depth|parent|trace|error|outcome|started|completed|model/i.test(k))
    const picked: Record<string, unknown> = {}
    for (const k of keys) picked[k] = o[k]
    console.log('### INV ' + (o.created_at as string).slice(11, 23) + ' ' + slug.get(o.agent_id as string) + ' ' + JSON.stringify(picked).slice(0, 300))
  }
  const { data: logs, error: e2 } = await s.from('workflow_tool_logs').select('*').eq('organization_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: true }).limit(40)
  if (e2) console.log('### LOG_ERR ' + e2.message)
  for (const r of logs ?? []) {
    const o = r as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => /tool|duration|latency|ms|status|action|error|channel/i.test(k) && !/input|output|args|result/i.test(k))
    const picked: Record<string, unknown> = {}
    for (const k of keys) picked[k] = o[k]
    console.log('### TOOL ' + (o.created_at as string).slice(11, 23) + ' ' + JSON.stringify(picked).slice(0, 300))
  }
}, 60000)
