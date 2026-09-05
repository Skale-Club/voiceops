// The outbound half of Vapi assistant configuration: given an org's entry
// orchestrator and its granted workflows, render the assistant's prompt,
// function schemas and per-tool spoken messages, and PATCH that
// configuration onto the org's mapped Vapi assistant.
//
// Closes the gap named in 139-CONTEXT.md: sync-assistants.ts only mirrors
// Vapi assistants INTO assistant_mappings; nothing before this module wrote
// a prompt or a tool schema TO Vapi. Every prior change to the Cuts &
// Culture assistant was a manual PATCH from an uncommitted probe script.
//
// The PATCH request body shape below (`model.messages[0]` for the system
// prompt, `model.tools[]` with `{type: 'function', function: {...}, messages:
// [...]}` for functions and per-tool spoken lines) is not guessed — it is
// the exact shape this repo's own tests/manual/vapi-update.test.ts and
// tests/manual/vapi-set-tool-messages.test.ts already confirmed against a
// live Vapi assistant (200 responses, tools/messages verified via
// tests/manual/vapi-schema-probe.test.ts), the historical record left by
// every prior "manual PATCH from a probe script." Never throws past this
// function's boundary — same never-throw convention as syncVapiAssistants().

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { decrypt } from '@/lib/crypto'
import { getWorkflowInputSchema } from '@/lib/workflows/derive-input-schema'
import { applyServiceLocationMode } from '@/lib/agent-runtime/service-location-schema'
import { renderPromptTemplate, resolveTenantFacts } from '@/lib/org-templates/prompt-template'
import { vapiFetch, vapiFetchWrite, VapiApiError } from './client'
import {
  renderAssistantConfig,
  type AssistantConfigWorkflow,
  type RenderedAssistantConfig,
  type VapiToolMessage,
} from './render-assistant-config'

export interface PushAssistantConfigResult {
  ok: boolean
  error?: string
  /**
   * What was (or, under dryRun, would have been) PATCHed. Present whenever
   * resolution and rendering succeeded, so an operator can inspect the exact
   * payload before it reaches a live phone-answering assistant.
   */
  rendered?: RenderedAssistantConfig
}

export interface PushAssistantConfigOptions {
  /** Resolve, fetch and render, but do not PATCH. */
  dryRun?: boolean
}

interface VapiAssistantGetResponse {
  model?: Record<string, unknown>
  [key: string]: unknown
}

interface VapiExistingTool {
  function?: { name?: string }
  messages?: VapiToolMessage[]
  /** Per-tool routing: where Vapi POSTs the tool call, and the secret it sends. */
  server?: Record<string, unknown>
}

/**
 * Reads the per-tool `server` blocks (URL + webhook secret) the assistant
 * already carries, keyed by tool name.
 *
 * This exists because the first real push dropped them. A tool without a
 * `server` block, on an assistant and phone number without one either, has
 * nowhere to send its call: the phone robot answers, decides to look up the
 * customer, and the lookup goes into the void. Routing is not part of what
 * this module renders, so it must be carried through untouched — the same
 * discipline as the tuned messages, with a harder failure when it is missing.
 */
function existingToolServersOf(current: VapiAssistantGetResponse): Record<string, Record<string, unknown>> {
  const tools = (current.model?.tools ?? []) as VapiExistingTool[]
  const byName: Record<string, Record<string, unknown>> = {}
  for (const tool of tools) {
    const name = tool.function?.name
    if (name && tool.server && typeof tool.server === 'object') byName[name] = tool.server
  }
  return byName
}

/**
 * Reads the tuned per-tool spoken lines the assistant already carries, keyed
 * by tool name, so a push preserves them instead of flattening every tool to
 * the generic fallback.
 */
function existingToolMessagesOf(current: VapiAssistantGetResponse): Record<string, VapiToolMessage[]> {
  const tools = (current.model?.tools ?? []) as VapiExistingTool[]
  const byName: Record<string, VapiToolMessage[]> = {}
  for (const tool of tools) {
    const name = tool.function?.name
    if (name && Array.isArray(tool.messages) && tool.messages.length > 0) {
      byName[name] = tool.messages
    }
  }
  return byName
}

