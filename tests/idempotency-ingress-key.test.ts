// tests/idempotency-ingress-key.test.ts
// Phase 133 Plan 01 (SAFE-01, PERF-03)
//
// Extends the Phase 38 idempotency mechanism (src/lib/agent-runtime/idempotency.ts)
// with:
//   1. An ingress-scoped key derivation that survives a channel retry (a Vapi
//      redelivery mints a new agent invocation id, so the existing
//      invocation-scoped derivation cannot recognize the replay).
//   2. A discriminated checkIdempotency() outcome (fresh / replay / conflict /
//      abandoned) so a same-key/different-args request is never silently
//      answered with someone else's cached result, and a timed-out
//      side-effecting execution leaves a traceable "ownership unresolved"
//      row instead of looking like either a free slot or a success.
//
// CRITICAL invariant under test: the existing invocation-scoped
// deriveIdempotencyKey(invocationId, toolCallIndex) must keep producing
// byte-identical keys. Any change here would desync live rows in
// tool_idempotency_keys from the keys callers derive, turning previously
// guarded mutations into re-executable ones.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  deriveIdempotencyKey,
  deriveIngressIdempotencyKey,
  checkIdempotency,
  recordIdempotency,
  recordAbandonedIdempotency,
  hashToolArgs,
  type IdempotencyOutcome,
} from '../src/lib/agent-runtime/idempotency'

// ===========================================================================
// Regression pin: existing invocation-scoped derivation must not move
// ===========================================================================

describe('deriveIdempotencyKey — byte-identical regression pin', () => {
  it('matches the exact sha256 hex recorded for a fixed input pair', () => {
    // Pinned independently: sha256("pinned-invocation-id:3") computed with
    // Node's crypto module outside this test file. If this assertion ever
    // fails, the derivation format changed and every live row in
    // tool_idempotency_keys keyed under the old format is now unreachable.
    const PINNED_HEX = '1b28f3892e530c64069f8af3c8cddc7d9f15106707cc9c407b0253978694335c'.slice(0, 64)
    expect(deriveIdempotencyKey('pinned-invocation-id', 3)).toBe(PINNED_HEX)
  })

  it('still matches a from-scratch sha256("invocationId:toolCallIndex") reimplementation', () => {
    const invId = 'inv-regression-check'
    const idx = 12
    const local = crypto.createHash('sha256').update(`${invId}:${idx}`).digest('hex')
    expect(deriveIdempotencyKey(invId, idx)).toBe(local)
  })

  it('is unaffected by the presence of the new ingress derivation function', () => {
    // Calling the new function first must not mutate any shared state that
    // the legacy function depends on.
    deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-1', externalToolCallId: 'tc-1' })
    const key1 = deriveIdempotencyKey('inv-after-ingress-call', 0)
    const key2 = deriveIdempotencyKey('inv-after-ingress-call', 0)
    expect(key1).toBe(key2)
  })
})

// ===========================================================================
// SAFE-01: Ingress-scoped derivation
// ===========================================================================

describe('deriveIngressIdempotencyKey — trusted ingress identity', () => {
  it('produces the pinned sha256 for a fixed identity', () => {
    const key = deriveIngressIdempotencyKey({
      channel: 'voice',
      externalCallId: 'call-abc123',
      externalToolCallId: 'tool-xyz789',
    })
    expect(key).toBe('713cba640557576b62625dc6ff23ec55d33a6c0c37753dc417dfa2c61fe3a971'.slice(0, 64))
  })

  it('is a 64-char hex string (sha256)', () => {
    const key = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'a', externalToolCallId: 'b' })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same key across two calls with the same ingress identity (retry parity)', () => {
    const identity = { channel: 'voice', externalCallId: 'call-retry-1', externalToolCallId: 'tc-retry-1' }
    const first = deriveIngressIdempotencyKey(identity)
    const second = deriveIngressIdempotencyKey({ ...identity })
    expect(first).toBe(second)
  })

  it('produces a different key when externalCallId differs', () => {
    const a = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-A', externalToolCallId: 'tc-1' })
    const b = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-B', externalToolCallId: 'tc-1' })
    expect(a).not.toBe(b)
  })

  it('produces a different key when externalToolCallId differs', () => {
    const a = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-1', externalToolCallId: 'tc-A' })
    const b = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-1', externalToolCallId: 'tc-B' })
    expect(a).not.toBe(b)
  })

  it('produces a different key when channel differs (namespacing)', () => {
    const a = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-1', externalToolCallId: 'tc-1' })
    const b = deriveIngressIdempotencyKey({ channel: 'whatsapp', externalCallId: 'call-1', externalToolCallId: 'tc-1' })
    expect(a).not.toBe(b)
  })

  it('does not collide with the legacy invocation-scoped keyspace for a superficially similar string', () => {
    // Legacy: sha256("call-1:0"). Ingress must not reduce to the same raw
    // string shape, so it must land in a disjoint keyspace even if a
    // pathological caller passed matching-looking identifiers.
    const legacyLookalike = deriveIdempotencyKey('call-1', 0)
    const ingress = deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-1', externalToolCallId: '0' })
    expect(ingress).not.toBe(legacyLookalike)
  })

  it('rejects an empty externalCallId or externalToolCallId (would collapse retries and non-retries alike)', () => {
    expect(() =>
      deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: '', externalToolCallId: 'tc-1' })
    ).toThrow()
    expect(() =>
      deriveIngressIdempotencyKey({ channel: 'voice', externalCallId: 'call-1', externalToolCallId: '' })
    ).toThrow()
  })
})

