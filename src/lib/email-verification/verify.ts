// Email-verification orchestrator: provider failover, the on-row cache
// (contacts/accounts.email_status etc. — migration 1264), and the batch
// helper used by the outreach MCP tools. This is the module other code
// should import from — providers.ts and credits.ts are internals.
//
// Cache-first is mandatory: verification costs real money per call.
// Never throws into a send path: every function here degrades to a typed
// `{ blocked: true, ... }` result instead of throwing.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyWithMillionVerifier, verifyWithNeverBounce } from './providers'
import { riskForStatus, isSendable } from './risk-policy'
import { isVerifyFailure } from './types'
import type { EmailRisk, EmailStatus, VerificationProvider, VerifySuccess } from './types'

export { riskForStatus, isSendable }
export type { EmailStatus, EmailRisk, VerificationProvider, VerifySuccess }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
const BATCH_CONCURRENCY = 5

export type ProspectKind = 'contact' | 'account'

export interface EmailBlocked {
  blocked: true
  reason: 'no_verification_credits'
  detail?: string
}

export interface EmailVerified {
  status: EmailStatus
  risk: EmailRisk
  provider: VerificationProvider
  verifiedAt: string
  cached: boolean
}

export type VerifyEmailResult = EmailVerified | EmailBlocked

function isBlocked(result: VerifyEmailResult): result is EmailBlocked {
  return 'blocked' in result && result.blocked === true
}

/**
 * Verify a single email address against the provider chain: MillionVerifier
 * first, falling back to NeverBounce when MillionVerifier is out of credits,
 * unreachable, or unauthorized. If BOTH providers are unavailable this
 * returns `{ blocked: true }` — it never guesses a status.
 */
export async function verifyEmail(email: string): Promise<VerifyEmailResult> {
  const primary = await verifyWithMillionVerifier(email)
  if (!isVerifyFailure(primary)) {
    return { status: primary.status, risk: primary.risk, provider: primary.provider, verifiedAt: new Date().toISOString(), cached: false }
  }

  const fallback = await verifyWithNeverBounce(email)
  if (!isVerifyFailure(fallback)) {
    return { status: fallback.status, risk: fallback.risk, provider: fallback.provider, verifiedAt: new Date().toISOString(), cached: false }
  }

  return {
    blocked: true,
    reason: 'no_verification_credits',
    detail: `MillionVerifier: ${primary.error}${primary.detail ? ` (${primary.detail})` : ''}; NeverBounce: ${fallback.error}${fallback.detail ? ` (${fallback.detail})` : ''}`,
  }
}

function tableFor(kind: ProspectKind): 'contacts' | 'accounts' {
  return kind === 'account' ? 'accounts' : 'contacts'
}

function isFresh(verifiedAt: string | null, status: string | null): boolean {
  if (!verifiedAt || !status || status === 'unknown') return false
  const age = Date.now() - new Date(verifiedAt).getTime()
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS
}

/**
 * Verify (or re-use the cached verification of) ONE prospect's email and
 * persist the result onto its row. CACHE FIRST: if the row already carries a
 * non-'unknown' email_status verified within the last 90 days, this returns
 * it without calling any provider — unless `force` is set.
 */
export async function verifyProspectEmail(
  orgId: string,
  kind: ProspectKind,
  id: string,
  email: string,
  opts: { force?: boolean } = {},
): Promise<VerifyEmailResult> {
  const table = tableFor(kind)

  if (!opts.force) {
    const { data: existing } = await db()
      .from(table)
      .select('email_status, email_verified_at, email_verification_provider')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle()
    if (existing && isFresh(existing.email_verified_at, existing.email_status)) {
      return {
        status: existing.email_status as EmailStatus,
        risk: riskForStatus(existing.email_status as EmailStatus),
        provider: (existing.email_verification_provider as VerificationProvider) ?? 'millionverifier',
        verifiedAt: existing.email_verified_at as string,
        cached: true,
      }
    }
  }

  const result = await verifyEmail(email)
  if (isBlocked(result)) return result

  await db()
    .from(table)
    .update({
      email_status: result.status,
      email_verified_at: result.verifiedAt,
      email_verification_provider: result.provider,
      email_risk: result.risk,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('id', id)

  return result
}

export interface BatchProspectInput {
  kind: ProspectKind
  id: string
  email: string
}

export interface BatchProspectResult extends BatchProspectInput {
  result: VerifyEmailResult
  sendable: boolean
}

export interface BatchAggregate {
  ok: number
  catch_all: number
  unknown: number
  invalid: number
  disposable: number
  bounced: number
  blocked: number
}

export interface VerifyBatchResult {
  results: BatchProspectResult[]
  aggregate: BatchAggregate
}

/**
 * Verify a batch of prospects with a small concurrency cap (each entry is
 * cache-first, so an already-verified batch costs zero provider calls).
 * `force` (default false) bypasses the 90-day cache and re-verifies every
 * email against the provider chain — see `verifyProspectEmail`'s `force`.
 */
export async function verifyProspectsBatch(
  orgId: string,
  prospects: BatchProspectInput[],
  opts: { force?: boolean } = {},
): Promise<VerifyBatchResult> {
  const results: BatchProspectResult[] = new Array(prospects.length)
  let cursor = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++
      if (i >= prospects.length) return
      const p = prospects[i]
      const result = await verifyProspectEmail(orgId, p.kind, p.id, p.email, { force: opts.force })
      const sendable = !isBlocked(result) && isSendable(result.status)
      results[i] = { ...p, result, sendable }
    }
  }

  const workerCount = Math.min(BATCH_CONCURRENCY, prospects.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const aggregate: BatchAggregate = { ok: 0, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 }
  for (const r of results) {
    if (isBlocked(r.result)) {
      aggregate.blocked++
    } else {
      aggregate[r.result.status]++
    }
  }

  return { results, aggregate }
}
