// Tenant data fix: tokenisation left "{{business_name}}, 212 Newbury Street,
// Boston" in the entry orchestrator's stored prompt (the live address is
// "212 Newbury Street, Boston, MA 02116", so the exact-match roundtrip guard
// correctly refused the partial form). A template from this tenant would
// ship Boston's street to every target. Replaces it with
// {{business_location}} as a new, append-only prompt version. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const SLUG = 'cc-entry-orchestrator'
const RESIDUE = '{{business_name}}, 212 Newbury Street, Boston'
it.skipIf(!ORG_ID)('replaces the address residue in the orchestrator prompt', async () => {
  const s = createServiceRoleClient()
  const { data: a } = await s.from('agents').select('id, active_prompt_version_id').eq('organization_id', ORG_ID!).eq('slug', SLUG).maybeSingle()
  if (!a?.active_prompt_version_id) throw new Error('orchestrator / active version missing')
  const { data: cur } = await s.from('agent_prompt_versions').select('system_prompt').eq('id', a.active_prompt_version_id).maybeSingle()
  const before = cur!.system_prompt
  if (!before.includes(RESIDUE)) { console.log('### NO RESIDUE, nothing to do'); return }
  const after = before.replaceAll(RESIDUE, '{{business_location}}')
  console.log('### BEFORE_L1 ' + before.split('\n')[0].slice(0, 120))
  console.log('### AFTER_L1  ' + after.split('\n')[0].slice(0, 120))
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const { data: vs } = await s.from('agent_prompt_versions').select('version').eq('agent_id', a.id).order('version', { ascending: false }).limit(1)
  const next = (vs?.[0]?.version ?? 0) + 1
  const { data: nv, error } = await s.from('agent_prompt_versions').insert({ organization_id: ORG_ID!, agent_id: a.id, version: next, system_prompt: after }).select('id').single()
  if (error || !nv) throw new Error(error?.message)
  const { error: e2 } = await s.from('agents').update({ active_prompt_version_id: nv.id }).eq('id', a.id)
  if (e2) throw new Error(e2.message)
  console.log('### APPLIED version ' + next)
}, 60000)
