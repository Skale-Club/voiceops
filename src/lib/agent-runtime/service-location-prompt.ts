// src/lib/agent-runtime/service-location-prompt.ts
//
// Phase 138 Plan 01 (MODAL-01/MODAL-02): the single place this wording is
// authored. 138-CONTEXT.md "Where the decision lives" — no prompt file may
// hardcode "ask" or "never ask" for an address again; the engine renders
// this block into whatever prompt the channel uses, from the organization's
// service_location_mode.

import { isServiceLocationMode, type ServiceLocationMode } from './service-location-schema'

const ON_PREMISES_TEXT =
  'Service location: this business does not travel to the customer. Every appointment ' +
  'happens on site, at the business. Never ask for, collect, or record a customer address ' +
  'for any appointment.'

const AT_CUSTOMER_TEXT =
  'Service location: this business travels to the customer for every appointment. After ' +
  'the service and price are accepted, and before checking availability, collect the ' +
  "customer's full service address, read it back to them, and confirm it before proceeding. " +
  'book_appointment requires this address — do not attempt to book without it.'

const EITHER_TEXT =
  'Service location: this business can serve a customer either at the shop or at the ' +
  "customer's location, depending on the service. After the service and price are accepted, " +
  'and before checking availability, ask exactly one narrowing question: "Is this at the shop, ' +
  'or are we coming to you?" If the customer is coming to you, collect their full address, read ' +
  'it back, and confirm it before proceeding. If they are coming to the shop, do not ask for an ' +
  'address at all.'

/**
 * Renders the modality instruction block for one ServiceLocationMode. Fails
 * closed: an unrecognised mode renders the same text as 'on_premises'.
 */
export function renderServiceLocationBlock(mode: unknown): string {
  const safeMode: ServiceLocationMode = isServiceLocationMode(mode) ? mode : 'on_premises'
  switch (safeMode) {
    case 'at_customer':
      return AT_CUSTOMER_TEXT
    case 'either':
      return EITHER_TEXT
    case 'on_premises':
    default:
      return ON_PREMISES_TEXT
  }
}
