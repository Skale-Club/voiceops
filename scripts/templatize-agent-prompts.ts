#!/usr/bin/env node
// scripts/templatize-agent-prompts.ts
// Phase 139 Plan 06 (TMPL-02): removes a live tenant's hardcoded business
// identity from its own agent prompts, replacing it with the
// `{{business_name}}` / `{{business_location}}` tokens
// src/lib/org-templates/prompt-template.ts (139-02) knows how to render.
//
// This is the one-time content fix that makes 139-CONTEXT.md's design point
// 2 true for the mesh's first real tenant: "A prompt today hardcodes ...
// What varies is the business." Without this, capturing Cuts & Culture's
// mesh into an org template would bake "Cuts & Culture Barbershop, 212
// Newbury Street, Boston" into every org that ever installs it.
//
// SAFETY MODEL (mirrors scripts/provision-canary-graph.ts):
//   - Dry run is the default. With --org=<uuid> and no --apply, the script
//     resolves the organization (read-only), resolves its tenant facts
//     (read-only), and prints the diff for every agent prompt that would
//     change. It performs no insert/update anywhere.
//   - Writing requires --org=<uuid> AND --apply AND --expect-slug=<slug>
//     together. There is no environment-variable org id and no "current
//     org" fallback -- this script never reads an org id from process.env.
//   - --expect-slug exists because, unlike the canary graph, this script
//     carries no declared target of its own -- it is deliberately generic
//     (any org, any agent) so the tenant identity comes only from the
//     command line. Before any write, the live organization row's slug
//     must match --expect-slug, or the script refuses.
//   - MANDATORY ROUNDTRIP GUARD, enforced before any write: for every prompt
//     that would change, the templatized text is rendered back through
//     renderPromptTemplate() with the SAME tenant's own facts. If that does
//     not reproduce the original prompt byte-for-byte, the script throws
//     and writes nothing for that agent. A prompt that does not round-trip
//     means the tokens do not reconstruct the original text, and silently
//     drifting a live prompt is worse than doing nothing.
//   - Append-only history: every changed prompt gets a NEW
//     agent_prompt_versions row (next version = current max + 1 for that
//     agent), and only then is agents.active_prompt_version_id repointed at
//     it. No existing version row is ever updated or deleted -- this is the
//     same discipline installAgents() (139-05) follows for a fresh install,
//     and its absence is the specific bug (136-CONTEXT.md / this phase's
//     "Known debt") that made the canary mesh unusable on first
//     provisioning.
//
// This script has never been run with --apply against a real organization.
// It is exercised only through tests/templatize-agent-prompts.test.ts with
// an in-memory fake Supabase client -- see that file for the proof. Running
// it against the live Cuts & Culture org is execute-phase work for a later
// plan in this phase, not this one.
//
// Usage:
//   tsx scripts/templatize-agent-prompts.ts --org=<uuid>
//     # validated dry run: resolves the org and its facts, prints the diff
//     # for every agent prompt that would change, writes nothing
//   tsx scripts/templatize-agent-prompts.ts --org=<uuid> --apply --expect-slug=<slug>
//     # writes a new agent_prompt_versions row per changed agent and
//     # repoints active_prompt_version_id -- only if every changed prompt
//     # passes the roundtrip guard and the org's live slug matches
//     # --expect-slug

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { renderPromptTemplate, resolveTenantFacts, type TenantFacts } from '../src/lib/org-templates/prompt-template'
import { parseArgs, assertSafeToWrite, type ParsedArgs } from './provision-canary-graph'

type SupaClient = ReturnType<typeof createClient<Database>>

// ── CLI arg parsing ──────────────────────────────────────────────────────────

// --expect-slug is specific to this script (provision-canary-graph.ts has no
// equivalent -- its target slug is declared in the graph JSON, not on the
// command line). Parsed separately from argv, same deliberate
// argv-only/never-process.env discipline as parseArgs() itself.
export function parseExpectSlug(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith('--expect-slug=')) return arg.slice('--expect-slug='.length) || null
  }
  return null
}

export function assertExpectSlugPresentForApply(args: ParsedArgs, expectSlug: string | null): void {
  if (args.apply && !expectSlug) {
    throw new Error(
      'Refusing to write: --apply requires an explicit --expect-slug=<slug> on the command line, checked against the live organization row before any write.',
    )
  }
}

