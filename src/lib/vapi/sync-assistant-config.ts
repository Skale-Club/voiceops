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
import { vapiFetch, vapiFetchWrite, VapiApiError } from './client'
import { renderAssistantConfig, type AssistantConfigWorkflow } from './render-assistant-config'

export interface PushAssistantConfigResult {
  ok: boolean
  error?: string
}

interface VapiAssistantGetResponse {
  model?: Record<string, unknown>
  [key: string]: unknown
}

export async function pushAssistantConfig(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  vapiAssistantId: string
): Promise<PushAssistantConfigResult> {
  // 1. Resolve the org's entry orchestrator: voice's channel default, falling
  // back to web_widget's -- an org may run the mesh on the widget before
  // voice is wired.
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

    assistantWorkflows = (workflowRows ?? [])
      .filter((w): w is typeof w & { tool_name: string } => !!w.tool_name)
      .map((w) => ({
        toolName: w.tool_name,
        description: w.description ?? `Execute the workflow: ${w.name}`,
        inputSchema: getWorkflowInputSchema(
          w.current_version_id ? definitionById.get(w.current_version_id) ?? null : null
        ),
      }))
  }

  // 4. Render as pure data.
  const rendered = renderAssistantConfig({
    systemPrompt: promptVersion.system_prompt,
    workflows: assistantWorkflows,
  })

  // 5. Resolve + decrypt the org's Vapi API key (same lookup as
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

  // 6. PATCH. Fetch the current assistant first so unrelated `model` fields
  // (provider, model name, voice, etc.) are preserved -- only `messages` and
  // `tools` are replaced.
  try {
    const current = await vapiFetch<VapiAssistantGetResponse>(apiKey, `/assistant/${vapiAssistantId}`)

    const requestStartByTool = new Map(rendered.toolMessages.map((m) => [m.toolName, m.requestStart]))

    const tools = rendered.functions.map((fn) => ({
      type: 'function',
      function: {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      },
      messages: [{ type: 'request-start', content: requestStartByTool.get(fn.name) ?? 'One moment.' }],
    }))

    const model = {
      ...(current.model ?? {}),
      messages: [{ role: 'system', content: rendered.systemPrompt }],
      tools,
    }

    await vapiFetchWrite(apiKey, `/assistant/${vapiAssistantId}`, 'PATCH', { model })
    return { ok: true }
  } catch (err) {
    const message = err instanceof VapiApiError ? err.message : 'Failed to push assistant config to Vapi.'
    return { ok: false, error: message }
  }
}
