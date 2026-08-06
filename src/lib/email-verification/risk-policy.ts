// Risk + sendability policy for verified email statuses. Kept in one small,
// dependency-free module so both providers.ts (which stamps a risk onto every
// verify result) and verify.ts (which re-exports these for callers, and gates
// sends on isSendable) can import it without a circular dependency between
// the two.
//
// verify.ts is the documented home of this policy — import from there unless
// you specifically need to avoid pulling in the full orchestrator.

import type { EmailRisk, EmailStatus } from './types'

/** Single source of truth for status -> risk. Change the mapping here only. */
export function riskForStatus(status: EmailStatus): EmailRisk {
  switch (status) {
    case 'ok':
      return 'low'
    case 'catch_all':
    case 'unknown':
      return 'medium'
    case 'disposable':
    case 'invalid':
    case 'bounced':
      return 'high'
  }
}

/**
 * Single source of truth for whether it's safe to send to an address with
 * this status. catch_all and unknown are deliberately sendable — the user is
 * testing catch-all deliverability and an unresolved verification shouldn't
 * silently block outreach.
 */
export function isSendable(status: EmailStatus): boolean {
  switch (status) {
    case 'ok':
    case 'catch_all':
    case 'unknown':
      return true
    case 'disposable':
    case 'invalid':
    case 'bounced':
      return false
  }
}
