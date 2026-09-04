// src/lib/agent-runtime/resolve-service-location-mode.ts
//
// Phase 138 Plan 01 (MODAL-01/MODAL-02): resolves one organization's
// service_location_mode. Modeled on
// src/lib/agent-runtime/routing-mode.ts's resolveChannelRoutingMode() —
// same fail-closed contract, same "creates its own service-role client"
// shape.
//
// Fails closed to 'on_premises' on every axis of uncertainty: a missing
// organizationId, a Supabase read error, no row, a null value, or any
// string outside the three recognised modes. Never throws, and never reads
// an uncertain value as "ask for an address".

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { isServiceLocationMode, type ServiceLocationMode } from './service-location-schema'

export const DEFAULT_SERVICE_LOCATION_MODE: ServiceLocationMode = 'on_premises'

/**
 * Resolves the service_location_mode for exactly one organization.
 *
 * Cheap by design: a single scoped read against `organizations`, no join,
 * no model call. Fails closed to DEFAULT_SERVICE_LOCATION_MODE on a missing
 * organizationId, a read error, a missing row, or a value other than the
 * three recognised modes.
 */
export async function resolveServiceLocationMode(organizationId: string): Promise<ServiceLocationMode> {
  if (!organizationId) return DEFAULT_SERVICE_LOCATION_MODE

  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await supabase
      .from('organizations')
      .select('service_location_mode')
      .eq('id', organizationId)
      .maybeSingle()

    if (error || !data) return DEFAULT_SERVICE_LOCATION_MODE

    const mode = (data as { service_location_mode?: unknown }).service_location_mode
    if (!isServiceLocationMode(mode)) return DEFAULT_SERVICE_LOCATION_MODE

    return mode
  } catch {
    return DEFAULT_SERVICE_LOCATION_MODE
  }
}
