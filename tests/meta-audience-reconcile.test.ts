import { describe, expect, it, vi } from 'vitest'
import type { ProjectedAudienceMember } from '@/lib/meta/audience-members'
import type { StoredAudienceMembership } from '@/lib/meta/audience-diff'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function member(overrides: Partial<ProjectedAudienceMember> = {}): ProjectedAudienceMember {
  return {
    entityType: 'account',
    entityId: 'account-1',
    emailHash: HASH_A,
    phoneHash: null,
    eligibilityFingerprint: HASH_C,
    emailStatus: 'ok',
    ...overrides,
  }
}

function stored(overrides: Partial<StoredAudienceMembership> = {}): StoredAudienceMembership {
  return {
    entityType: 'account',
    entityId: 'account-1',
    submittedEmailHash: HASH_A,
    submittedPhoneHash: null,
    eligibilityFingerprint: HASH_C,
    ...overrides,
  }
}

function harness(overrides: {
  claimed?: boolean
  current?: ProjectedAudienceMember[]
  previous?: StoredAudienceMembership[]
  audienceId?: string | null
  sendFailure?: Error
} = {}) {
  const order: string[] = []
  const config = {
    id: 'config-1',
    orgId: 'org-skale',
    adsConnectionId: 'connection-1',
    metaAdAccountId: 'act_123',
    customAudienceId: overrides.audienceId === undefined ? 'audience-1' : overrides.audienceId,
    audienceName: 'Skale Club — Xcraper Prospects',
    consentBasis: 'USER_PROVIDED_ONLY' as const,
    termsAcceptedAt: '2026-08-10T00:00:00Z',
    termsAcceptedBy: 'user-1',
  }
  const store = {
    claim: vi.fn(async () => overrides.claimed === false
      ? { claimed: false as const }
      : { claimed: true as const, runId: 'run-1', claimId: 'claim-1' }),
    loadConfig: vi.fn(async () => config),
    loadProjectedMembers: vi.fn(async () => ({
      members: overrides.current ?? [member()],
      suppressedCount: 0,
    })),
    loadMemberships: vi.fn(async () => overrides.previous ?? []),
    setRemoteAudienceId: vi.fn(async () => undefined),
    commitSuccess: vi.fn(async () => { order.push('commit') }),
    completeDryRun: vi.fn(async () => { order.push('dry-run') }),
    fail: vi.fn(async () => { order.push('fail') }),
  }
  const provider = {
    getConnection: vi.fn(async () => ({ token: 'secret-token', adAccountId: 'act_123', connectionId: 'connection-1' })),
  }
  const transport = {
    createAudience: vi.fn(async () => ({ id: 'audience-created' })),
    syncHashes: vi.fn(async (_audienceId: string, _token: string, _entries: unknown[], operation: string) => {
      order.push(operation)
      if (overrides.sendFailure) throw overrides.sendFailure
      return { sent: 1, invalid: 0 }
    }),
  }
  return { store, provider, transport, order, config }
}

