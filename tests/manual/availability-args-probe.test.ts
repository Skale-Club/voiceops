// Read-only: the exact arguments the Availability specialist passed to
// check_availability in the last turns, and how long each call took.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps recent check_availability args', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 10 * 60e3).toISOString()
  const { data, error } = await s.from('workflow_tool_logs').select('*').eq('organization_id', ORG_ID).gte('created_at', since).eq('tool_name', 'check_availability').order('created_at', { ascending: false }).limit(4)
  if (error) { console.log('### ERR ' + error.message); return }
  for (const r of data ?? []) {
    const o = r as Record<string, unknown>
    const argKeys = Object.keys(o).filter((k) => /input|args|request|param|payload|output|result/i.test(k))
    const picked: Record<string, unknown> = {}
    for (const k of argKeys) picked[k] = typeof o[k] === 'string' ? String(o[k]).slice(0, 200) : o[k]
    console.log('### CA ' + (o.created_at as string).slice(11, 19) + ' ms=' + o.execution_ms + ' ' + JSON.stringify(picked).slice(0, 500))
  }
}, 60000)
