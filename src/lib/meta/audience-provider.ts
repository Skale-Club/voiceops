// Tenant-owned credential resolution for Meta Custom Audience operations.
// Access tokens exist only in memory after the explicit connection has passed
// organization, platform, account, status, and expiry checks.

import { decrypt } from '@/lib/crypto'

export interface MetaAudienceConnection {
  token: string
  adAccountId: string
  connectionId?: string
}

export interface MetaConnectionProvider {
  getConnection(
    orgId: string,
    adAccountId: string,
    connectionId?: string,
  ): Promise<MetaAudienceConnection>
}

export type MetaAudienceConnectionErrorCode =
  | 'CONNECTION_ID_REQUIRED'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_INACCESSIBLE'
  | 'CONNECTION_INACTIVE'
  | 'CONNECTION_ACCOUNT_MISMATCH'
  | 'CONNECTION_EXPIRY_UNKNOWN'
  | 'CONNECTION_EXPIRED'
  | 'CONNECTION_TOKEN_MISSING'
  | 'CONNECTION_DECRYPT_FAILED'
  | 'AGENCY_TOKEN_MISSING'

const SAFE_MESSAGES: Record<MetaAudienceConnectionErrorCode, string> = {
  CONNECTION_ID_REQUIRED: 'Select a tenant Meta connection before syncing.',
  CONNECTION_NOT_FOUND: 'The selected tenant Meta connection was not found.',
  CONNECTION_INACCESSIBLE: 'The selected tenant Meta connection could not be read.',
  CONNECTION_INACTIVE: 'The selected tenant Meta connection is not active.',
  CONNECTION_ACCOUNT_MISMATCH: 'The selected Meta connection does not own this ad account.',
  CONNECTION_EXPIRY_UNKNOWN: 'The selected Meta connection has no auditable expiry.',
  CONNECTION_EXPIRED: 'The selected tenant Meta connection has expired.',
  CONNECTION_TOKEN_MISSING: 'The selected tenant Meta connection has no usable token.',
  CONNECTION_DECRYPT_FAILED: 'The selected tenant Meta credential could not be decrypted.',
  AGENCY_TOKEN_MISSING: 'The explicitly selected agency Meta fallback is not configured.',
}

export class MetaAudienceConnectionError extends Error {
  constructor(public readonly code: MetaAudienceConnectionErrorCode) {
    super(SAFE_MESSAGES[code])
    this.name = 'MetaAudienceConnectionError'
  }
}

interface AdsConnectionRecord {
  id: string
  org_id: string
  platform: string
  ad_account_id: string
  status: string
  usable: boolean
  encrypted_access_token: string | null
  token_expires_at: string | null
}

interface AdsConnectionQuery {
  eq(column: string, value: string): AdsConnectionQuery
  maybeSingle(): Promise<{
    data: AdsConnectionRecord | null
    error: { message: string } | null
  }>
}

export interface AdsConnectionQueryClient {
  from(table: 'ads_connections'): {
    select(columns: string): AdsConnectionQuery
  }
}

export interface OrgOAuthProviderOptions {
  decryptToken?: (encrypted: string) => Promise<string>
  now?: () => Date
}

export class OrgOAuthProvider implements MetaConnectionProvider {
  private readonly decryptToken: (encrypted: string) => Promise<string>
  private readonly now: () => Date

  constructor(
    private readonly client: AdsConnectionQueryClient,
    options: OrgOAuthProviderOptions = {},
  ) {
    this.decryptToken = options.decryptToken ?? decrypt
    this.now = options.now ?? (() => new Date())
  }

  async getConnection(
    orgId: string,
    adAccountId: string,
    connectionId?: string,
  ): Promise<MetaAudienceConnection> {
    if (!connectionId) throw new MetaAudienceConnectionError('CONNECTION_ID_REQUIRED')

    const { data, error } = await this.client
      .from('ads_connections')
      .select(
        'id, org_id, platform, ad_account_id, status, usable, encrypted_access_token, token_expires_at',
      )
      .eq('id', connectionId)
      .eq('org_id', orgId)
      .eq('platform', 'meta')
      .maybeSingle()

    if (error) throw new MetaAudienceConnectionError('CONNECTION_INACCESSIBLE')
    if (!data) throw new MetaAudienceConnectionError('CONNECTION_NOT_FOUND')
    // `usable` = status='active' AND health='ok' — the single "can we call the
    // platform API" answer. See docs/integrations/ads-connection-health-plan.md.
    if (!data.usable) throw new MetaAudienceConnectionError('CONNECTION_INACTIVE')
    if (data.ad_account_id !== adAccountId) {
      throw new MetaAudienceConnectionError('CONNECTION_ACCOUNT_MISMATCH')
    }
    if (!data.token_expires_at) {
      throw new MetaAudienceConnectionError('CONNECTION_EXPIRY_UNKNOWN')
    }
    const expiresAt = Date.parse(data.token_expires_at)
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
      throw new MetaAudienceConnectionError('CONNECTION_EXPIRED')
    }
    if (!data.encrypted_access_token) {
      throw new MetaAudienceConnectionError('CONNECTION_TOKEN_MISSING')
    }

    let token: string
    try {
      token = await this.decryptToken(data.encrypted_access_token)
    } catch {
      throw new MetaAudienceConnectionError('CONNECTION_DECRYPT_FAILED')
    }
    if (!token.trim()) throw new MetaAudienceConnectionError('CONNECTION_TOKEN_MISSING')

    return { token, adAccountId: data.ad_account_id, connectionId: data.id }
  }
}

/** Agency fallback is available only when this provider is explicitly chosen. */
export class AgencySystemUserProvider implements MetaConnectionProvider {
  async getConnection(
    _orgId: string,
    adAccountId: string,
  ): Promise<MetaAudienceConnection> {
    const token = process.env.META_SYSTEM_USER_TOKEN
    if (!token) throw new MetaAudienceConnectionError('AGENCY_TOKEN_MISSING')
    return { token, adAccountId }
  }
}