export async function pushAssistantConfig(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  vapiAssistantId: string,
  options: PushAssistantConfigOptions = {}
): Promise<PushAssistantConfigResult> {
  // 1. Resolve the org's entry orchestrator: voice's channel default, falling
  // back to web_widget's -- an org may run the mesh on the widget before
  // voice is wired.
  const { data: org } = await supabase
    .from('organizations')
    .select('service_location_mode')
    .eq('id', organizationId)
    .maybeSingle()

  const { data: defaults } = await supabase
    .from('agent_channel_defaults')
    .select('channel, agent_id')
    .eq('organization_id', organizationId)
    .in('channel', ['voice', 'web_widget'])

  const voiceDefault = (defaults ?? []).find((d) => d.channel === 'voice')
  const widgetDefault = (defaults ?? []).find((d) => d.channel === 'web_widget')
  const orchestratorAgentId = voiceDefault?.agent_id ?? widgetDefault?.agent_id

  if (!orchestratorAgentId) {
    return { ok: false, error: 'No voice or web_widget default agent configured for this org.' }
  }

  // 2. Resolve the rendered system prompt the same way resolveAgent() does --
  // via active_prompt_version_id -> agent_prompt_versions.system_prompt.
  // Never falls back to agents.system_prompt (legacy/unused by the runtime).
  const { data: agent } = await supabase
    .from('agents')
    .select('id, active_prompt_version_id')
    .eq('id', orchestratorAgentId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!agent?.active_prompt_version_id) {
    return { ok: false, error: 'Entry orchestrator has no active prompt version.' }
  }

  const { data: promptVersion } = await supabase
    .from('agent_prompt_versions')
    .select('system_prompt')
    .eq('id', agent.active_prompt_version_id)
    .maybeSingle()

  if (!promptVersion?.system_prompt) {
    return { ok: false, error: 'Entry orchestrator active prompt version has no text.' }
  }

  // 3. Resolve every workflow this agent's mesh can reach: its own direct
  // grants UNION every workflow granted across its outgoing partner edges --
  // Vapi needs every function the CALL might invoke through delegation, not
  // only the orchestrator's own direct grants (normally empty for an
  // orchestrator, per this phase's verified graph shape).
  const { data: directToolRows } = await supabase
    .from('agent_tools')
    .select('workflow_id')
    .eq('agent_id', orchestratorAgentId)
    .eq('organization_id', organizationId)
    .not('workflow_id', 'is', null)

  const { data: partnerEdgeRows } = await supabase
    .from('agent_partners')
    .select('id')
    .eq('agent_id', orchestratorAgentId)
    .eq('organization_id', organizationId)

  const edgeIds = (partnerEdgeRows ?? []).map((e) => e.id)
  let delegatedWorkflowIds: string[] = []
  if (edgeIds.length > 0) {
    const { data: grantRows } = await supabase
      .from('agent_partner_workflow_grants')
      .select('workflow_id')
      .in('partner_edge_id', edgeIds)
    delegatedWorkflowIds = (grantRows ?? []).map((g) => g.workflow_id)
  }

  const workflowIds = new Set<string>([
    ...(directToolRows ?? [])
      .map((t) => t.workflow_id)
      .filter((id): id is string => !!id),
    ...delegatedWorkflowIds,
  ])

  let assistantWorkflows: AssistantConfigWorkflow[] = []
  if (workflowIds.size > 0) {
    const { data: workflowRows } = await supabase
      .from('workflows')
      .select('id, tool_name, name, description, current_version_id')
      .in('id', Array.from(workflowIds))

    const versionIds = (workflowRows ?? [])
      .map((w) => w.current_version_id)
      .filter((id): id is string => !!id)

    const definitionById = new Map<string, unknown>()
    if (versionIds.length > 0) {
      const { data: versionRows } = await supabase
        .from('workflow_versions')
        .select('id, definition')
        .in('id', versionIds)
      for (const v of versionRows ?? []) definitionById.set(v.id, v.definition)
    }

    // The same schema-boundary rule the widget applies in buildWorkflowTools():
    // for an on_premises org the model must not even see that customerAddress
    // exists on book_appointment; for at_customer it is required. Without this
    // the voice prompt would ask for an address the function has no field to
    // carry - the prompt and the schema must be rendered from the same setting.
    assistantWorkflows = (workflowRows ?? [])
      .filter((w): w is typeof w & { tool_name: string } => !!w.tool_name)
      .map((w) => ({
        toolName: w.tool_name,
        description: w.description ?? `Execute the workflow: ${w.name}`,
        inputSchema: applyServiceLocationMode(
          getWorkflowInputSchema(
            w.current_version_id ? definitionById.get(w.current_version_id) ?? null : null
          ),
          org?.service_location_mode
        ),
      }))
  }

  // 4. Resolve + decrypt the org's Vapi API key (same lookup as
  // syncVapiAssistants()).
  const { data: integration } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', organizationId)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.encrypted_api_key) {
    return { ok: false, error: 'Vapi integration not connected.' }
  }

  let apiKey: string
  try {
    apiKey = await decrypt(integration.encrypted_api_key)
  } catch {
    return { ok: false, error: 'Could not read the saved Vapi API key.' }
  }

  // 5. Fetch the current assistant BEFORE rendering, for two reasons: its
  // unrelated `model` fields (provider, model name, voice, etc.) must be
  // preserved through the PATCH, and its tuned per-tool spoken lines are an
  // input to rendering rather than something to overwrite.
  try {
    const current = await vapiFetch<VapiAssistantGetResponse>(apiKey, `/assistant/${vapiAssistantId}`)

    // 6. Render as pure data.
    //
    // Tenant facts are resolved here rather than inside the pure renderer
    // because resolveTenantFacts() is I/O. They must be rendered at push time:
    // scripts/templatize-agent-prompts.ts (139-06) deliberately turns a live
    // tenant's prompts back INTO templates carrying `{{business_name}}` /
    // `{{business_location}}`, so pushing a stored prompt verbatim would put
    // raw tokens in front of a caller. Vapi's own call-time variables
    // (`{{customer.number}}`, `{{now}}`) are untouched — renderPromptTemplate()
    // replaces only the two tenant-fact tokens it owns.
    const facts = await resolveTenantFacts(supabase, organizationId)

    const rendered = renderAssistantConfig({
      systemPrompt: renderPromptTemplate(promptVersion.system_prompt, facts),
      workflows: assistantWorkflows,
      serviceLocationMode: org?.service_location_mode,
      existingToolMessages: existingToolMessagesOf(current),
    })

    const messagesByTool = new Map(rendered.toolMessages.map((m) => [m.toolName, m.messages]))
    const serverByTool = existingToolServersOf(current)

    // Routing for a tool that has none of its own: the block every other tool
    // on this assistant shares, if they all share one. A brand-new function
    // then inherits where its siblings already go. If the assistant carries no
    // per-tool routing at all and has no assistant-level `server` either, its
    // calls cannot reach us and pushing would ship a mute robot: refuse.
    const distinctServers = new Set(Object.values(serverByTool).map((srv) => JSON.stringify(srv)))
    const sharedServer =
      distinctServers.size === 1 ? (JSON.parse([...distinctServers][0]) as Record<string, unknown>) : undefined
    const assistantLevelServer = current.server && typeof current.server === 'object'

    const tools = rendered.functions.map((fn) => {
      const server = serverByTool[fn.name] ?? sharedServer
      return {
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
        },
        messages: messagesByTool.get(fn.name) ?? [{ type: 'request-start', content: 'One moment.' }],
        ...(server ? { server } : {}),
      }
    })

    const unroutedTools = tools.filter((t) => !('server' in t))
    if (unroutedTools.length > 0 && !assistantLevelServer) {
      return {
        ok: false,
        error:
          `Refusing to push: ${unroutedTools.map((t) => t.function.name).join(', ')} would have no server ` +
          'to send tool calls to (no per-tool server block to carry over and no assistant-level server).',
      }
    }

    const model = {
      ...(current.model ?? {}),
      messages: [{ role: 'system', content: rendered.systemPrompt }],
      tools,
    }

    // 7. PATCH -- unless this is a dry run, in which case the caller gets the
    // fully rendered payload and the assistant is left untouched.
    if (options.dryRun) return { ok: true, rendered }

    await vapiFetchWrite(apiKey, `/assistant/${vapiAssistantId}`, 'PATCH', { model })
    return { ok: true, rendered }
  } catch (err) {
    const message = err instanceof VapiApiError ? err.message : 'Failed to push assistant config to Vapi.'
    return { ok: false, error: message }
  }
}