// ── Pure templatizing + roundtrip guard ─────────────────────────────────────

/**
 * Replace one tenant's literal business identity in a prompt with the
 * `{{business_location}}` / `{{business_name}}` tokens
 * renderPromptTemplate() understands.
 *
 * Two passes, in order:
 *   1. When facts.businessAddress is present, build the exact
 *      "businessName, businessAddress" string renderPromptTemplate() would
 *      produce for {{business_location}} and replace its FIRST literal
 *      occurrence with the token. Only the first occurrence -- a prompt
 *      that happens to repeat the full "name, address" string more than
 *      once is not this script's problem to collapse.
 *   2. Replace any REMAINING literal occurrences of the bare business name
 *      with {{business_name}}. When there is no address at all, this pass
 *      is the only one that runs, so a bare-name-only prompt correctly
 *      templatizes to {{business_name}}, not {{business_location}} (which
 *      would render identically for an address-less tenant, but the
 *      simpler token is the correct choice when there was never an address
 *      substring to anchor a location replacement to).
 *
 * A prompt containing neither substring is returned unchanged with
 * `changed: false` -- this is not an error, just nothing to do for that
 * agent.
 */
export function templatizeAgentPrompt(
  prompt: string,
  facts: TenantFacts,
): { changed: boolean; result: string } {
  let result = prompt
  let changed = false

  const hasAddress = !!(facts.businessAddress && facts.businessAddress.trim().length > 0)

  if (hasAddress) {
    const location = `${facts.businessName}, ${facts.businessAddress}`
    const idx = result.indexOf(location)
    if (idx !== -1) {
      result = result.slice(0, idx) + '{{business_location}}' + result.slice(idx + location.length)
      changed = true
    }
  }

  if (facts.businessName && result.includes(facts.businessName)) {
    result = result.split(facts.businessName).join('{{business_name}}')
    changed = true
  }

  return changed ? { changed: true, result } : { changed: false, result: prompt }
}

/**
 * Throws unless rendering `templatized` back through renderPromptTemplate()
 * with `facts` reproduces `original` byte-for-byte. Must be called, and must
 * pass, before this script writes anything for `agentSlug` -- writing a
 * template that does not reconstruct the live prompt would silently change
 * production voice/widget behaviour for the tenant that already depends on
 * the original wording.
 */
export function assertRoundtrips(
  original: string,
  templatized: string,
  facts: TenantFacts,
  agentSlug: string,
): void {
  const rendered = renderPromptTemplate(templatized, facts)
  if (rendered !== original) {
    throw new Error(
      `Roundtrip check failed for agent "${agentSlug}": rendering the templatized prompt with the tenant's own facts did not reproduce the original prompt text. Refusing to write anything for this agent.`,
    )
  }
}

// ── Per-organization run ─────────────────────────────────────────────────────

export interface TemplatizeAgentChange {
  agentSlug: string
  changed: boolean
  newVersionId?: string
}

export interface TemplatizeResult {
  dryRun: boolean
  organizationId: string
  changes: TemplatizeAgentChange[]
}

export interface TemplatizeOptions {
  supabase: SupaClient
  organizationId: string
  // Null is only valid when `apply` is false (validated dry run without a
  // slug check yet) -- assertExpectSlugPresentForApply() enforces this is
  // never null when `apply` is true, before this function is ever called
  // from main().
  expectSlug: string | null
  apply: boolean
}

