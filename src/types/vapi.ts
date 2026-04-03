// src/types/vapi.ts
// Zod schemas for Vapi tool-call webhook payloads
// Validated against Vapi API reference 2024 — assistantId is camelCase, lives at message.call

import { z } from 'zod'

// Individual tool call within a toolCallList
export const VapiToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Vapi docs show both 'arguments' (newer) and 'parameters' (older). Accept both defensively.
  arguments: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
})

export type VapiToolCall = z.infer<typeof VapiToolCallSchema>

// Full tool-call message envelope
export const VapiToolCallMessageSchema = z.object({
  message: z.object({
    type: z.literal('tool-calls'),
    call: z.object({
      id: z.string(),
      assistantId: z.string(),   // camelCase — confirmed from Vapi API reference
      orgId: z.string().optional(),
    }).passthrough(),            // allow additional Vapi fields without validation failure
    toolCallList: z.array(VapiToolCallSchema),
  }),
})

export type VapiToolCallMessage = z.infer<typeof VapiToolCallMessageSchema>

// Helper: coalesce arguments/parameters field (Vapi sends either depending on version)
export function getToolArguments(toolCall: VapiToolCall): Record<string, unknown> {
  return toolCall.arguments ?? toolCall.parameters ?? {}
}
