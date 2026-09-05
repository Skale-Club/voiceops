// Read-only: what the orchestrator actually sent to each specialist in the
// last few widget turns (partner_calls rows), to see whether the service the
// customer named survived the handoff.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps recent partner calls', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 15 * 60e3).toISOString()
  const { data, error } = await s.from('partner_calls').select('*').eq('organization_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: true }).limit(10)
  if (error) { console.log('### ERR ' + error.message); return }
  for (const r of data ?? []) {
    const o = r as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => /request|input|message|payload|args|handoff|result|response|status|duration|partner|agent/i.test(k) && !/id$/.test(k))
    const picked: Record<string, unknown> = {}
    for (const k of keys) picked[k] = typeof o[k] === 'string' ? String(o[k]).slice(0, 300) : o[k]
    console.log('### PC ' + (o.created_at as string).slice(11, 19) + ' ' + JSON.stringify(picked).slice(0, 700))
  }
  console.log('### COUNT ' + (data?.length ?? 0))
}, 60000)
