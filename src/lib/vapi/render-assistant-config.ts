// Pure renderer for a Vapi assistant's outbound configuration: system
// prompt, function/tool JSON-Schema parameters, and per-tool spoken messages.
//
// This module has zero imports of @supabase/* or fetch/network APIs — given
// the same input twice, it produces byte-identical output.
//
// It does NOT template tenant facts. That already happened once, at install
// time, into agent_prompt_versions (see src/lib/org-templates/prompt-template.ts):
// a business's name and address do not change between two phone calls, so
// freezing them into the stored prompt is correct.
//
// The service location block is the deliberate exception. `service_location_mode`
// is a live organization setting an operator can change in Settings at any
// moment, and Phase 138's locked decision is that no prompt may hardcode
// "ask" or "never ask" for a customer address — the engine renders it. The
// widget path does this in buildWorkflowTools(); this is the same rendering
// for the voice path, applied at push time so a mode change reaches the
// assistant on the next push rather than requiring a prompt edit. That is why
// `serviceLocationMode` is a required field: a caller cannot forget it and
// silently ship a prompt with no location rule at all.
//
// Function parameters are shaped from each workflow's own input_schema, so a
// future field there (e.g. Phase 138's customerAddress) reaches Vapi
// automatically with no change to this file.
//
// Per-tool spoken messages: an assistant that already carries tuned lines
// keeps them. This renderer has no way to know which tools are slow for an
// org it has never measured, and the generic fallback is deliberately bland
// ("One moment."), so overwriting an operator's tuned phrasing with it would
// be a regression every time. Existing messages are passed in by the caller
// (read off the live assistant immediately before the PATCH) and preserved
// verbatim; only a tool with no message of its own gets the fallback.

import type { InputSchemaField, InputSchemaMap } from '@/lib/workflows/derive-input-schema'
import { renderServiceLocationBlock } from '@/lib/agent-runtime/service-location-prompt'

export interface AssistantConfigWorkflow {
  toolName: string
  description: string
  inputSchema: InputSchemaMap
}

/** One Vapi per-tool spoken message, in Vapi's own shape. */
export interface VapiToolMessage {
  type: string
  content: string
  [key: string]: unknown
}

export interface AssistantConfigSource {
  systemPrompt: string
  workflows: AssistantConfigWorkflow[]
  /**
   * The organization's `service_location_mode`. Required: an unrecognised or
   * missing value renders the `on_premises` block, never no block at all.
   */
  serviceLocationMode: unknown
  /** Messages the live assistant already carries, keyed by tool name. */
  existingToolMessages?: Record<string, VapiToolMessage[]>
}

export interface RenderedVapiFunction {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
}

export interface RenderedToolMessage {
  toolName: string
  messages: VapiToolMessage[]
}

export interface RenderedAssistantConfig {
  systemPrompt: string
  functions: RenderedVapiFunction[]
  toolMessages: RenderedToolMessage[]
}

const DEFAULT_REQUEST_START = 'One moment.'

/**
 * The token a prompt uses to place the service location rule itself. A prompt
 * without it still gets the rule, appended as its own section — a prompt can
 * never end up with no location rule.
 */
export const SERVICE_LOCATION_TOKEN = '{{service_location_block}}'

/** Maps one input_schema field to a JSON-Schema property. No Zod involved. */
function inputSchemaFieldToJsonSchema(field: InputSchemaField): Record<string, unknown> {
  const type = field.type ?? 'string'
  const knownTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object']
  const jsonSchema: Record<string, unknown> = {
    type: knownTypes.includes(type) ? type : 'string',
  }
  if (field.description) jsonSchema.description = field.description
  if (field.enum) jsonSchema.enum = field.enum
  return jsonSchema
}

function renderFunction(workflow: AssistantConfigWorkflow): RenderedVapiFunction {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, field] of Object.entries(workflow.inputSchema)) {
    properties[key] = inputSchemaFieldToJsonSchema(field)
    if (field.required) required.push(key)
  }

  return {
    name: workflow.toolName,
    description: workflow.description,
    parameters: { type: 'object', properties, required },
  }
}

/**
 * Places the engine-rendered service location rule into a prompt: at the
 * token when the prompt declares one, appended as its own section otherwise.
 */
export function renderSystemPrompt(template: string, serviceLocationMode: unknown): string {
  const block = renderServiceLocationBlock(serviceLocationMode)

  if (template.includes(SERVICE_LOCATION_TOKEN)) {
    return template.replaceAll(SERVICE_LOCATION_TOKEN, block)
  }

  const separator = template.endsWith('\n') ? '\n' : '\n\n'
  return `${template}${separator}## Service location\n${block}\n`
}

/**
 * Renders an assistant's system prompt, function schemas, and per-tool
 * spoken messages from plain data — no network, no Supabase, deterministic.
 */
export function renderAssistantConfig(source: AssistantConfigSource): RenderedAssistantConfig {
  const existing = source.existingToolMessages ?? {}

  return {
    systemPrompt: renderSystemPrompt(source.systemPrompt, source.serviceLocationMode),
    functions: source.workflows.map(renderFunction),
    toolMessages: source.workflows.map((w) => {
      const kept = existing[w.toolName]
      return {
        toolName: w.toolName,
        messages:
          kept && kept.length > 0
            ? kept
            : [{ type: 'request-start', content: DEFAULT_REQUEST_START }],
      }
    }),
  }
}
