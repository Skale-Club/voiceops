// Pure renderer for a Vapi assistant's outbound configuration: system
// prompt (pass-through), function/tool JSON-Schema parameters, and per-tool
// spoken messages.
//
// This module has zero imports of @supabase/* or fetch/network APIs — given
// the same input twice, it produces byte-identical output. It does NOT
// template tenant facts (that already happened once, at install time, into
// agent_prompt_versions — see src/lib/org-templates/prompt-template.ts); it
// only shapes functions/messages from a workflow's own input_schema, so a
// future field there (e.g. Phase 138's customerAddress) reaches Vapi
// automatically with no change to this file.
//
// requestStart is deliberately generic ("One moment.") for every tool: this
// module has no way to know which tools are slow for an org it has never
// measured. Per-tool tuning (the phrasing and delayed/failed messages
// recorded for Cuts & Culture in
// .planning/workstreams/omnichannel-agent-orchestration/canary/vapi-tool-messages.md)
// is an operator refinement layered on top later, out of this renderer's
// scope.

import type { InputSchemaField, InputSchemaMap } from '@/lib/workflows/derive-input-schema'

export interface AssistantConfigWorkflow {
  toolName: string
  description: string
  inputSchema: InputSchemaMap
}

export interface AssistantConfigSource {
  systemPrompt: string
  workflows: AssistantConfigWorkflow[]
}

export interface RenderedVapiFunction {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
}

export interface RenderedToolMessage {
  toolName: string
  requestStart: string
}

export interface RenderedAssistantConfig {
  systemPrompt: string
  functions: RenderedVapiFunction[]
  toolMessages: RenderedToolMessage[]
}

const DEFAULT_REQUEST_START = 'One moment.'

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
 * Renders an assistant's system prompt, function schemas, and per-tool
 * spoken messages from plain data — no network, no Supabase, deterministic.
 */
export function renderAssistantConfig(source: AssistantConfigSource): RenderedAssistantConfig {
  return {
    systemPrompt: source.systemPrompt,
    functions: source.workflows.map(renderFunction),
    toolMessages: source.workflows.map((w) => ({
      toolName: w.toolName,
      requestStart: DEFAULT_REQUEST_START,
    })),
  }
}
