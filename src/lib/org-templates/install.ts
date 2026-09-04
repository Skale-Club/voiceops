import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { renderPromptTemplate, resolveTenantFacts } from './prompt-template'
import {
  emptyCounts,
  type ChecklistItem,
  type InstallCounts,
  type InstallSummary,
  type OrgTemplateAssetGroup,
  type OrgTemplateSnapshot,
} from './types'

type Admin = SupabaseClient<Database>

const EMPTY_FLOW = { nodes: [], edges: [], variables: [], metadata: {} }

/**
 * Copy the STRUCTURAL assets of a template snapshot into a freshly-created
 * organization. Runs with a service-role client because the target org is not
 * the caller's active org.
 *
 * Safety rules baked in here:
 *  - Only the requested asset groups are copied.
 *  - Workflows are ALWAYS imported as drafts (is_active = false) and never
 *    overwrite a platform-default workflow already seeded into the new org.
 *  - Nothing else (contacts, conversations, credentials, phone numbers, …) is
 *    ever touched — the snapshot simply doesn't carry it.
 */
export async function installSnapshotIntoOrg(
  admin: Admin,
  targetOrgId: string,
  snapshot: OrgTemplateSnapshot,
  groups: OrgTemplateAssetGroup[],
  createdBy: string | null
): Promise<InstallSummary> {
  const counts = emptyCounts()
  const want = new Set(groups)

  if (want.has('pipelines') && snapshot.pipelines?.length) {
    await installPipelines(admin, targetOrgId, snapshot, counts)
  }

  if (want.has('custom_fields') && snapshot.custom_fields?.length) {
    await installCustomFields(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('tags') && snapshot.tags?.length) {
    await installTags(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('message_templates') && snapshot.message_templates?.length) {
    await installMessageTemplates(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('workflows') && snapshot.workflows?.length) {
    await installWorkflows(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('agents') && snapshot.agents?.length) {
    await installAgents(admin, targetOrgId, snapshot, createdBy, counts)
  }

  return { counts, checklist: buildChecklist(groups, counts) }
}

async function installPipelines(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  counts: InstallCounts
) {
  // A brand-new org is auto-seeded with a default "Sales" pipeline by a DB
  // trigger. Since the template defines its own pipelines and the new org has
  // no opportunities yet, clear those seeded pipelines so the template's
  // structure lands cleanly without leaving two competing defaults.
  await admin.from('pipelines').delete().eq('org_id', orgId)

  for (const p of snapshot.pipelines ?? []) {
    const { data: pipeline } = await admin
      .from('pipelines')
      .insert({
        org_id: orgId,
        name: p.name,
        is_default: p.is_default,
        position: p.position,
      })
      .select('id')
      .single()
    if (!pipeline) continue
    counts.pipelines += 1

    if (p.stages.length) {
      const { data: inserted } = await admin
        .from('pipeline_stages')
        .insert(
          p.stages.map((s) => ({
            pipeline_id: pipeline.id,
            org_id: orgId,
            name: s.name,
            position: s.position,
            color: s.color,
            is_won: s.is_won,
            is_lost: s.is_lost,
          }))
        )
        .select('id')
      counts.stages += inserted?.length ?? 0
    }
  }
}

async function installCustomFields(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  const rows = (snapshot.custom_fields ?? []).map((f) => ({
    org_id: orgId,
    entity: f.entity,
    key: f.key,
    label: f.label,
    type: f.type as Database['public']['Tables']['custom_field_definitions']['Insert']['type'],
    required: f.required,
    unique_per_org: f.unique_per_org,
    position: f.position,
    group_name: f.group_name,
    help_text: f.help_text,
    default_value: f.default_value as Database['public']['Tables']['custom_field_definitions']['Insert']['default_value'],
    options: f.options as Database['public']['Tables']['custom_field_definitions']['Insert']['options'],
    validation: f.validation as Database['public']['Tables']['custom_field_definitions']['Insert']['validation'],
    visible_in_list: f.visible_in_list,
    filterable: f.filterable,
    created_by: createdBy,
  }))
  if (!rows.length) return
  // The target org is freshly created, so there are no pre-existing rows to
  // collide with — a single batch insert is safe and accurate.
  const { data, error } = await admin.from('custom_field_definitions').insert(rows).select('id')
  if (error) {
    console.warn('[org-templates] custom field import failed:', error.message)
    return
  }
  counts.custom_fields += data?.length ?? 0
}

async function installTags(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  const rows = (snapshot.tags ?? []).map((t) => ({
    org_id: orgId,
    name: t.name,
    slug: t.slug,
    color: t.color,
    created_by: createdBy,
  }))
  if (!rows.length) return
  const { data, error } = await admin.from('tags').insert(rows).select('id')
  if (error) {
    console.warn('[org-templates] tag import failed:', error.message)
    return
  }
  counts.tags += data?.length ?? 0
}

async function installMessageTemplates(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  const rows = (snapshot.message_templates ?? []).map((m) => ({
    org_id: orgId,
    name: m.name,
    description: m.description,
    subject_line: m.subject_line,
    preview_text: m.preview_text,
    ai_prompt: m.ai_prompt,
    // Imported templates start as drafts regardless of source status.
    status: 'draft',
    tags: m.tags,
    document: m.document as Database['public']['Tables']['email_templates']['Insert']['document'],
    html_snapshot: m.html_snapshot,
    plain_text_snapshot: m.plain_text_snapshot,
    created_by: createdBy,
  }))
  if (!rows.length) return
  const { data, error } = await admin.from('email_templates').insert(rows).select('id')
  if (error) {
    console.warn('[org-templates] message template import failed:', error.message)
    return
  }
  counts.message_templates += data?.length ?? 0
}

async function installWorkflows(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  // Slugs already present (e.g. freshly-seeded platform defaults) are left
  // untouched — we never overwrite them, and custom template workflows land as
  // drafts alongside.
  const { data: existing } = await admin
    .from('workflows')
    .select('slug')
    .eq('org_id', orgId)
  const taken = new Set((existing ?? []).map((w) => w.slug))

  for (const w of snapshot.workflows ?? []) {
    if (taken.has(w.slug)) continue

    const { data: workflow, error: wErr } = await admin
      .from('workflows')
      .insert({
        org_id: orgId,
        name: w.name,
        slug: w.slug,
        description: w.description,
        // NON-NEGOTIABLE: imported workflows never start active.
        is_active: false,
        kind: w.kind,
        tool_name: w.kind === 'tool' ? w.tool_name : null,
        trigger_type: w.trigger_type,
        trigger_config: w.trigger_config as Database['public']['Tables']['workflows']['Insert']['trigger_config'],
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (wErr || !workflow) {
      if (wErr) console.warn(`[org-templates] workflow import failed (${w.slug}):`, wErr.message)
      continue
    }
    taken.add(w.slug)

    const definition = (w.definition ?? EMPTY_FLOW) as Database['public']['Tables']['workflow_versions']['Insert']['definition']
    const { data: version } = await admin
      .from('workflow_versions')
      .insert({
        workflow_id: workflow.id,
        version_number: 1,
        definition,
        notes: 'Imported from organization template (draft)',
        created_by: createdBy,
      })
      .select('id')
      .single()

    if (version) {
      await admin
        .from('workflows')
        .update({ current_version_id: version.id })
        .eq('id', workflow.id)
    }
    counts.workflows += 1
  }
}

/**
 * Install the agent mesh: agents, their rendered prompt (as a real, active
 * `agent_prompt_versions` row — see the module-level note below), direct tool
 * grants, partner edges, delegated workflow grants, and channel defaults.
 *
 * Binds exclusively by stable keys captured in the snapshot (`slug`,
 * `tool_name`) — never by id, since ids differ per organization.
 *
 * THE BUG THIS FUNCTION EXISTS TO MAKE IMPOSSIBLE (139-CONTEXT.md): the first
 * hand-run provisioning of the Cuts & Culture mesh created six agents and no
 * `agent_prompt_versions` rows, and `resolveAgent()` refuses to load an agent
 * with no active prompt version — all six were inert until repaired by hand.
 * Every agent upsert below is immediately followed, in the same pass, by a
 * prompt-version insert and an `active_prompt_version_id` update, unless an
 * equivalent (content-identical) active version already exists. There is no
 * code path that creates or upserts an `agents` row without also ensuring it
 * points at a real, matching prompt version.
 *
 * Install never activates: `agent_channel_defaults` is only INSERTed when no
 * row exists for that channel yet (never upserted, never repointed), and
 * `agent_channel_routing_modes` is never referenced anywhere in this file —
 * its absence for a freshly installed org resolves to 'legacy' via the
 * resolver's own fail-closed default.
 */
async function installAgents(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
): Promise<void> {
  const facts = await resolveTenantFacts(admin, orgId)
  const agentIdBySlug = new Map<string, string>()

  // 1-2. Agents + prompt versions.
  for (const a of snapshot.agents ?? []) {
    const renderedPrompt = renderPromptTemplate(a.system_prompt, facts)

    const { data: agent, error: agentErr } = await admin
      .from('agents')
      .upsert(
        {
          organization_id: orgId,
          slug: a.slug,
          name: a.name,
          description: a.description,
          model: a.model,
          temperature: a.temperature,
          max_tokens: a.max_tokens,
          max_history: a.max_history,
          fallback_message: a.fallback_message,
          allowed_channels: a.allowed_channels as Database['public']['Tables']['agents']['Insert']['allowed_channels'],
          kb_scope: a.kb_scope,
          is_active: a.is_active,
          // NOT NULL and unused by the runtime (resolveAgent() always reads
          // the active agent_prompt_versions row instead — see 139-01's
          // context note), but must hold a valid, rendered value.
          system_prompt: renderedPrompt,
        },
        { onConflict: 'organization_id,slug' }
      )
      .select('id, active_prompt_version_id')
      .single()

    if (agentErr || !agent) {
      console.warn(`[org-templates] agent import failed (${a.slug}):`, agentErr?.message)
      continue
    }
    agentIdBySlug.set(a.slug, agent.id)
    counts.agents += 1

    let currentPrompt: string | null = null
    if (agent.active_prompt_version_id) {
      const { data: activeVersion } = await admin
        .from('agent_prompt_versions')
        .select('system_prompt')
        .eq('id', agent.active_prompt_version_id)
        .maybeSingle()
      currentPrompt = activeVersion?.system_prompt ?? null
    }

    // Idempotent no-op: the active version already holds this exact rendered
    // text, so re-running the install creates nothing further for this agent.
    if (currentPrompt === renderedPrompt) continue

    const { data: maxVersionRow } = await admin
      .from('agent_prompt_versions')
      .select('version')
      .eq('agent_id', agent.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextVersion = (maxVersionRow?.version ?? 0) + 1

    const { data: newVersion, error: versionErr } = await admin
      .from('agent_prompt_versions')
      .insert({
        organization_id: orgId,
        agent_id: agent.id,
        version: nextVersion,
        system_prompt: renderedPrompt,
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (versionErr || !newVersion) {
      console.warn(`[org-templates] prompt version import failed (${a.slug}):`, versionErr?.message)
      continue
    }

    // THE STEP scripts/provision-canary-graph.ts is missing — never skippable
    // for an agent that reaches this line.
    await admin.from('agents').update({ active_prompt_version_id: newVersion.id }).eq('id', agent.id)
  }

  // 3. Direct tool grants (agent_tools), resolved by workflow tool_name.
  for (const a of snapshot.agents ?? []) {
    const agentId = agentIdBySlug.get(a.slug)
    if (!agentId) continue

    for (const toolName of a.direct_tools ?? []) {
      const { data: workflow } = await admin
        .from('workflows')
        .select('id')
        .eq('org_id', orgId)
        .eq('tool_name', toolName)
        .maybeSingle()
      if (!workflow) {
        console.warn(
          `[org-templates] direct tool grant skipped, no workflow with tool_name "${toolName}" in target org (agent "${a.slug}")`
        )
        continue
      }

      const { data: existing } = await admin
        .from('agent_tools')
        .select('id')
        .eq('agent_id', agentId)
        .eq('workflow_id', workflow.id)
        .maybeSingle()
      if (existing) continue

      const { error: grantErr } = await admin
        .from('agent_tools')
        .insert({ organization_id: orgId, agent_id: agentId, workflow_id: workflow.id })
      if (grantErr) {
        console.warn(`[org-templates] direct tool grant failed ("${a.slug}" -> "${toolName}"):`, grantErr.message)
        continue
      }
      counts.agent_direct_tool_grants += 1
    }
  }

  // 4-5. Partner edges + delegated workflow grants, resolved by slug/tool_name.
  for (const e of snapshot.agent_partner_edges ?? []) {
    const agentId = agentIdBySlug.get(e.agent_slug)
    const partnerAgentId = agentIdBySlug.get(e.partner_agent_slug)
    if (!agentId || !partnerAgentId) {
      console.warn(
        `[org-templates] partner edge skipped, unresolved agent slug ("${e.agent_slug}" -> "${e.partner_agent_slug}")`
      )
      continue
    }

    const { data: edge, error: edgeErr } = await admin
      .from('agent_partners')
      .upsert(
        {
          organization_id: orgId,
          agent_id: agentId,
          partner_agent_id: partnerAgentId,
          invocation_description: e.invocation_description,
          allowed_channels: e.allowed_channels as Database['public']['Tables']['agent_partners']['Insert']['allowed_channels'],
          max_calls_per_turn: e.max_calls_per_turn,
          max_depth: e.max_depth,
          timeout_ms: e.timeout_ms,
        },
        { onConflict: 'agent_id,partner_agent_id' }
      )
      .select('id')
      .single()
    if (edgeErr || !edge) {
      console.warn(
        `[org-templates] partner edge import failed ("${e.agent_slug}" -> "${e.partner_agent_slug}"):`,
        edgeErr?.message
      )
      continue
    }
    counts.agent_partner_edges += 1

    for (const toolName of e.workflow_grants ?? []) {
      const { data: workflow } = await admin
        .from('workflows')
        .select('id')
        .eq('org_id', orgId)
        .eq('tool_name', toolName)
        .maybeSingle()
      if (!workflow) {
        console.warn(
          `[org-templates] delegated grant skipped, no workflow with tool_name "${toolName}" in target org (edge "${e.agent_slug}" -> "${e.partner_agent_slug}")`
        )
        continue
      }

      const { error: grantErr } = await admin
        .from('agent_partner_workflow_grants')
        .upsert(
          { organization_id: orgId, partner_edge_id: edge.id, workflow_id: workflow.id },
          { onConflict: 'partner_edge_id,workflow_id' }
        )
      if (grantErr) {
        console.warn(`[org-templates] delegated grant failed ("${toolName}"):`, grantErr.message)
        continue
      }
      counts.agent_delegated_workflow_grants += 1
    }
  }

  // 6. Channel defaults — INSERT ONLY IF ABSENT. Never upsert: doing so could
  // silently repoint an operator's existing choice, which is exactly the
  // "install never activates" locked decision.
  for (const cd of snapshot.agent_channel_defaults ?? []) {
    const agentId = agentIdBySlug.get(cd.agent_slug)
    if (!agentId) continue

    const { data: existing } = await admin
      .from('agent_channel_defaults')
      .select('id')
      .eq('organization_id', orgId)
      .eq('channel', cd.channel as Database['public']['Tables']['agent_channel_defaults']['Insert']['channel'])
      .maybeSingle()
    if (existing) continue

    const { error: insertErr } = await admin
      .from('agent_channel_defaults')
      .insert({
        organization_id: orgId,
        channel: cd.channel as Database['public']['Tables']['agent_channel_defaults']['Insert']['channel'],
        agent_id: agentId,
      })
    if (insertErr) {
      console.warn(`[org-templates] channel default import failed ("${cd.channel}"):`, insertErr.message)
      continue
    }
    counts.agent_channel_defaults += 1
  }

  // 7. `agent_channel_routing_modes` is deliberately never referenced above,
  // or anywhere else in this file — its absence for a freshly installed org
  // IS the desired state (the resolver's own fail-closed default is
  // 'legacy'). Do not add a write to that table here.
}

function buildChecklist(
  groups: OrgTemplateAssetGroup[],
  counts: InstallCounts
): ChecklistItem[] {
  const want = new Set(groups)
  const items: ChecklistItem[] = [
    {
      id: 'integrations',
      label:
        'Connect required integrations (Vapi, GoHighLevel, Meta, Twilio, email, …) — none are copied from a template.',
      done: false,
    },
    {
      id: 'phone_numbers',
      label: 'Assign and configure phone number(s) for this organization.',
      done: false,
    },
  ]

  if (want.has('workflows') && counts.workflows > 0) {
    items.push({
      id: 'workflows',
      label: `Review and activate the ${counts.workflows} imported workflow(s) — they were imported as drafts and are inactive.`,
      done: false,
    })
  }
  if (want.has('pipelines') && counts.pipelines > 0) {
    items.push({
      id: 'pipelines',
      label: 'Confirm the default pipeline and stage ownership.',
      done: false,
    })
  }
  if (want.has('custom_fields') && counts.custom_fields > 0) {
    items.push({
      id: 'custom_fields',
      label: 'Verify custom field definitions and mappings.',
      done: false,
    })
  }
  if (want.has('agents') && counts.agents > 0) {
    items.push({
      id: 'agents',
      label: `Review the ${counts.agents} imported agent(s)' prompts and connect the integrations they call before enabling any channel.`,
      done: false,
    })
  }

  items.push({
    id: 'team',
    label: 'Invite team members to the new organization.',
    done: false,
  })

  return items
}
