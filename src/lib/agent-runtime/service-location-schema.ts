// src/lib/agent-runtime/service-location-schema.ts
//
// Phase 138 Plan 01 (MODAL-01/MODAL-02): the one module that owns the
// ServiceLocationMode vocabulary end to end. Other modules in this phase
// (service-location-prompt.ts, resolve-service-location-mode.ts) and Plan
// 138-02 (build-workflow-tools.ts) import the type and helpers from here
// rather than redeclaring them.
//
// applyServiceLocationMode() is the schema-boundary enforcement described in
// 138-CONTEXT.md: for an 'on_premises' organization the model must not even
// SEE that a customerAddress field can exist on book_appointment — deleting
// the key from the input schema, not merely marking it optional, is what
// makes the voice/text model structurally unable to pass one. For
// 'at_customer' the field is kept and marked required, so the ai-sdk itself
// rejects a book_appointment call that omits it before create-booking.ts is
// ever reached. 'either' keeps it optional — the one narrowing question
// decides whether the model ends up supplying it.

import type { InputSchemaMap, InputSchemaField } from '@/lib/workflows/derive-input-schema'

export type ServiceLocationMode = 'on_premises' | 'at_customer' | 'either'

const RECOGNISED_MODES: readonly ServiceLocationMode[] = ['on_premises', 'at_customer', 'either']

export function isServiceLocationMode(value: unknown): value is ServiceLocationMode {
  return typeof value === 'string' && (RECOGNISED_MODES as readonly string[]).includes(value)
}

/**
 * Transforms an input-schema map's address field according to the
 * organization's service location mode. Fails closed: any value other than
 * the three recognised modes (including undefined, null, empty string, or a
 * typo) is treated exactly like 'on_premises' — never fail open into asking
 * for an address on uncertain data.
 *
 * A map with no `fieldKey` entry is returned unchanged for every mode — a
 * workflow that isn't book_appointment is never touched by this function.
 */
export function applyServiceLocationMode(
  inputSchema: InputSchemaMap,
  mode: unknown,
  fieldKey: string = 'customerAddress',
): InputSchemaMap {
  if (!(fieldKey in inputSchema)) return inputSchema

  const safeMode: ServiceLocationMode = isServiceLocationMode(mode) ? mode : 'on_premises'

  if (safeMode === 'on_premises') {
    // The model must not even see the field can exist.
    const rest: InputSchemaMap = {}
    for (const [key, value] of Object.entries(inputSchema)) {
      if (key !== fieldKey) rest[key] = value
    }
    return rest
  }

  const existing = inputSchema[fieldKey]
  const updatedField: InputSchemaField = {
    ...existing,
    required: safeMode === 'at_customer',
  }
  return { ...inputSchema, [fieldKey]: updatedField }
}
