// Read-only: did any real call hit the Cuts & Culture assistant while its
// tools had no routing (first push ~03:25Z until the restore)?
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('lists calls since the first push', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const since = '2026-09-05T03:20:00.000Z'
  const calls = (await (await fetch(`https://api.vapi.ai/call?assistantId=${ASSISTANT_ID}&createdAtGt=${since}&limit=50`, { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  console.log('### CALLS_SINCE_PUSH ' + (Array.isArray(calls) ? calls.length : JSON.stringify(calls).slice(0, 200)))
  for (const c of Array.isArray(calls) ? calls : []) console.log('### CALL ' + JSON.stringify({ at: c.createdAt, status: c.status, endedReason: c.endedReason, durationS: c.duration ?? null, toolCalls: (c.messages ?? []).filter((m: any) => m.role === 'tool_calls' || m.type === 'tool-calls').length }))
}, 60000)
