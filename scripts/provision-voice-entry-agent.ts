#!/usr/bin/env node
// scripts/provision-voice-entry-agent.ts
// MODAL-03 / TMPL-03: provisions the agent that OWNS a tenant's voice prompt,
// so the Vapi assistant's system prompt can be pushed from Xphere instead of
// hand-PATCHed — and so the service location rule is rendered by the engine
// rather than frozen into prose inside Vapi.
//
// WHY THIS AGENT HAS TO EXIST. pushAssistantConfig() resolves the prompt it
// pushes from `agent_channel_defaults.voice` (falling back to web_widget).
// Before this script the Cuts & Culture org had only a web_widget default,
// pointing at the mesh's entry ORCHESTRATOR — an agent whose prompt says "you
// do not answer questions yourself and you do not call booking tools". That
// prompt is correct for the widget mesh and catastrophic for a Vapi assistant
// running on legacy routing, where the assistant holds the functions itself
// and there are no specialists to hand to. Pushing it would have produced a
// phone robot that refuses to use its own tools. The voice channel needs its
// own prompt, and an agent is where a prompt lives.
//
// TOOL AUTHORITY. The voice agent gets DIRECT grants for the read tools only.
// Write tools are reached through ONE partner edge to the tenant's booking
// specialist, which is what keeps MESH-03 ("only the Booking specialist holds
// Xkedule write grants") true for this agent too. pushAssistantConfig() unions
// direct grants with every workflow granted across outgoing edges, so all the
// functions still render into the assistant; the difference only shows if the
// channel is later flipped to specialist routing, where this agent delegates
// writes instead of holding them.
//
// NOTE for a later specialist flip: this agent's prompt is written for legacy
// routing (it calls tools directly). Flipping `agent_channel_routing_modes.voice`
// to 'specialist' should be accompanied by pointing the voice channel default
// at a delegating orchestrator, or by giving this agent a delegating prompt.
// The runbook step exists; this comment is the reminder of the coupling.
//
// SAFETY MODEL (mirrors scripts/templatize-agent-prompts.ts):
//   - Dry run is the default. Without --apply the script resolves everything
//     read-only and prints the exact plan. It writes nothing.
//   - Writing requires --org=<uuid> AND --apply AND --expect-slug=<slug>. The
//     live organization row's slug must match, or the script refuses. No org
//     id is ever read from process.env.
//   - The prompt is read from a file given on the command line; this script
//     carries no tenant text of its own.
//   - Append-only prompt history: a new agent_prompt_versions row (max + 1)
//     is inserted and only then is active_prompt_version_id repointed. No
//     version row is ever updated or deleted. An agent can never be left
//     without an active prompt version — the failure that made the mesh
//     unusable on first provisioning.
//   - The channel default is INSERTED only when absent. Repointing an
//     existing one requires --repoint-channel-default, because silently
//     moving a live channel to a different agent is exactly what
//     installSnapshotIntoOrg() refuses to do.
//
// Usage:
//   tsx scripts/provision-voice-entry-agent.ts \
//     --org=<uuid> --slug=cc-voice-receptionist --name="..." \
//     --prompt-file=<path> --model=anthropic/claude-sonnet-4.6 \
//     --read-tools=list_services,business_info \
//     --write-tools=book_appointment --delegate-writes-to=cc-booking-specialist
//   # add --apply --expect-slug=<org slug> to write.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

type SupaClient = ReturnType<typeof createClient<Database>>

interface Options {
  orgId: string
  slug: string
  name: string
  description: string
  promptFile: string
  model: string
  temperature: number
  channel: string
  readTools: string[]
  writeTools: string[]
  delegateWritesTo: string
  apply: boolean
  expectSlug: string | null
  repointChannelDefault: boolean
}