export async function templatizeOrgAgentPrompts(options: TemplatizeOptions): Promise<TemplatizeResult> {
  const { supabase, organizationId, expectSlug, apply } = options

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('id', organizationId)
    .maybeSingle()
  if (orgError) throw new Error(`Could not resolve organization ${organizationId}: ${orgError.message}`)
  if (!org) throw new Error(`Organization ${organizationId} does not exist. Refusing to proceed.`)
  if (expectSlug && org.slug !== expectSlug) {
    throw new Error(
      `Organization ${organizationId} has slug "${org.slug}", not "${expectSlug}". Refusing to templatize a different tenant's prompts.`,
    )
  }

  console.log(`Target organization: ${org.slug} (${organizationId})`)

  const facts = await resolveTenantFacts(supabase, organizationId)

  const { data: agentRows, error: agentsError } = await supabase
    .from('agents')
    .select('id, slug, active_prompt_version_id')
    .eq('organization_id', organizationId)
  if (agentsError) throw new Error(`Failed to list agents for organization ${organizationId}: ${agentsError.message}`)

  const changes: TemplatizeAgentChange[] = []

  for (const agent of agentRows ?? []) {
    if (!agent.active_prompt_version_id) {
      console.log(`  ${agent.slug}: no active prompt version, skipping`)
      changes.push({ agentSlug: agent.slug, changed: false })
      continue
    }

    const { data: activeVersion, error: versionError } = await supabase
      .from('agent_prompt_versions')
      .select('id, version, system_prompt')
      .eq('id', agent.active_prompt_version_id)
      .maybeSingle()
    if (versionError || !activeVersion) {
      throw new Error(
        `Failed to load active prompt version for agent "${agent.slug}": ${versionError?.message ?? 'not found'}`,
      )
    }

    const { changed, result } = templatizeAgentPrompt(activeVersion.system_prompt, facts)

    if (!changed) {
      console.log(`  ${agent.slug}: no change needed`)
      changes.push({ agentSlug: agent.slug, changed: false })
      continue
    }

    // Fail closed BEFORE any write, and before even printing the diff as
    // "would apply" -- a prompt that fails this check does not get written,
    // dry run or not.
    assertRoundtrips(activeVersion.system_prompt, result, facts, agent.slug)

    console.log(`  ${agent.slug}: would change`)
    console.log(`    - ${activeVersion.system_prompt}`)
    console.log(`    + ${result}`)

    if (!apply) {
      changes.push({ agentSlug: agent.slug, changed: true })
      continue
    }

    const { data: maxVersionRows, error: maxVersionError } = await supabase
      .from('agent_prompt_versions')
      .select('version')
      .eq('agent_id', agent.id)
      .order('version', { ascending: false })
      .limit(1)
    if (maxVersionError) {
      throw new Error(`Failed to resolve current max prompt version for agent "${agent.slug}": ${maxVersionError.message}`)
    }
    const maxVersion =
      Array.isArray(maxVersionRows) && maxVersionRows.length > 0
        ? (maxVersionRows[0].version as number)
        : activeVersion.version
    const nextVersion = maxVersion + 1

    const { data: newVersion, error: insertError } = await supabase
      .from('agent_prompt_versions')
      .insert({
        organization_id: organizationId,
        agent_id: agent.id,
        version: nextVersion,
        system_prompt: result,
      })
      .select('id')
      .single()
    if (insertError || !newVersion) {
      throw new Error(`Failed to insert new prompt version for agent "${agent.slug}": ${insertError?.message}`)
    }

    const { error: updateError } = await supabase
      .from('agents')
      .update({ active_prompt_version_id: newVersion.id })
      .eq('id', agent.id)
    if (updateError) {
      throw new Error(`Failed to repoint active_prompt_version_id for agent "${agent.slug}": ${updateError.message}`)
    }

    changes.push({ agentSlug: agent.slug, changed: true, newVersionId: newVersion.id })
  }

  return { dryRun: !apply, organizationId, changes }
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const expectSlug = parseExpectSlug(argv)

  // This script always operates against a real org's live content -- there
  // is no zero-argument structural-preview mode like provision-canary-graph.ts's,
  // since there is no local declarative artifact to preview here.
  if (!args.org) {
    throw new Error('Refusing to run: --org=<uuid> is required (there is no default organization).')
  }

  assertSafeToWrite(args)
  assertExpectSlugPresentForApply(args, expectSlug)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(2)
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  const result = await templatizeOrgAgentPrompts({
    supabase,
    organizationId: args.org,
    expectSlug,
    apply: args.apply,
  })

  const changedCount = result.changes.filter((c) => c.changed).length
  if (result.dryRun) {
    console.log(`\n--dry-run: organization verified, no writes performed. ${changedCount} agent prompt(s) would change.`)
  } else {
    console.log(`\nApplied: ${changedCount} agent prompt(s) got a new version.`)
  }
}

// Only run the CLI when this file is executed directly (`tsx
// scripts/templatize-agent-prompts.ts`), never when imported --
// tests/templatize-agent-prompts.test.ts imports the exports above against
// a mocked Supabase client and must not trigger a real run merely by
// loading this module (same pattern as scripts/provision-canary-graph.ts).
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  main().catch((err) => {
    console.error('Unhandled error:', err)
    process.exit(99)
  })
}
