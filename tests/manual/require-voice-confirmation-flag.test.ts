// Tenant data: opt the three write workflows into the voice consent gate by
// setting require_voice_confirmation on their action node config (new
// workflow versions, append-only). Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
it.skipIf(!ORG_ID)('sets require_voice_confirmation', async () => {
  const s = createServiceRoleClient()
  for (const tool of ['book_appointment', 'reschedule_appointment', 'cancel_appointment']) {
    const { data: wf } = await s.from('workflows').select('id, current_version_id').eq('org_id', ORG_ID!).eq('tool_name', tool).is('deleted_at', null).maybeSingle()
    const { data: cur } = await s.from('workflow_versions').select('definition').eq('id', wf!.current_version_id!).maybeSingle()
    const def = JSON.parse(JSON.stringify(cur!.definition)) as Record<string, any>
    const action = (def.nodes as any[]).find((n) => n.type === 'action' || n.data?.kind === 'action')
    const cfg = (action.data?.config ?? action.config ?? {}) as Record<string, unknown>
    console.log(`### ${tool} :: require_voice_confirmation now=${cfg.require_voice_confirmation ?? 'unset'}`)
    if (cfg.require_voice_confirmation === true) continue
    const next = { ...cfg, require_voice_confirmation: true }
    if (action.data) action.data.config = next; else action.config = next
    if (process.env.APPLY !== '1') continue
    const { data: latest } = await s.from('workflow_versions').select('version_number').eq('workflow_id', wf!.id).order('version_number', { ascending: false }).limit(1)
    const { data: nv, error } = await s.from('workflow_versions').insert({ workflow_id: wf!.id, version_number: (latest?.[0]?.version_number ?? 1) + 1, definition: def, notes: 'require_voice_confirmation: voice consent gate on writes.' }).select('id').single()
    if (error || !nv) throw new Error(error?.message)
    await s.from('workflows').update({ current_version_id: nv.id }).eq('id', wf!.id)
    console.log(`###   -> version set`)
  }
  if (process.env.APPLY !== '1') console.log('### DRY RUN')
}, 60000)
