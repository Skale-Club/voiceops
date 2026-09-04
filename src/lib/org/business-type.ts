// src/lib/org/business-type.ts
//
// Phase 138 Plan 00 (MODAL-00): what kind of business an organization is,
// set by an operator in Settings -> Company Info (never by writing SQL).
//
// This module owns exactly two things: the vocabulary an operator picks
// from, and a pure mapping from that vocabulary to the DEFAULT
// service_location_mode (Phase 138 Plan 01's organizations column) a
// business of that type would want.
//
// The mapping is a default, not a law: organizations.service_location_mode
// stays the sole runtime authority (see
// src/lib/agent-runtime/resolve-service-location-mode.ts). A barbershop
// that starts doing home visits overrides its mode directly without
// changing what kind of business it says it is here. An unknown or missing
// business type always resolves to the mode that never asks for an
// address — never to one that does.

export const BUSINESS_TYPES = [
  'on_premises_shop',
  'mobile_service',
  'hybrid',
  'other',
] as const

export type BusinessType = (typeof BUSINESS_TYPES)[number]

/** Labels an operator sees in the Company Info form. */
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  on_premises_shop: 'Shop — customers come to you',
  mobile_service: 'Mobile / at-customer — you go to them',
  hybrid: 'Both — depends on the service',
  other: 'Other',
}

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value)
}

/**
 * The service_location_mode literal values this module derives defaults
 * for. Duplicated (not imported) from
 * src/lib/agent-runtime/service-location-schema.ts (Plan 138-01) so this
 * module has no dependency on that later plan — the two are kept in sync by
 * the shared vocabulary in 138-CONTEXT.md, not by a shared import.
 */
export type DerivedServiceLocationMode = 'on_premises' | 'at_customer' | 'either'

const DEFAULT_DERIVED_MODE: DerivedServiceLocationMode = 'on_premises'

const BUSINESS_TYPE_DEFAULT_MODE: Record<BusinessType, DerivedServiceLocationMode> = {
  on_premises_shop: 'on_premises',
  mobile_service: 'at_customer',
  hybrid: 'either',
  // 'other' must never be forced into asking for an address by default.
  other: 'on_premises',
}

/**
 * Maps a business type to its DEFAULT service_location_mode. Unknown,
 * missing, or unrecognised input fails closed to 'on_premises' — never to a
 * mode that asks for an address.
 */
export function deriveServiceLocationModeFromBusinessType(
  businessType: unknown,
): DerivedServiceLocationMode {
  if (!isBusinessType(businessType)) return DEFAULT_DERIVED_MODE
  return BUSINESS_TYPE_DEFAULT_MODE[businessType]
}
