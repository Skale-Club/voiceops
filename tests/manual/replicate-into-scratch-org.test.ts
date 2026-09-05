// The replication proof on the REAL database: capture the Cuts & Culture
// organization with every asset group through the product's own
// captureOrgSnapshot(), create a clearly-named scratch organization the way
// createOrganization() does (organizations + owner membership), install the
// snapshot through installSnapshotIntoOrg(), then verify the mesh shape and
// that the installed prompts name the NEW tenant. Dry run (capture only,
// counts printed) unless APPLY=1. Never touches the source org.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { captureOrgSnapshot } from '@/lib/org-templates/snapshot'
import { installSnapshotIntoOrg } from '@/lib/org-templates/install'
import { ASSET_GROUPS } from '@/lib/org-templates/types'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'

const SOURCE_ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const SCRATCH_NAME = 'ZZ Template Test (scratch)'
const SCRATCH_SLUG = 'zz-template-test-scratch'

it('capture -> install into a scratch org', async () => {
  const admin = createServiceRoleClient()
  const snapshot = await captureOrgSnapshot(admin as never, [...ASSET_GROUPS], { organizationId: SOURCE_ORG })
  const counts = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]))
  console.log('### CAPTURED ' + JSON.stringify(counts))
  const agentSlugs = (snapshot.agents ?? []).map((a) => a.slug)
  console.log('### AGENTS ' + JSON.stringify(agentSlugs))
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }

  const { data: owner } = await admin.from('org_members').select('user_id').eq('organization_id', SOURCE_ORG).eq('role', 'owner').limit(1).maybeSingle()
  let { data: scratch } = await admin.from('organizations').select('id').eq('slug', SCRATCH_SLUG).maybeSingle()
  if (!scratch) {
    const { data: created, error } = await admin.from('organizations').insert({ name: SCRATCH_NAME, slug: SCRATCH_SLUG, widget_token: crypto.randomUUID() }).select('id').single()
    if (error || !created) throw new Error(error?.message)
    scratch = created
    if (owner?.user_id) await admin.from('org_members').insert({ organization_id: created.id, user_id: owner.user_id, role: 'owner' })
  }
  console.log('### SCRATCH_ORG ' + scratch.id)
  const summary = await installSnapshotIntoOrg(admin as never, scratch.id, snapshot, [...ASSET_GROUPS], owner?.user_id ?? null)
  console.log('### INSTALL ' + JSON.stringify(summary).slice(0, 600))
  const { data: agents } = await admin.from('agents').select('id, slug, active_prompt_version_id').eq('organization_id', scratch.id)
  const { count: edges } = await admin.from('agent_partners').select('id', { count: 'exact', head: true }).eq('organization_id', scratch.id)
  const { count: grants } = await admin.from('agent_partner_workflow_grants').select('partner_edge_id', { count: 'exact', head: true }).eq('organization_id', scratch.id)
  const { data: defaults } = await admin.from('agent_channel_defaults').select('channel').eq('organization_id', scratch.id)
  const { data: modes } = await admin.from('agent_channel_routing_modes').select('channel, mode').eq('organization_id', scratch.id)
  console.log('### SHAPE ' + JSON.stringify({ agents: agents?.length, withPrompt: agents?.filter((a) => a.active_prompt_version_id).length, edges, grants, defaults: defaults?.map((d) => d.channel), routingModes: modes }))
  const orch = agents?.find((a) => a.slug === 'cc-entry-orchestrator')
  if (orch) { const r = await resolveAgent(orch.id, scratch.id, 'web_widget'); console.log('### ORCH_PROMPT_HEAD ' + String(r?.systemPrompt ?? '(null)').slice(0, 120)) }
  const voice = agents?.find((a) => a.slug === 'cc-voice-receptionist')
  if (voice) { const r = await resolveAgent(voice.id, scratch.id, 'voice'); console.log('### VOICE_PROMPT_HEAD ' + String(r?.systemPrompt ?? '(null)').slice(0, 120)) }
}, 180000)
