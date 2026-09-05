// Tenant + assistant tuning from the first real call (2026-09-05):
//  - check_availability schema: includeStaff only when the customer asks who
//    (the model sent it by default, missing the prefetched cache every time)
//  - lookup_customer: no spoken line (it is warmed at pickup, ~0.2s; "Let me
//    look you up" interrupted the caller's first sentence)
//  - the three writes: 60s timeout (a real booking took 24.4s) and a
//    "still working on it" line so the caller is not left in silence
// Dry run unless APPLY=1. Schema change is a new workflow version (append-only).
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const ASSISTANT_ID = process.env.VAPI_PUSH_TEST_ASSISTANT_ID
const WRITES = ['book_appointment', 'reschedule_appointment', 'cancel_appointment']
it.skipIf(!ORG_ID || !ASSISTANT_ID)('tunes availability schema and tool messages', async () => {
  const s = createServiceRoleClient()
  // 1. schema
  const { data: wf } = await s.from('workflows').select('id, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', 'check_availability').is('deleted_at', null).maybeSingle()
  const { data: cur } = await s.from('workflow_versions').select('definition').eq('id', wf!.current_version_id!).maybeSingle()
  const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
  const schema = def.trigger.config.input_schema as Record<string, any>
  console.log('### includeStaff now: ' + JSON.stringify(schema.includeStaff))
  schema.includeStaff = { type: 'boolean', description: 'Only when the customer asks WHO is available or wants to know which staff member takes a slot. Otherwise omit it.' }
  if (schema.staffId) schema.staffId = { ...schema.staffId, description: 'Staff id from list_services, when the customer asked for a specific person. Omit when anyone will do.' }
  // 2. assistant
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID!).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const a = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: H })).json()) as any
  const tools = (a.model?.tools ?? []).map((t: any) => {
    const name = t.function?.name
    if (name === 'lookup_customer') return { ...t, messages: [] }
    if (WRITES.includes(name)) {
      const msgs = (t.messages ?? []).filter((m: any) => m.type !== 'request-response-delayed')
      msgs.push({ type: 'request-response-delayed', content: 'Still working on that, one moment.', timingMilliseconds: 8000 })
      return { ...t, messages: msgs, server: { ...(t.server ?? {}), timeoutSeconds: 60 } }
    }
    return t
  })
  for (const t of tools) console.log(`### ${t.function?.name} timeout=${t.server?.timeoutSeconds} msgs=${(t.messages ?? []).map((m: any) => m.type).join('+') || 'none'}`)
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { data: latest } = await s.from('workflow_versions').select('version_number').eq('workflow_id', wf!.id).order('version_number', { ascending: false }).limit(1)
  const { data: nv, error } = await s.from('workflow_versions').insert({ workflow_id: wf!.id, version_number: (latest?.[0]?.version_number ?? 1) + 1, definition: def, notes: 'includeStaff/staffId descriptions: only when the customer asks who.' }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf!.id)
  const r = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { method: 'PATCH', headers: H, body: JSON.stringify({ model: { ...a.model, tools } }) })
  console.log('### PATCH HTTP ' + r.status)
  if (!r.ok) throw new Error(await r.text())
  console.log('### APPLIED')
}, 120000)
