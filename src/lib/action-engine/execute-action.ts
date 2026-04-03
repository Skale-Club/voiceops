// src/lib/action-engine/execute-action.ts
// Dispatcher: routes action_type to the correct GHL executor
// Phase 4 will add 'knowledge_base' here. Phase 2 implements the 3 GHL actions.

import { createContact } from '@/lib/ghl/create-contact'
import { getAvailability } from '@/lib/ghl/get-availability'
import { createAppointment } from '@/lib/ghl/create-appointment'
import type { GhlCredentials } from '@/lib/ghl/client'
import type { Database } from '@/types/database'

type ActionType = Database['public']['Enums']['action_type']

export async function executeAction(
  actionType: ActionType,
  params: Record<string, unknown>,
  credentials: GhlCredentials
): Promise<string> {
  switch (actionType) {
    case 'create_contact':
      return createContact(params, credentials)
    case 'get_availability':
      return getAvailability(params, credentials)
    case 'create_appointment':
      return createAppointment(params, credentials)
    case 'send_sms':
    case 'knowledge_base':
    case 'custom_webhook':
      // Stubs for v2 requirements — will be implemented in Phase 4 / v2
      throw new Error(`Unsupported action type: ${actionType}`)
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = actionType
      throw new Error(`Unknown action type: ${String(_exhaustive)}`)
    }
  }
}
