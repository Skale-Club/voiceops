// src/lib/email/webhook-secrets.ts
//
// Resolves every configured Resend webhook signing secret — the platform
// account's (platform_email_settings) plus every tenant's own Resend
// account (tenant_email_integrations) — and validates incoming Svix-signed
// webhook payloads against them. Each tenant has their own Resend account,
// so each has their own webhook signing secret configured in Settings →
// Email (see migration 1278). This replaces the single
// process.env.RESEND_WEBHOOK_SECRET env var previously shared by both routes.
//
// IMPORTANT: validation returns the signer scope, not just a boolean. A
// tenant knows its own signing secret and must never be able to forge an
// event that mutates another tenant's delivery row or inbound route.

import crypto from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

// Short in-process cache so a burst of webhook deliveries doesn't hit the DB
// per event.
const CACHE_TTL_MS = 3 * 60 * 1000

type SecretCandidate =
  | { secret: string; scope: 'platform' }
  | { secret: string; scope: 'tenant'; orgId: string }

export interface ResendWebhookSigner {
  /** Platform signer is trusted for legacy/shared platform-account routes. */
  platform: boolean
  /** Tenant organizations whose configured secret matched this signature. */
  tenantOrgIds: string[]
}

let cache: { candidates: SecretCandidate[]; fetchedAt: number } | null = null

async function loadSecretCandidates(): Promise<SecretCandidate[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.candidates
  }

  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: platformRows }, { data: tenantRows }] = await Promise.all([
    db
      .from('platform_email_settings')
      .select('webhook_secret_encrypted')
      .not('webhook_secret_encrypted', 'is', null),
    db
      .from('tenant_email_integrations')
      .select('org_id, webhook_secret_encrypted')
      .not('webhook_secret_encrypted', 'is', null),
  ])

  const encryptedRows: Array<
    | { encrypted: string; scope: 'platform' }
    | { encrypted: string; scope: 'tenant'; orgId: string }
  > = [
    ...((platformRows ?? []) as { webhook_secret_encrypted: string | null }[])
      .filter((row): row is { webhook_secret_encrypted: string } => !!row.webhook_secret_encrypted)
      .map((row) => ({ encrypted: row.webhook_secret_encrypted, scope: 'platform' as const })),
    ...((tenantRows ?? []) as { org_id: string; webhook_secret_encrypted: string | null }[])
      .filter(
        (row): row is { org_id: string; webhook_secret_encrypted: string } =>
          !!row.org_id && !!row.webhook_secret_encrypted,
      )
      .map((row) => ({
        encrypted: row.webhook_secret_encrypted,
        scope: 'tenant' as const,
        orgId: row.org_id,
      })),
  ]

  const candidates: SecretCandidate[] = []
  for (const row of encryptedRows) {
    try {
      const secret = await decrypt(row.encrypted)
      candidates.push(
        row.scope === 'platform'
          ? { secret, scope: 'platform' }
          : { secret, scope: 'tenant', orgId: row.orgId },
      )
    } catch (err) {
      // A single row failing to decrypt (corrupt row, key rotation, etc.)
      // must never prevent the other configured secrets from being tried.
      console.error('[webhook-secrets] Failed to decrypt a Resend webhook secret:', err)
    }
  }

  cache = { candidates, fetchedAt: Date.now() }
  return candidates
}

/**
 * Drop the cached secret list so the next webhook re-reads from the DB.
 * Call this from every settings action that writes a webhook secret: the
 * cache also memoizes the EMPTY list, so without this an operator who just
 * pasted their first secret would keep seeing production reject every
 * delivery for the rest of the TTL, with nothing in the UI explaining why.
 */
export function invalidateWebhookSecretsCache(): void {
  cache = null
}

/** Fast settings-form validation; actual authenticity is still HMAC-based. */
export function isValidResendWebhookSecretFormat(secret: string): boolean {
  const value = secret.trim()
  if (!/^whsec_[A-Za-z0-9+/_=-]+$/.test(value)) return false
  try {
    return Buffer.from(value.slice('whsec_'.length), 'base64').length >= 16
  } catch {
    return false
  }
}

function computeExpectedSignature(secret: string, signedContent: string): Buffer {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  if (secretBytes.length === 0) throw new Error('Invalid empty Resend webhook secret')
  return crypto.createHmac('sha256', secretBytes).update(signedContent).digest()
}

function signatureMatches(secret: string, signedContent: string, signatures: string[]): boolean {
  try {
    const expected = computeExpectedSignature(secret, signedContent)
    return signatures.some((signature) => {
      try {
        const provided = Buffer.from(signature, 'base64')
        return provided.length === expected.length && crypto.timingSafeEqual(provided, expected)
      } catch {
        return false
      }
    })
  } catch {
    // One malformed stored secret must not prevent the remaining configured
    // integrations from being checked.
    return false
  }
}

/**
 * Validates a Resend (Svix) webhook signature against every configured
 * signing secret (platform + all tenants) and returns the scope of every
 * configured secret that validates it.
 *
 * Preserves the original single-secret algorithm exactly: HMAC-SHA256 over
 * `${svixId}.${svixTimestamp}.${rawBody}`, base64 secret with the `whsec_`
 * prefix stripped, a 5-minute timestamp replay window, and the
 * multi-signature `svix-signature` header format ("v1,<sig> v1,<sig> ...").
 *
 * If no secret is configured anywhere: allow through in non-production
 * (matches prior env-var fallback behavior), reject in production.
 */
export async function validateResendWebhookSignature(
  rawBody: string,
  headers: Headers,
): Promise<ResendWebhookSigner | null> {
  const candidates = await loadSecretCandidates()

  if (candidates.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      return { platform: true, tenantOrgIds: [] }
    }
    console.warn(
      '[resend-webhooks] No Resend webhook signing secret configured. Set one in ' +
        'Settings → Email (tenant) or /admin/settings/email (platform).'
    )
    return null
  }

  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) return null

  const tsSeconds = parseInt(svixTimestamp, 10)
  if (isNaN(tsSeconds)) return null
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - tsSeconds) > 300) return null

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const providedSignatures = svixSignature
    .split(' ')
    .map((value) => value.split(','))
    .filter(([version, signature]) => version === 'v1' && !!signature)
    .map(([, signature]) => signature)

  if (providedSignatures.length === 0) return null

  const matched = candidates.filter((candidate) =>
    signatureMatches(candidate.secret, signedContent, providedSignatures),
  )
  if (matched.length === 0) return null

  return {
    platform: matched.some((candidate) => candidate.scope === 'platform'),
    tenantOrgIds: [
      ...new Set(
        matched
          .filter(
            (candidate): candidate is Extract<SecretCandidate, { scope: 'tenant' }> =>
              candidate.scope === 'tenant',
          )
          .map((candidate) => candidate.orgId),
      ),
    ],
  }
}

/** Whether this verified signer may mutate data owned by orgId. */
export function canResendWebhookSignerAccessOrg(
  signer: ResendWebhookSigner,
  orgId: string | null,
): boolean {
  return signer.platform || (orgId !== null && signer.tenantOrgIds.includes(orgId))
}
