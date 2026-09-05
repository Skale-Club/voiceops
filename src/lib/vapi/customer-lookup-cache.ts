// Warm customer lookup for the voice path.
//
// The opening line of a call is a fixed string spoken instantly, so the first
// thing the model does after the caller's first sentence is look them up -
// `lookup_customer`, two sequential provider calls, 3-4.5s measured through
// production. That is the pause before the robot's first reply.
//
// Vapi tells us the caller's number the moment the call is answered
// (`status-update` at `in-progress`, several seconds before anyone speaks),
// so the lookup can already be running. Both the warm-up and the real tool
// call go through one memo key, so whichever arrives second gets the other's
// result: the tool call finds the answer waiting, or joins the in-flight
// request instead of starting a second one.
//
// A read only; nothing here is ever cached for a write. TTL covers the gap
// between pickup and the first reply with room to spare, and a customer's
// record does not change inside one call. The key carries the organization so
// two tenants sharing a caller can never see each other's customer.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { memoTtl } from '@/lib/cache/ttl-memo'
import { decrypt } from '@/lib/crypto'
import { executeAction } from '@/lib/action-engine/execute-action'
import { resolveTool } from '@/lib/action-engine/resolve-tool'

export const CUSTOMER_LOOKUP_TTL_MS = 90_000
export const CUSTOMER_LOOKUP_ACTION = 'xkedule_lookup_customer'
export const CUSTOMER_LOOKUP_TOOL = 'lookup_customer'

export function customerLookupKey(organizationId: string, phone: string): string {
  return `vapi:lookup:${organizationId}:${normalisePhone(phone)}`
}

/** Digits and a leading plus only, so "+1 (224) 551-6131" and "+12245516131" share a key. */
export function normalisePhone(phone: string): string {
  const trimmed = phone.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/**
 * Starts the lookup for `phone` in this organization's provider and caches
 * the result under the same key the tool route reads. Safe to call without
 * awaiting: every failure is swallowed here and nothing is cached for it.
 */
export async function warmCustomerLookup(
  organizationId: string,
  phone: string,
  supabase: SupabaseClient<Database>
): Promise<void> {
  try {
    await memoTtl(customerLookupKey(organizationId, phone), CUSTOMER_LOOKUP_TTL_MS, async () => {
      const toolConfig = await resolveTool(organizationId, CUSTOMER_LOOKUP_TOOL, supabase)
      if (!toolConfig || toolConfig.action_type !== CUSTOMER_LOOKUP_ACTION) {
        throw new Error('lookup_customer is not configured for this organization')
      }
      const integration = toolConfig.integrations
      const credentials = integration
        ? { apiKey: await decrypt(integration.encrypted_api_key), locationId: integration.location_id ?? '' }
        : { apiKey: '', locationId: '' }
      return executeAction(CUSTOMER_LOOKUP_ACTION, { phone }, credentials, {
        organizationId,
        supabase,
        toolConfig: toolConfig.config,
        integrationProvider: integration?.provider,
        callerNumber: phone,
      })
    })
  } catch {
    // A warm-up that fails is a warm-up that did nothing; the tool call will
    // do the real work and report its own error.
  }
}
