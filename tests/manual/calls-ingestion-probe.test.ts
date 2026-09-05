// Read-only: are end-of-call reports for the Cuts & Culture assistant
// reaching Xphere at all (the assistant has no assistant-level server block)?
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps recent calls rows for the org', async () => {
  const s = createServiceRoleClient()
  const since = new Date(Date.now() - 7 * 86400e3).toISOString()
  const { data, error } = await s.from('calls').select('*').eq('organization_id', ORG_ID).gte('created_at', since).order('created_at', { ascending: false }).limit(5)
  if (error) { console.log('### ERR ' + error.message); return }
  console.log('### CALLS_7D ' + (data?.length ?? 0))
  for (const c of data ?? []) { const o = c as Record<string, unknown>; console.log('### CALL ' + JSON.stringify({ created_at: o.created_at, status: o.status, direction: o.direction, duration: o.duration_seconds ?? o.duration, ended_reason: o.ended_reason, has_transcript: !!o.transcript, assistant: o.vapi_assistant_id ?? o.assistant_id })) }
}, 60000)
