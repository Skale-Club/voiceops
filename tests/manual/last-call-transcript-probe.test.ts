// Read-only: the most recent call on the Cuts & Culture assistant - transcript,
// tool calls with timing, ended reason - straight from Vapi, plus the Xphere
// calls row if the end-of-call report arrived.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
it('dumps the last call', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const calls = (await (await fetch(`https://api.vapi.ai/call?assistantId=${ASSISTANT_ID}&limit=1`, { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  const c = calls?.[0]
  if (!c) { console.log('### NO CALLS'); return }
  console.log('### CALL ' + JSON.stringify({ id: c.id, createdAt: c.createdAt, startedAt: c.startedAt, endedAt: c.endedAt, status: c.status, endedReason: c.endedReason, from: c.customer?.number, cost: c.cost }))
  const started = c.startedAt ? new Date(c.startedAt).getTime() : null
  const msgs = (c.messages ?? c.artifact?.messages ?? []) as any[]
  for (const m of msgs) {
    const t = typeof m.secondsFromStart === 'number' ? m.secondsFromStart.toFixed(1) + 's' : (m.time && started ? ((m.time - started) / 1000).toFixed(1) + 's' : '')
    if (m.role === 'tool_calls' || m.type === 'tool-calls') {
      const tc = (m.toolCalls ?? []).map((x: any) => `${x.function?.name}(${x.function?.arguments})`).join('; ')
      console.log(`### [${t}] TOOL_CALL ${tc}`)
    } else if (m.role === 'tool_call_result' || m.type === 'tool-call-result') {
      console.log(`### [${t}] TOOL_RESULT ${String(m.result ?? m.content ?? '').slice(0, 160).replace(/\n/g, ' ')}`)
    } else if (m.role === 'user' || m.role === 'bot' || m.role === 'assistant') {
      console.log(`### [${t}] ${m.role.toUpperCase()}: ${String(m.message ?? m.content ?? '').replace(/\n/g, ' ')}`)
    } else if (m.role !== 'system') {
      console.log(`### [${t}] ${m.role}: ${JSON.stringify(m).slice(0, 120)}`)
    }
  }
  const { data: row } = await s.from('calls').select('created_at, status, duration_seconds, ended_reason').eq('organization_id', ORG_ID).order('created_at', { ascending: false }).limit(1).maybeSingle()
  console.log('### XPHERE_ROW ' + JSON.stringify(row))
}, 60000)