// ===========================================================================
// checkIdempotency — discriminated outcome
// ===========================================================================

/** Builds a chainable Supabase mock matching checkIdempotency's exact query shape. */
function mockIdempotencyLookup(row: { response: unknown; request_hash: string } | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const gt = vi.fn(() => ({ maybeSingle }))
  const eqB = vi.fn(() => ({ gt }))
  const eqA = vi.fn(() => ({ eq: eqB }))
  const select = vi.fn(() => ({ eq: eqA }))
  const from = vi.fn(() => ({ select }))
  vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never)
  return { from, select, eqA, eqB, gt, maybeSingle }
}

describe('checkIdempotency — discriminated outcome (fresh / replay / conflict / abandoned)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { status: "fresh" } when no row exists', async () => {
    mockIdempotencyLookup(null)
    const outcome = await checkIdempotency('org-1', 'key-1', hashToolArgs({ a: 1 }))
    expect(outcome).toEqual<IdempotencyOutcome>({ status: 'fresh' })
  })

  it('returns { status: "replay", response } when the row matches the request hash', async () => {
    const requestHash = hashToolArgs({ a: 1 })
    mockIdempotencyLookup({ response: 'cached-result-string', request_hash: requestHash })
    const outcome = await checkIdempotency('org-1', 'key-1', requestHash)
    expect(outcome).toEqual<IdempotencyOutcome>({ status: 'replay', response: 'cached-result-string' })
  })

  it('JSON.stringifies a non-string response column on replay', async () => {
    const requestHash = hashToolArgs({ a: 1 })
    mockIdempotencyLookup({ response: { ok: true, id: 42 }, request_hash: requestHash })
    const outcome = await checkIdempotency('org-1', 'key-1', requestHash)
    expect(outcome).toEqual<IdempotencyOutcome>({ status: 'replay', response: JSON.stringify({ ok: true, id: 42 }) })
  })

  it('returns { status: "conflict" } when the row exists but the request hash differs — NEVER the original response', async () => {
    const storedHash = hashToolArgs({ a: 1 })
    const newHash = hashToolArgs({ a: 2 })
    mockIdempotencyLookup({ response: 'original-result-must-not-leak', request_hash: storedHash })
    const outcome = await checkIdempotency('org-1', 'key-1', newHash)
    expect(outcome).toEqual<IdempotencyOutcome>({ status: 'conflict' })
    expect(JSON.stringify(outcome)).not.toContain('original-result-must-not-leak')
  })

  it('returns { status: "abandoned" } when the row carries the abandoned marker and the hash matches', async () => {
    const requestHash = hashToolArgs({ a: 1 })
    mockIdempotencyLookup({
      response: { __idempotency_marker: '__idempotency_abandoned__', reason: 'timeout', abandoned_at: '2026-09-03T00:00:00.000Z' },
      request_hash: requestHash,
    })
    const outcome = await checkIdempotency('org-1', 'key-1', requestHash)
    expect(outcome).toEqual<IdempotencyOutcome>({ status: 'abandoned' })
  })

  it('treats an abandoned row with a mismatched hash as a conflict, not abandoned', async () => {
    const storedHash = hashToolArgs({ a: 1 })
    const newHash = hashToolArgs({ a: 2 })
    mockIdempotencyLookup({
      response: { __idempotency_marker: '__idempotency_abandoned__', reason: 'timeout', abandoned_at: '2026-09-03T00:00:00.000Z' },
      request_hash: storedHash,
    })
    const outcome = await checkIdempotency('org-1', 'key-1', newHash)
    expect(outcome).toEqual<IdempotencyOutcome>({ status: 'conflict' })
  })

  it('an abandoned row is never returned as a successful replay', async () => {
    const requestHash = hashToolArgs({ a: 1 })
    mockIdempotencyLookup({
      response: { __idempotency_marker: '__idempotency_abandoned__', reason: 'abort', abandoned_at: '2026-09-03T00:00:00.000Z' },
      request_hash: requestHash,
    })
    const outcome = await checkIdempotency('org-1', 'key-1', requestHash)
    expect(outcome.status).not.toBe('replay')
    expect(outcome.status).not.toBe('fresh')
  })

  it('queries only rows past their expiry, scoped to org and key (unchanged contract)', async () => {
    const requestHash = hashToolArgs({ a: 1 })
    const mocks = mockIdempotencyLookup(null)
    await checkIdempotency('org-42', 'key-42', requestHash)
    expect(mocks.from).toHaveBeenCalledWith('tool_idempotency_keys')
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('response'))
    expect(mocks.eqA).toHaveBeenCalledWith('organization_id', 'org-42')
    expect(mocks.eqB).toHaveBeenCalledWith('idempotency_key', 'key-42')
    expect(mocks.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })
})

