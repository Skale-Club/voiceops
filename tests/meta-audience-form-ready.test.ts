// tests/meta-audience-form-ready.test.ts
//
// Phase 5 of docs/integrations/ads-connection-health-plan.md: the Meta
// Audience form's readiness gate (`configReady`, and the "Reconnect
// required" message) must key off `usable`, not `status` — a hidden-but-
// healthy connection is a selection problem, not a health problem, and a
// selected-but-broken connection must still block sync even though
// status='active'. isConnectionReady is the pure predicate both derive from
// (see src/app/(dashboard)/settings/integrations/meta-audience/meta-audience-form.tsx).

import { describe, expect, it } from 'vitest'
import { isConnectionReady } from '@/app/(dashboard)/settings/integrations/meta-audience/meta-audience-form'
import type { MetaAudienceConnectionOption } from '@/app/(dashboard)/settings/integrations/meta-audience/actions'

function connection(overrides: Partial<MetaAudienceConnectionOption> = {}): MetaAudienceConnectionOption {
  return {
    id: 'conn-1',
    adAccountId: 'act_1',
    adAccountName: 'Acme',
    status: 'active',
    usable: true,
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('isConnectionReady — Meta Audience configReady keys on usable', () => {
  it('ready when usable and not expired', () => {
    expect(isConnectionReady(connection(), false)).toBe(true)
  })

  it('NOT ready when status is active but health is broken (usable=false) — this is the exact case status alone used to miss', () => {
    expect(isConnectionReady(connection({ status: 'active', usable: false }), false)).toBe(false)
  })

  it('NOT ready when hidden from the workspace (status=available) even if healthy', () => {
    expect(isConnectionReady(connection({ status: 'available', usable: false }), false)).toBe(false)
  })

  it('NOT ready when the token has expired locally, even if usable', () => {
    expect(isConnectionReady(connection({ usable: true }), true)).toBe(false)
  })

  it('NOT ready when there is no connection selected at all', () => {
    expect(isConnectionReady(undefined, false)).toBe(false)
  })
})
