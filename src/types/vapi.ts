// src/types/vapi.ts
// Zod schemas for Vapi tool-call webhook payloads
// Validated against Vapi API reference 2024 | assistantId is camelCase, lives at message.call

import { z } from 'zod'

// Individual tool call within a toolCallList
// Arguments may arrive as an object or as a JSON-encoded string (the
// OpenAI-style shape serialises them). Accept both; decode the string form.
const ToolArgsSchema = z.union([z.record(z.unknown()), z.string()]).optional()

// Flattened shape, as the older Vapi reference documented it.
const FlatToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Vapi docs show both 'arguments' (newer) and 'parameters' (older). Accept both defensively.
  arguments: ToolArgsSchema,
  parameters: ToolArgsSchema,
})

// Nested OpenAI-style shape. This is what Vapi ACTUALLY sent on the first real
// tool call ever to reach production (2026-09-04, call 01a06de4-…): every
// item in toolCallList was {id, type: 'function', function: {name, arguments}},
// with `arguments` a JSON string. The flat-only schema rejected it, the route
// returned an empty results list before logging anything, and Vapi reported
// "No result returned for <toolCallId>" for both calls in the conversation.
const NestedToolCallSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: ToolArgsSchema,
  }),
})

export const VapiToolCallSchema = z.union([FlatToolCallSchema, NestedToolCallSchema])

/** The single shape the rest of the codebase works with. */
export interface VapiToolCall {
  id: string
  name: string
  arguments?: Record<string, unknown>
  parameters?: Record<string, unknown>
  /** Present when Vapi supplied a non-empty argument string that is not a JSON object. */
  argumentParseError?: string
}

interface DecodedArgs {
  value?: Record<string, unknown>
  error?: string
}

function decodeArgs(v: unknown): DecodedArgs {
  if (v == null) return {}
  if (typeof v === 'string') {
    if (!v.trim()) return { value: {} }
    try {
      const parsed: unknown = JSON.parse(v)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'arguments must decode to a JSON object' }
      }
      return { value: parsed as Record<string, unknown> }
    } catch {
      return { error: 'arguments contain malformed JSON' }
    }
  }
  return { value: v as Record<string, unknown> }
}

/**
 * Normalise either accepted wire shape into the flat VapiToolCall used
 * downstream, so the route, logging and idempotency code never has to know
 * which one Vapi chose to send.
 */
export function normalizeVapiToolCall(raw: z.infer<typeof VapiToolCallSchema>): VapiToolCall {
  if ('function' in raw) {
    const decoded = decodeArgs(raw.function.arguments)
    return {
      id: raw.id,
      name: raw.function.name,
      arguments: decoded.value,
      argumentParseError: decoded.error,
    }
  }
  const decodedArguments = decodeArgs(raw.arguments)
  const decodedParameters = decodeArgs(raw.parameters)
  return {
    id: raw.id,
    name: raw.name,
    arguments: decodedArguments.value,
    parameters: decodedParameters.value,
    argumentParseError: decodedArguments.error ?? decodedParameters.error,
  }
}

// Full tool-call message envelope
export const VapiToolCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('tool-calls'),
    call: z.object({
      id: z.string(),
      assistantId: z.string(),   // camelCase | confirmed from Vapi API reference
      orgId: z.string().optional(),
      // Caller ID. Trustworthy identity for the person on the line — unlike a
      // phone number the assistant transcribed from speech — so executors get
      // it via ActionContext.callerNumber instead of relying on the LLM.
      customer: z.object({
        number: z.string().optional(),
        name: z.string().optional(),
      }).passthrough().optional(),
      // The org-side number the call landed on. Vapi has always sent these; they
      // were dropped by passthrough() until Vapi-native numbers needed them to
      // resolve the tenant when the assistant isn't mapped.
      phoneNumberId: z.string().optional(),
      phoneNumber: z.object({
        number: z.string().optional(),
      }).passthrough().optional(),
    }).passthrough(),            // allow additional Vapi fields without validation failure
    toolCallList: z.array(VapiToolCallSchema),
  }),
})

export type VapiToolCallMessage = z.infer<typeof VapiToolCallMessageSchema>

// Helper: coalesce arguments/parameters field (Vapi sends either depending on version)
export function getToolArguments(toolCall: VapiToolCall): Record<string, unknown> {
  if (toolCall.argumentParseError) {
    throw new Error(`Invalid Vapi tool arguments: ${toolCall.argumentParseError}`)
  }
  return toolCall.arguments ?? toolCall.parameters ?? {}
}

// ---------------------------------------------------------------------------
// End-of-call webhook schemas (OBS-01)
// ---------------------------------------------------------------------------

export const ArtifactMessageSchema = z.object({
  role: z.string(),
  message: z.string().optional(),
  time: z.number().optional(),
  endTime: z.number().optional(),
  secondsFromStart: z.number().optional(),
  toolCalls: z.array(z.record(z.unknown())).optional(),
  result: z.string().optional(),
}).passthrough()

export type ArtifactMessage = z.infer<typeof ArtifactMessageSchema>

export const VapiEndOfCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('end-of-call-report'),
    endedReason: z.string(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    cost: z.number().optional(),
    call: z.object({
      id: z.string(),
      assistantId: z.string().optional(),
      orgId: z.string().optional(),
      status: z.string().optional(),
      type: z.string().optional(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      cost: z.number().optional(),
      // Campaign calls carry campaign_contact_id here so either webhook route
      // (/api/vapi/calls or /api/vapi/campaigns) can update campaign_contacts.
      metadata: z.record(z.unknown()).optional(),
      customer: z.object({
        number: z.string().optional(),
        name: z.string().optional(),
      }).optional(),
      // See VapiToolCallMessageSchema — same fields, same reason.
      phoneNumberId: z.string().optional(),
      phoneNumber: z.object({
        number: z.string().optional(),
      }).passthrough().optional(),
    }).passthrough().optional(),
    artifact: z.object({
      transcript: z.string().optional(),
      messages: z.array(ArtifactMessageSchema).optional(),
      // Mono + stereo recording URLs | Vapi sends whichever is enabled on the assistant.
      recordingUrl: z.string().optional(),
      stereoRecordingUrl: z.string().optional(),
    }).passthrough().optional(),
    analysis: z.object({
      summary: z.string().optional(),
      // Vapi sends either a string ('true'/'false'/custom rubric text) or a raw
      // boolean depending on the assistant's success-evaluation rubric config.
      // Normalized to string at persistence time (see persistCallRecord).
      successEvaluation: z.union([z.string(), z.boolean()]).optional(),
      structuredData: z.unknown().optional(),
    }).optional(),
  }),
})

export type VapiEndOfCallMessage = z.infer<typeof VapiEndOfCallMessageSchema>