function flag(argv: string[], key: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${key}=`))
  return hit ? hit.slice(key.length + 3) : null
}

export function parseVoiceAgentArgs(argv: string[]): Options {
  const orgId = flag(argv, 'org')
  const slug = flag(argv, 'slug')
  const promptFile = flag(argv, 'prompt-file')
  const delegateWritesTo = flag(argv, 'delegate-writes-to')

  if (!orgId) throw new Error('--org=<uuid> is required.')
  if (!slug) throw new Error('--slug=<agent slug> is required.')
  if (!promptFile) throw new Error('--prompt-file=<path> is required.')

  const writeTools = (flag(argv, 'write-tools') ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  if (writeTools.length > 0 && !delegateWritesTo) {
    throw new Error('--delegate-writes-to=<specialist slug> is required whenever --write-tools is given.')
  }

  const apply = argv.includes('--apply')
  const expectSlug = flag(argv, 'expect-slug')
  if (apply && !expectSlug) {
    throw new Error('--apply requires --expect-slug=<organization slug>.')
  }

  return {
    orgId,
    slug,
    name: flag(argv, 'name') ?? slug,
    description: flag(argv, 'description') ?? 'Voice entry agent: owns the prompt pushed to the Vapi assistant.',
    promptFile,
    model: flag(argv, 'model') ?? 'anthropic/claude-sonnet-4.6',
    temperature: Number(flag(argv, 'temperature') ?? '0.3'),
    channel: flag(argv, 'channel') ?? 'voice',
    readTools: (flag(argv, 'read-tools') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    writeTools,
    delegateWritesTo: delegateWritesTo ?? '',
    apply,
    expectSlug,
    repointChannelDefault: argv.includes('--repoint-channel-default'),
  }
}

async function resolveWorkflowIds(
  supabase: SupaClient,
  orgId: string,
  toolNames: string[]
): Promise<Map<string, string>> {
  const byName = new Map<string, string>()
  if (toolNames.length === 0) return byName

  const { data, error } = await supabase
    .from('workflows')
    .select('id, tool_name')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('tool_name', toolNames)
  if (error) throw new Error(`Failed to resolve workflows: ${error.message}`)

  for (const row of data ?? []) {
    if (row.tool_name) byName.set(row.tool_name, row.id)
  }

  const missing = toolNames.filter((t) => !byName.has(t))
  if (missing.length > 0) {
    throw new Error(`These tool names do not exist for this organization: ${missing.join(', ')}`)
  }
  return byName
}

export async function provisionVoiceEntryAgent(supabase: SupaClient, opts: Options): Promise<void> {
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name, service_location_mode')
    .eq('id', opts.orgId)
    .maybeSingle()
  if (orgError) throw new Error(`Failed to read organization: ${orgError.message}`)
  if (!org) throw new Error(`No organization with id ${opts.orgId}.`)

  console.log(`Target organization: ${org.slug} (${org.id})`)
  console.log(`  service_location_mode: ${org.service_location_mode}`)

  if (opts.apply && org.slug !== opts.expectSlug) {
    throw new Error(
      `Refusing to write: --expect-slug=${opts.expectSlug} but the live organization's slug is ${org.slug}.`
    )
  }

  const promptTemplate = readFileSync(resolve(opts.promptFile), 'utf8')
  if (promptTemplate.trim().length === 0) throw new Error('The prompt file is empty.')

  const readIds = await resolveWorkflowIds(supabase, opts.orgId, opts.readTools)
  const writeIds = await resolveWorkflowIds(supabase, opts.orgId, opts.writeTools)

  let delegateAgentId: string | null = null
  if (opts.writeTools.length > 0) {
    const { data: delegate } = await supabase
      .from('agents')
      .select('id, slug')
      .eq('organization_id', opts.orgId)
      .eq('slug', opts.delegateWritesTo)
      .maybeSingle()
    if (!delegate) throw new Error(`No agent with slug "${opts.delegateWritesTo}" in this organization.`)
    delegateAgentId = delegate.id
  }

  const { data: existingAgent } = await supabase
    .from('agents')
    .select('id, active_prompt_version_id')
    .eq('organization_id', opts.orgId)
    .eq('slug', opts.slug)
    .maybeSingle()

  const { data: existingDefault } = await supabase
    .from('agent_channel_defaults')
    .select('agent_id')
    .eq('organization_id', opts.orgId)
    .eq('channel', opts.channel as Database['public']['Tables']['agent_channel_defaults']['Insert']['channel'])
    .maybeSingle()

  console.log('\nPlan:')
  console.log(`  agent            ${existingAgent ? 'update' : 'create'}  ${opts.slug} (${opts.model})`)
  console.log(`  prompt version   insert  ${promptTemplate.length} chars, then set active`)
  for (const tool of opts.readTools) console.log(`  direct grant     ensure  ${tool}`)
  if (delegateAgentId) {
    console.log(`  partner edge     ensure  ${opts.slug} -> ${opts.delegateWritesTo}`)
    for (const tool of opts.writeTools) console.log(`  delegated grant  ensure  ${tool} (via that edge)`)
  }
  if (!existingDefault) {
    console.log(`  channel default  insert  ${opts.channel} -> ${opts.slug}`)
  } else if (opts.repointChannelDefault) {
    console.log(`  channel default  REPOINT ${opts.channel} -> ${opts.slug} (was ${existingDefault.agent_id})`)
  } else {
    console.log(
      `  channel default  SKIP    ${opts.channel} already points at ${existingDefault.agent_id};` +
        ' pass --repoint-channel-default to move it'
    )
  }

  if (!opts.apply) {
    console.log('\n--dry-run: organization verified, no writes performed.')
    return
  }

  // 1. Agent.
  const { data: agentRow, error: agentError } = await supabase
    .from('agents')
    .upsert(
      {
        organization_id: opts.orgId,
        slug: opts.slug,
        name: opts.name,
        description: opts.description,
        system_prompt: promptTemplate,
        allowed_channels: [opts.channel] as Database['public']['Tables']['agents']['Insert']['allowed_channels'],
        model: opts.model,
        temperature: opts.temperature,
      },
      { onConflict: 'organization_id,slug' }
    )
    .select('id')
    .single()
  if (agentError || !agentRow) throw new Error(`Failed to upsert agent: ${agentError?.message}`)
  const agentId = agentRow.id

  // 2. Prompt version, append-only, then activate. An agent must never be
  // left without an active prompt version.
  const { data: versions } = await supabase
    .from('agent_prompt_versions')
    .select('version')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })
    .limit(1)
  const nextVersion = (versions?.[0]?.version ?? 0) + 1

  const { data: versionRow, error: versionError } = await supabase
    .from('agent_prompt_versions')
    .insert({
      organization_id: opts.orgId,
      agent_id: agentId,
      version: nextVersion,
      system_prompt: promptTemplate,
    })
    .select('id')
    .single()
  if (versionError || !versionRow) throw new Error(`Failed to insert prompt version: ${versionError?.message}`)

  const { error: activateError } = await supabase
    .from('agents')
    .update({ active_prompt_version_id: versionRow.id })
    .eq('id', agentId)
  if (activateError) throw new Error(`Failed to activate prompt version: ${activateError.message}`)

  // 3. Direct read grants.
  for (const [toolName, workflowId] of readIds) {
    const { data: existing } = await supabase
      .from('agent_tools')
      .select('id')
      .eq('agent_id', agentId)
      .eq('workflow_id', workflowId)
      .maybeSingle()
    if (existing) continue

    const { error } = await supabase
      .from('agent_tools')
      .insert({ organization_id: opts.orgId, agent_id: agentId, workflow_id: workflowId })
    if (error) throw new Error(`Failed to grant "${toolName}": ${error.message}`)
  }

  // 4. One partner edge carrying the write tools.
  if (delegateAgentId) {
    const { data: edge, error: edgeError } = await supabase
      .from('agent_partners')
      .upsert(
        {
          organization_id: opts.orgId,
          agent_id: agentId,
          partner_agent_id: delegateAgentId,
          invocation_description:
            'Create, move or cancel an appointment once the caller has confirmed service, price, day, time, name and phone.',
          allowed_channels: [opts.channel] as Database['public']['Tables']['agent_partners']['Insert']['allowed_channels'],
          max_calls_per_turn: 2,
          max_depth: 2,
          timeout_ms: 30000,
        },
        { onConflict: 'agent_id,partner_agent_id' }
      )
      .select('id')
      .single()
    if (edgeError || !edge) throw new Error(`Failed to upsert partner edge: ${edgeError?.message}`)

    for (const [toolName, workflowId] of writeIds) {
      const { error } = await supabase
        .from('agent_partner_workflow_grants')
        .upsert(
          { organization_id: opts.orgId, partner_edge_id: edge.id, workflow_id: workflowId },
          { onConflict: 'partner_edge_id,workflow_id' }
        )
      if (error) throw new Error(`Failed to grant "${toolName}" to the edge: ${error.message}`)
    }
  }

  // 5. Channel default: insert when absent, repoint only when asked.
  if (!existingDefault) {
    const { error } = await supabase.from('agent_channel_defaults').insert({
      organization_id: opts.orgId,
      channel: opts.channel as Database['public']['Tables']['agent_channel_defaults']['Insert']['channel'],
      agent_id: agentId,
    })
    if (error) throw new Error(`Failed to insert channel default: ${error.message}`)
  } else if (opts.repointChannelDefault) {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .update({ agent_id: agentId })
      .eq('organization_id', opts.orgId)
      .eq('channel', opts.channel as Database['public']['Tables']['agent_channel_defaults']['Insert']['channel'])
    if (error) throw new Error(`Failed to repoint channel default: ${error.message}`)
  }

  console.log(`\nApplied: agent ${opts.slug} (${agentId}), prompt version ${nextVersion} active.`)
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(1)
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  provisionVoiceEntryAgent(supabase, parseVoiceAgentArgs(process.argv.slice(2))).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
