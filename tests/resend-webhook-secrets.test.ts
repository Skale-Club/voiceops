import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const secretRows = vi.hoisted(() => ({
  platform: [] as Array<{ webhook_secret_encrypted: string }>,
  tenants: [] as Array<{ org_id: string; webhook_secret_encrypted: string }>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        not: async () => ({
          data:
            table === 'platform_email_settings'
              ? secretRows.platform
              : secretRows.tenants,
          error: null,
        }),
      }),
    }),
  })),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(async (value: string) => value),
}))

import {
  canResendWebhookSignerAccessOrg,
  invalidateWebhookSecretsCache,
  isValidResendWebhookSecretFormat,
  validateResendWebhookSignature,
} from '@/lib/email/webhook-secrets'

function makeSecret(label: string): string {
  return `whsec_${Buffer.from(`secret-${label}`).toString('base64')}`
}

function signedHeaders(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): Headers {
  const id = 'msg_test'
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signature = crypto
    .createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64')
  return new Headers({
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  })
}

describe('Resend webhook signer scoping', () => {
  beforeEach(() => {
    secretRows.platform = []
    secretRows.tenants = []
    invalidateWebhookSecretsCache()
  })

  it('returns only the tenant org whose secret signed the payload', async () => {
    const orgOneSecret = makeSecret('org-1')
    const orgTwoSecret = makeSecret('org-2')
    secretRows.tenants = [
      { org_id: 'org-1', webhook_secret_encrypted: orgOneSecret },
      { org_id: 'org-2', webhook_secret_encrypted: orgTwoSecret },
    ]
    const body = JSON.stringify({ type: 'email.delivered' })

    const signer = await validateResendWebhookSignature(body, signedHeaders(orgOneSecret, body))

    expect(signer).toEqual({ platform: false, tenantOrgIds: ['org-1'] })
    expect(signer && canResendWebhookSignerAccessOrg(signer, 'org-1')).toBe(true)
    expect(signer && canResendWebhookSignerAccessOrg(signer, 'org-2')).toBe(false)
  })

  it('accepts only well-formed whsec_ values for settings storage', () => {
    expect(isValidResendWebhookSecretFormat(makeSecret('long-enough-secret'))).toBe(true)
    expect(isValidResendWebhookSecretFormat('plain-text-secret')).toBe(false)
    expect(isValidResendWebhookSecretFormat('whsec_!!!')).toBe(false)
    expect(isValidResendWebhookSecretFormat('whsec_c2hvcnQ=')).toBe(false)
  })

  it('recognizes the platform signer as trusted for shared platform routes', async () => {
    const platformSecret = makeSecret('platform')
    secretRows.platform = [{ webhook_secret_encrypted: platformSecret }]
    const body = '{}'

    const signer = await validateResendWebhookSignature(body, signedHeaders(platformSecret, body))

    expect(signer).toEqual({ platform: true, tenantOrgIds: [] })
    expect(signer && canResendWebhookSignerAccessOrg(signer, 'any-org')).toBe(true)
  })

  it('rejects an old signature outside the five-minute replay window', async () => {
    const secret = makeSecret('old')
    secretRows.tenants = [{ org_id: 'org-1', webhook_secret_encrypted: secret }]
    const body = '{}'
    const oldTimestamp = Math.floor(Date.now() / 1000) - 301

    await expect(
      validateResendWebhookSignature(body, signedHeaders(secret, body, oldTimestamp)),
    ).resolves.toBeNull()
  })

  it('continues checking when another stored secret is malformed', async () => {
    const validSecret = makeSecret('valid')
    secretRows.tenants = [
      { org_id: 'broken-org', webhook_secret_encrypted: 'whsec_!!!' },
      { org_id: 'valid-org', webhook_secret_encrypted: validSecret },
    ]
    const body = '{}'

    await expect(
      validateResendWebhookSignature(body, signedHeaders(validSecret, body)),
    ).resolves.toEqual({ platform: false, tenantOrgIds: ['valid-org'] })
  })
})
