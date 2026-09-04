#!/usr/bin/env node
// scripts/provision-canary-graph.ts
// Phase 136 Plan 02 (ROLL-01): provisions the Cuts & Culture canary
// specialist graph declared in
// .planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json
//
// Follows the house tenant-scoped provisioning pattern (scripts/seed-demo-org.ts,
// scripts/load-workflow-seeds.ts): read the declarative artifact, resolve or
// create rows idempotently, never assume a default target.
//
// SAFETY MODEL (136-CONTEXT.md "Locked Decisions"):
//   - Dry run is the DEFAULT in every sense. With no arguments at all, the
//     script never opens a network connection -- it only reads the local
//     JSON and prints the graph it would provision. This is deliberately
//     safer than "dry run reads the DB": you cannot accidentally touch a
//     real organization by forgetting a flag.
//   - Passing --org=<uuid> upgrades the preview to a *validated* dry run: it
//     looks up that organization (read-only) and refuses to print a plan
//     against a mismatched tenant, but still writes nothing without --apply.
//   - Writing requires BOTH --apply AND --org=<uuid> together on the command
//     line. There is no environment-variable org id and no "current org"
//     fallback -- this script never reads an org id from process.env.
//   - Before any write, the script re-resolves the named organization and
//     refuses to proceed unless its slug matches the graph's declared
//     target (`organization.slug` in the JSON, "cuts-and-culture"). "The one
//     named" is therefore checked against the live row, not just echoed
//     back from whatever id was typed on the command line.
//   - Idempotent: agents upsert on (organization_id, slug) -- 034_agents.sql;
//     workflows resolve-or-insert on (org_id, tool_name) -- the partial
//     unique index in 080_workflows_unified_schema.sql cannot be an
//     upsert-onConflict target from supabase-js, so workflows use an
//     explicit select-then-insert, same as scripts/load-workflow-seeds.ts;
//     partner edges upsert on (agent_id, partner_agent_id) --
//     034_agents.sql's uniq_agent_partners_pair; delegated workflow grants
//     upsert on (partner_edge_id, workflow_id) --
//     1291_authorized_agent_partner_edges.sql. Re-running after a
//     successful apply changes nothing.
//
// This script has never been run against a real organization. It is
// exercised only through tests/canary-graph-shape.test.ts with a mocked
// Supabase client -- see that file for the proof.
//
// Usage:
//   tsx scripts/provision-canary-graph.ts                          # structural preview, no network call at all
//   tsx scripts/provision-canary-graph.ts --org=<uuid>              # validated dry run against a real org row (still writes nothing)
//   tsx scripts/provision-canary-graph.ts --org=<uuid> --apply      # write

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

export const REPO_ROOT = resolve(__dirname, '..')
export const GRAPH_PATH = join(
  REPO_ROOT,
  '.planning',
  'workstreams',
  'omnichannel-agent-orchestration',
  'canary',
  'cuts-and-culture.json',
)

// ── Graph shape (mirrors cuts-and-culture.json) ─────────────────────────────

export interface CanaryAgentDef {
  key: string
  slug: string
  name: string
  role: 'orchestrator' | 'specialist'
  description: string
  system_prompt: string
  allowed_channels: string[]
  model: string
  temperature?: number
  // Tool names (== CanaryWorkflowDef.key) this agent is authorized to call
  // ITSELF, provisioned into the agent_tools junction (095_agent_workflow_tools.sql).
  // This is a separate authority surface from partner_edges[].workflow_grants:
  // resolveEffectiveToolAuthority() (src/lib/agent-runtime/resolve-agent-tool.ts)
  // denies unconditionally when an agent has no direct grant of its own
  // (AUTHZ-02, "never widen") -- an edge's delegated-workflow grant can only
  // narrow an existing direct grant, it can never substitute for one. The
  // orchestrator holds none: it delegates, it never calls a workflow itself.
  direct_tools: string[]
}

export interface CanaryWorkflowInputField {
  type: string
  description: string
  required?: boolean
}

export interface CanaryWorkflowDef {
  key: string
  tool_name: string
  node_kind: string
  access: 'read' | 'write'
  name: string
  description: string
  input_schema: Record<string, CanaryWorkflowInputField>
}

export interface CanaryEdgeDef {
  key: string
  agent_key: string
  partner_agent_key: string
  invocation_description: string
  allowed_channels: string[]
  max_calls_per_turn: number
  max_depth: number
  timeout_ms: number
  workflow_grants: string[]
}

