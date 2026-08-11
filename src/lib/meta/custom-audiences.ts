// Meta Marketing API — Custom Audiences (Customer File)
// Graph API version is centralized in meta-oauth, schema: EMAIL_SHA256 + PHONE_SHA256
// https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences

import { sha256Hex, normalizePhone, graphPost, graphGet, graphDelete } from '@/lib/meta/graph'

const BATCH_SIZE = 10_000

// ─── Types ────────────────────────────────────────────────────────────────────

export type AudienceUserOperation = 'ADD' | 'REMOVE'
export type MetaCustomerFileSource =
  | 'USER_PROVIDED_ONLY'
  | 'PARTNER_PROVIDED_ONLY'
  | 'BOTH_USER_AND_PARTNER_PROVIDED'

export interface AudienceBatchResult {
  num_received: number
  num_invalid_entries: number
  invalid_entry_samples?: Record<string, string>
}

export interface AudienceStatus {
  id: string
  name: string
  approximate_count_lower_bound: number
  approximate_count_upper_bound: number
  operation_status: { code: number; description: string }
  data_source: { type: string }
}

// ─── Audience management ──────────────────────────────────────────────────────

export async function createCustomAudience(
  adAccountId: string,
  token: string,
  opts: { name: string; description?: string; consentBasis?: MetaCustomerFileSource },
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(`${adAccountId}/customaudiences`, token, {
    name: opts.name,
    subtype: 'CUSTOM',
    description: opts.description ?? 'Xphere CRM sync',
    customer_file_source: opts.consentBasis ?? 'USER_PROVIDED_ONLY',
  })
}

export async function getAudienceStatus(
  audienceId: string,
  token: string,
): Promise<AudienceStatus> {
  return graphGet<AudienceStatus>(
    audienceId,
    token,
    { fields: 'id,name,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,data_source' },
  )
}

// ─── Contact hashing ──────────────────────────────────────────────────────────

export interface ContactHashEntry {
  email?: string | null
  phone?: string | null
}

/** Already-normalized SHA-256 values from the durable membership projector. */
export interface AudienceHashEntry {
  emailHash?: string | null
  phoneHash?: string | null
}

export interface HashedPayloadEntry {
  data: string[][]     // [[email_hash, phone_hash], ...] — empty string for missing field
  schema: string[]     // ['EMAIL_SHA256', 'PHONE_SHA256']
}

export async function hashContacts(contacts: ContactHashEntry[]): Promise<HashedPayloadEntry> {
  const schema = ['EMAIL_SHA256', 'PHONE_SHA256']
  const data: string[][] = []

  for (const c of contacts) {
    const emailHash = c.email ? await sha256Hex(c.email) : ''
    const phoneHash = c.phone ? await sha256Hex(normalizePhone(c.phone)) : ''
    // Skip entries with no hashable data
    if (!emailHash && !phoneHash) continue
    data.push([emailHash, phoneHash])
  }

  return { schema, data }
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/** Build Meta's paired schema without ever reintroducing raw identifiers. */
export function payloadFromHashes(entries: AudienceHashEntry[]): HashedPayloadEntry {
  const schema = ['EMAIL_SHA256', 'PHONE_SHA256']
  const data: string[][] = []

  for (const entry of entries) {
    const emailHash = entry.emailHash ?? ''
    const phoneHash = entry.phoneHash ?? ''
    if (emailHash && !SHA256_HEX.test(emailHash)) throw new Error('Invalid email SHA-256 hash')
    if (phoneHash && !SHA256_HEX.test(phoneHash)) throw new Error('Invalid phone SHA-256 hash')
    if (!emailHash && !phoneHash) continue
    data.push([emailHash, phoneHash])
  }

  return { schema, data }
}

// ─── Sync batches ─────────────────────────────────────────────────────────────

export async function syncUsersToAudience(
  audienceId: string,
  token: string,
  contacts: ContactHashEntry[],
  operation: AudienceUserOperation,
): Promise<{ sent: number; invalid: number }> {
  const { schema, data } = await hashContacts(contacts)
  return syncPayload(audienceId, token, schema, data, operation)
}

/** Submit the safe hash-only rows emitted by audience reconciliation. */
export async function syncHashedUsersToAudience(
  audienceId: string,
  token: string,
  entries: AudienceHashEntry[],
  operation: AudienceUserOperation,
): Promise<{ sent: number; invalid: number }> {
  const { schema, data } = payloadFromHashes(entries)
  return syncPayload(audienceId, token, schema, data, operation)
}

async function syncPayload(
  audienceId: string,
  token: string,
  schema: string[],
  data: string[][],
  operation: AudienceUserOperation,
): Promise<{ sent: number; invalid: number }> {
  if (data.length === 0) return { sent: 0, invalid: 0 }

  let totalSent = 0
  let totalInvalid = 0

  // ADD → HTTP POST, REMOVE → HTTP DELETE (same hashed payload body). Using POST
  // for REMOVE would silently re-ADD the users (e.g. re-adding opted-out / DND
  // contacts) — a privacy/compliance bug.
  const send = operation === 'REMOVE' ? graphDelete : graphPost

  for (let offset = 0; offset < data.length; offset += BATCH_SIZE) {
    const chunk = data.slice(offset, offset + BATCH_SIZE)
    const result = await send<AudienceBatchResult>(
      `${audienceId}/users`,
      token,
      { payload: { schema, data: chunk } },
    )
    totalSent += result.num_received ?? chunk.length
    totalInvalid += result.num_invalid_entries ?? 0
  }

  return { sent: totalSent, invalid: totalInvalid }
}

export { BATCH_SIZE }