describe('reconcileMetaAudience', () => {
  it('creates a missing audience, submits projected hashes, and commits only afterward', async () => {
    const h = harness({ audienceId: null })
    const { reconcileMetaAudience } = await import('@/lib/meta/audience-reconcile')

    const result = await reconcileMetaAudience({
      store: h.store, provider: h.provider, transport: h.transport,
      orgId: 'org-skale', audienceConfigId: 'config-1', trigger: 'manual', dryRun: false,
    })

    expect(result).toMatchObject({ status: 'succeeded', addCount: 1, removeCount: 0 })
    expect(h.transport.createAudience).toHaveBeenCalledWith(
      'act_123', 'secret-token', expect.objectContaining({ name: h.config.audienceName }),
    )
    expect(h.store.setRemoteAudienceId).toHaveBeenCalledWith(expect.objectContaining({
      audienceId: 'audience-created', claimId: 'claim-1', orgId: 'org-skale',
    }))
    expect(h.order).toEqual(['ADD', 'commit'])
    expect(h.store.commitSuccess).toHaveBeenCalledWith(expect.objectContaining({
      members: [expect.objectContaining({ emailHash: HASH_A })],
      runId: 'run-1', claimId: 'claim-1',
    }))
  })

  it('submits the old identifier as REMOVE before the replacement ADD', async () => {
    const h = harness({
      previous: [stored({ submittedEmailHash: HASH_A })],
      current: [member({ emailHash: HASH_B, eligibilityFingerprint: HASH_B })],
    })
    const { reconcileMetaAudience } = await import('@/lib/meta/audience-reconcile')
    const result = await reconcileMetaAudience({
      store: h.store, provider: h.provider, transport: h.transport,
      orgId: 'org-skale', audienceConfigId: 'config-1', trigger: 'ingestion', dryRun: false,
    })

    expect(result).toMatchObject({ status: 'succeeded', addCount: 1, removeCount: 1 })
    expect(h.order).toEqual(['REMOVE', 'ADD', 'commit'])
    expect(h.transport.syncHashes).toHaveBeenNthCalledWith(
      1, 'audience-1', 'secret-token', [expect.objectContaining({ emailHash: HASH_A })], 'REMOVE',
    )
  })

  it('preserves the previous ledger when any remote batch fails', async () => {
    const h = harness({ sendFailure: new Error(`request failed ${HASH_A} secret-token`) })
    const { reconcileMetaAudience } = await import('@/lib/meta/audience-reconcile')
    const result = await reconcileMetaAudience({
      store: h.store, provider: h.provider, transport: h.transport,
      orgId: 'org-skale', audienceConfigId: 'config-1', trigger: 'retry', dryRun: false,
    })

    expect(result).toMatchObject({ status: 'failed', errorCode: 'META_SYNC_FAILED' })
    expect(h.store.commitSuccess).not.toHaveBeenCalled()
    expect(h.store.fail).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'META_SYNC_FAILED',
      errorMessage: expect.not.stringContaining(HASH_A),
    }))
    expect(JSON.stringify(h.store.fail.mock.calls)).not.toContain('secret-token')
  })

  it('lets only the claim owner proceed', async () => {
    const h = harness({ claimed: false })
    const { reconcileMetaAudience } = await import('@/lib/meta/audience-reconcile')
    const result = await reconcileMetaAudience({
      store: h.store, provider: h.provider, transport: h.transport,
      orgId: 'org-skale', audienceConfigId: 'config-1', trigger: 'scheduled', dryRun: false,
    })

    expect(result).toEqual({ status: 'skipped', reason: 'already_claimed' })
    expect(h.store.loadConfig).not.toHaveBeenCalled()
    expect(h.provider.getConnection).not.toHaveBeenCalled()
  })

  it('sends nothing for an unchanged rerun and still records a zero-diff success', async () => {
    const h = harness({ previous: [stored()], current: [member()] })
    const { reconcileMetaAudience } = await import('@/lib/meta/audience-reconcile')
    const result = await reconcileMetaAudience({
      store: h.store, provider: h.provider, transport: h.transport,
      orgId: 'org-skale', audienceConfigId: 'config-1', trigger: 'scheduled', dryRun: false,
    })

    expect(result).toMatchObject({ status: 'succeeded', addCount: 0, removeCount: 0, unchangedCount: 1 })
    expect(h.transport.syncHashes).not.toHaveBeenCalled()
    expect(h.store.commitSuccess).toHaveBeenCalledOnce()
  })

  it('dry-runs without Graph mutations or a successful-ledger commit', async () => {
    const h = harness({ audienceId: null })
    const { reconcileMetaAudience } = await import('@/lib/meta/audience-reconcile')
    const result = await reconcileMetaAudience({
      store: h.store, provider: h.provider, transport: h.transport,
      orgId: 'org-skale', audienceConfigId: 'config-1', trigger: 'manual', dryRun: true,
    })

    expect(result).toMatchObject({ status: 'succeeded', dryRun: true, addCount: 1 })
    expect(h.transport.createAudience).not.toHaveBeenCalled()
    expect(h.transport.syncHashes).not.toHaveBeenCalled()
    expect(h.store.commitSuccess).not.toHaveBeenCalled()
    expect(h.store.completeDryRun).toHaveBeenCalledOnce()
  })
})