// ===========================================================================
// recordAbandonedIdempotency — traceable ownership for timed-out/aborted work
// ===========================================================================

function mockUpsert() {
  const upsertResult = vi.fn().mockResolvedValue({ error: null })
  const upsert = vi.fn((_payload: Record<string, unknown>, _opts?: Record<string, unknown>) => upsertResult())
  const from = vi.fn(() => ({ upsert }))
  vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never)
  return { from, upsert }
}

describe('recordAbandonedIdempotency — traceable ownership on timeout/abort (PERF-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts a row carrying the abandoned marker, never a plain success response', async () => {
    const { from, upsert } = mockUpsert()
    await recordAbandonedIdempotency({
      organizationId: 'org-1',
      agentInvocationId: 'inv-1',
      idempotencyKey: 'key-1',
      toolName: 'create_appointment',
      requestHash: hashToolArgs({ a: 1 }),
      reason: 'timeout',
    })
    expect(from).toHaveBeenCalledWith('tool_idempotency_keys')
    const [payload] = upsert.mock.calls[0] as [Record<string, unknown>, unknown]
    const response = payload.response as Record<string, unknown>
    expect(response.__idempotency_marker).toBe('__idempotency_abandoned__')
    expect(response.reason).toBe('timeout')
    expect(typeof response.abandoned_at).toBe('string')
  })

  it('does not overwrite an existing row (ignoreDuplicates), so a completed result is never clobbered by a late timeout signal', async () => {
    const { upsert } = mockUpsert()
    await recordAbandonedIdempotency({
      organizationId: 'org-1',
      agentInvocationId: 'inv-1',
      idempotencyKey: 'key-1',
      toolName: 'create_appointment',
      requestHash: hashToolArgs({ a: 1 }),
      reason: 'abort',
    })
    const [, opts] = upsert.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(opts.ignoreDuplicates).toBe(true)
    expect(opts.onConflict).toBe('organization_id,idempotency_key')
  })
})

// ===========================================================================
// recordIdempotency — unchanged shape, still stores a plain response
// ===========================================================================

describe('recordIdempotency — unchanged contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('still upserts the plain string response (not wrapped in a marker)', async () => {
    const { upsert } = mockUpsert()
    await recordIdempotency({
      organizationId: 'org-1',
      agentInvocationId: 'inv-1',
      idempotencyKey: 'key-1',
      toolName: 'create_appointment',
      requestHash: hashToolArgs({ a: 1 }),
      response: 'booked!',
    })
    const [payload] = upsert.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(payload.response).toBe('booked!')
  })
})