export interface CanaryGraph {
  organization: { slug: string; name: string }
  agents: CanaryAgentDef[]
  workflows: CanaryWorkflowDef[]
  partner_edges: CanaryEdgeDef[]
}

export function loadCanaryGraph(path: string = GRAPH_PATH): CanaryGraph {
  return JSON.parse(readFileSync(path, 'utf8')) as CanaryGraph
}

// Fail closed before a single row is written if the hand-edited JSON ever
// drifts from the locked decision: only the edge to "booking" may grant a
// write-access workflow. (Rule 2 -- this is a correctness/security
// requirement, not a style preference.)
export function assertOnlyBookingHoldsWriteGrants(graph: CanaryGraph): void {
  const writeKeys = new Set(graph.workflows.filter((w) => w.access === 'write').map((w) => w.key))
  for (const edge of graph.partner_edges) {
    const grantsWrite = edge.workflow_grants.some((k) => writeKeys.has(k))
    if (grantsWrite && edge.partner_agent_key !== 'booking') {
      throw new Error(
        `Edge "${edge.key}" grants a write-access workflow to partner "${edge.partner_agent_key}" -- only "booking" may hold an Xkedule write grant.`,
      )
    }
  }
  // Direct ownership (agent_tools) is a second, independent authority surface
  // -- an agent's own grant, not a delegated one. The same locked decision
  // applies to it: only "booking" may directly own a write-access workflow.
  for (const agent of graph.agents) {
    const ownsWrite = agent.direct_tools.some((k) => writeKeys.has(k))
    if (ownsWrite && agent.key !== 'booking') {
      throw new Error(
        `Agent "${agent.key}" directly owns a write-access workflow -- only "booking" may hold an Xkedule write grant.`,
      )
    }
  }
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

export interface ParsedArgs {
  org: string | null
  apply: boolean
}

// Deliberately reads only `argv` -- never process.env -- so there is no path
// by which an environment variable can supply an org id.
export function parseArgs(argv: string[]): ParsedArgs {
  let org: string | null = null
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg.startsWith('--org=')) org = arg.slice('--org='.length) || null
  }
  return { org, apply }
}

export function assertSafeToWrite(args: ParsedArgs): void {
  if (args.apply && !args.org) {
    throw new Error(
      'Refusing to write: --apply requires an explicit --org=<uuid> on the command line. There is no default organization.',
    )
  }
}

// ── Provisioning ─────────────────────────────────────────────────────────────

type SupaClient = ReturnType<typeof createClient<Database>>

export interface ProvisionResult {
  dryRun: boolean
  organizationId: string
  agentIds: Record<string, string>
  workflowIds: Record<string, string>
  edgeIds: Record<string, string>
  // agentToolIds keyed by "<agent_key>:<tool_name>" -- the direct-ownership
  // grant (agent_tools) provisioned in step 3, independent of edgeIds.
  agentToolIds: Record<string, string>
}

export interface ProvisionOptions {
  supabase: SupaClient
  graph: CanaryGraph
  organizationId: string
  apply: boolean
}

/**
 * Validates the target organization and, when `apply` is true, provisions
 * the graph. Always a no-op write-wise unless `apply` is true -- callers
 * that only want the structural preview should not call this at all (see
 * `printStructuralPreview` below), since this function always performs a
 * read against the `organizations` table.
 */
