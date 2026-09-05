// Read-only: the exact args and per-stage timings of every tool call in the
// last ~10 minutes on the voice route (workflow_tool_logs), to explain the
// availability misses and the booking write time seen in the call transcript.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps last voice tool calls', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 12 * 60e3).toISOString()
  const { data } = await s.from('workflow_tool_logs').select('*').eq('organization_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: true }).limit(20)
  for (const r of data ?? []) {
    const o = r as Record<string, unknown>
    console.log(`### ${(o.created_at as string).slice(11, 19)} ${o.tool_name} ms=${o.execution_ms} trigger=${o.trigger_type ?? ''} args=${JSON.stringify(o.request_payload ?? {}).slice(0, 160)}`)
  }
}, 60000)