export async function provisionCanaryGraph(options: ProvisionOptions): Promise<ProvisionResult> {
  const { supabase, graph, organizationId, apply } = options

  assertOnlyBookingHoldsWriteGrants(graph)

  // Refuse to touch any organization other than the one the graph targets.
  // `organizationId` must come from an explicit --org argument (enforced by
  // assertSafeToWrite/main below); here we additionally refuse unless the
  // row it resolves to is actually the named tenant -- "the one named" is a
  // check against the live row, not an echo of the CLI argument.
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('id', organizationId)
    .maybeSingle()
  if (orgError) throw new Error(`Could not resolve organization ${organizationId}: ${orgError.message}`)
  if (!org) throw new Error(`Organization ${organizationId} does not exist. Refusing to provision.`)
  if (org.slug !== graph.organization.slug) {
    throw new Error(
      `Organization ${organizationId} has slug "${org.slug}", not "${graph.organization.slug}". Refusing to provision the Cuts & Culture canary graph against a different tenant.`,
    )
  }

  console.log(`Target organization: ${org.slug} (${organizationId})`)

  if (!apply) {
    console.log('\n--dry-run: organization verified, no writes performed. Would provision:')
    printPlan(graph)
    return { dryRun: true, organizationId, agentIds: {}, workflowIds: {}, edgeIds: {}, agentToolIds: {} }
  }

  // 1. Agents -- idempotent on (organization_id, slug): 034_agents.sql.
  const agentIds: Record<string, string> = {}
  for (const agent of graph.agents) {
    const { data, error } = await supabase
      .from('agents')
      .upsert(
        {
          organization_id: organizationId,
          slug: agent.slug,
          name: agent.name,
          description: agent.description,
          system_prompt: agent.system_prompt,
          allowed_channels: agent.allowed_channels as Database['public']['Tables']['agents']['Insert']['allowed_channels'],
          model: agent.model,
          ...(agent.temperature === undefined ? {} : { temperature: agent.temperature }),
        },
        { onConflict: 'organization_id,slug' },
      )
      .select('id')
      .single()
    if (error || !data) throw new Error(`Failed to upsert agent "${agent.slug}": ${error?.message}`)
    agentIds[agent.key] = data.id
  }

  // 2. Workflows -- the org/tool_name uniqueness (080_workflows_unified_schema.sql)
  // is a partial index (`WHERE kind = 'tool' AND tool_name IS NOT NULL`),
  // which supabase-js cannot target via upsert(onConflict). Resolve-or-insert
  // explicitly instead, same as scripts/load-workflow-seeds.ts.
  const workflowIds: Record<string, string> = {}
  for (const workflow of graph.workflows) {
    const { data: existing, error: selectError } = await supabase
      .from('workflows')
      .select('id')
      .eq('org_id', organizationId)
      .eq('tool_name', workflow.tool_name)
      .maybeSingle()
    if (selectError) throw new Error(`Failed to look up workflow "${workflow.tool_name}": ${selectError.message}`)

    if (existing) {
      workflowIds[workflow.key] = existing.id
      continue
    }

    const { data: created, error: insertError } = await supabase
      .from('workflows')
      .insert({
        org_id: organizationId,
        name: workflow.name,
        slug: workflow.tool_name,
        description: workflow.description,
        kind: 'tool',
        tool_name: workflow.tool_name,
        trigger_type: 'tool_call',
        trigger_config: { tool_name: workflow.tool_name, input_schema: workflow.input_schema },
        is_active: true,
      })
      .select('id')
      .single()
    if (insertError || !created) {
      throw new Error(`Failed to create workflow "${workflow.tool_name}": ${insertError?.message}`)
    }
    workflowIds[workflow.key] = created.id
  }

  // 3. Direct tool ownership (agent_tools) -- a specialist's own grant,
  // independent of any partner-edge delegation grant (see the comment on
  // CanaryAgentDef.direct_tools above). Idempotent on (agent_id, workflow_id):
  // the partial unique index agent_tools_workflow_unique (095_agent_workflow_tools.sql,
  // `WHERE workflow_id IS NOT NULL`) cannot be an upsert-onConflict target
  // from supabase-js (same limitation as the workflows table above), so this
  // uses the same explicit select-then-insert pattern.
  const agentToolIds: Record<string, string> = {}
  for (const agent of graph.agents) {
    const agentId = agentIds[agent.key]
    for (const toolName of agent.direct_tools) {
      const workflowId = workflowIds[toolName]
      if (!workflowId) throw new Error(`Agent "${agent.key}" declares direct_tools unknown workflow key "${toolName}".`)

      const { data: existing, error: selectError } = await supabase
        .from('agent_tools')
        .select('id')
        .eq('agent_id', agentId)
        .eq('workflow_id', workflowId)
        .maybeSingle()
      if (selectError) {
        throw new Error(`Failed to look up agent_tools grant "${agent.key}" -> "${toolName}": ${selectError.message}`)
      }

      if (existing) {
        agentToolIds[`${agent.key}:${toolName}`] = existing.id
        continue
      }

      const { data: created, error: insertError } = await supabase
        .from('agent_tools')
        .insert({ organization_id: organizationId, agent_id: agentId, workflow_id: workflowId })
        .select('id')
        .single()
      if (insertError || !created) {
        throw new Error(`Failed to grant direct tool "${toolName}" to agent "${agent.key}": ${insertError?.message}`)
      }
      agentToolIds[`${agent.key}:${toolName}`] = created.id
    }
  }

  // 4. Partner edges -- idempotent on (agent_id, partner_agent_id):
  // 034_agents.sql's uniq_agent_partners_pair.
  const edgeIds: Record<string, string> = {}
  for (const edge of graph.partner_edges) {
    const agentId = agentIds[edge.agent_key]
    const partnerAgentId = agentIds[edge.partner_agent_key]
    if (!agentId || !partnerAgentId) {
      throw new Error(`Edge "${edge.key}" references an unknown agent key ("${edge.agent_key}" -> "${edge.partner_agent_key}").`)
    }
    const { data, error } = await supabase
      .from('agent_partners')
      .upsert(
        {
          organization_id: organizationId,
          agent_id: agentId,
          partner_agent_id: partnerAgentId,
          invocation_description: edge.invocation_description,
          allowed_channels: edge.allowed_channels as Database['public']['Tables']['agent_partners']['Insert']['allowed_channels'],
          max_calls_per_turn: edge.max_calls_per_turn,
          max_depth: edge.max_depth,
          timeout_ms: edge.timeout_ms,
        },
        { onConflict: 'agent_id,partner_agent_id' },
      )
      .select('id')
      .single()
    if (error || !data) throw new Error(`Failed to upsert edge "${edge.key}": ${error?.message}`)
    edgeIds[edge.key] = data.id
  }

  // 5. Delegated workflow grants -- idempotent on (partner_edge_id,
  // workflow_id): 1291_authorized_agent_partner_edges.sql's
  // uniq_agent_partner_workflow_grants.
  for (const edge of graph.partner_edges) {
    const edgeId = edgeIds[edge.key]
    for (const workflowKey of edge.workflow_grants) {
      const workflowId = workflowIds[workflowKey]
      if (!workflowId) throw new Error(`Edge "${edge.key}" grants unknown workflow key "${workflowKey}".`)
      const { error } = await supabase
        .from('agent_partner_workflow_grants')
        .upsert(
          { organization_id: organizationId, partner_edge_id: edgeId, workflow_id: workflowId },
          { onConflict: 'partner_edge_id,workflow_id' },
        )
      if (error) throw new Error(`Failed to grant workflow "${workflowKey}" to edge "${edge.key}": ${error.message}`)
    }
  }

  console.log('\nProvisioned:')
  console.log(
    `  ${graph.agents.length} agent(s), ${graph.workflows.length} workflow(s), ${graph.partner_edges.length} edge(s), ${Object.keys(agentToolIds).length} direct tool grant(s).`,
  )

  return { dryRun: false, organizationId, agentIds, workflowIds, edgeIds, agentToolIds }
}

function printPlan(graph: CanaryGraph): void {
  for (const agent of graph.agents) console.log(`  agent      upsert  ${agent.slug} (${agent.role})`)
  for (const wf of graph.workflows) console.log(`  workflow   resolve ${wf.tool_name} (${wf.access})`)
  for (const agent of graph.agents) {
    for (const toolName of agent.direct_tools) console.log(`  direct     upsert  ${agent.key} owns -> ${toolName}`)
  }
  for (const edge of graph.partner_edges) {
    console.log(`  edge       upsert  ${edge.agent_key} -> ${edge.partner_agent_key} [${edge.allowed_channels.join(',')}]`)
    for (const grantKey of edge.workflow_grants) console.log(`    grant    upsert  -> ${grantKey}`)
  }
}

// Zero network calls -- reads only the local JSON. Safe to run unconditionally.
export function printStructuralPreview(graph: CanaryGraph): void {
  console.log(`Cuts & Culture canary graph (target org slug: ${graph.organization.slug})`)
  console.log('No --org given: structural preview only, no organization was contacted.\n')
  printPlan(graph)
  console.log('\nPass --org=<uuid> for a validated dry run against a real organization row (still writes nothing),')
  console.log('or --org=<uuid> --apply to write. Both are required together to write anything.')
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const graph = loadCanaryGraph()

  if (!args.org) {
    // No --org at all: never touch the network, regardless of --apply.
    assertSafeToWrite(args)
    printStructuralPreview(graph)
    return
  }

  assertSafeToWrite(args)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(2)
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  await provisionCanaryGraph({ supabase, graph, organizationId: args.org, apply: args.apply })
}

// Only run the CLI when this file is executed directly (`tsx
// scripts/provision-canary-graph.ts`), never when imported --
// tests/canary-graph-shape.test.ts imports the exports above against a
// mocked Supabase client and must not trigger a real run merely by loading
// this module (same pattern as scripts/release-gate.ts).
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  main().catch((err) => {
    console.error('Unhandled error:', err)
    process.exit(99)
  })
}
