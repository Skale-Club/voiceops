// POST /api/v1/optout
// Unified opt-out endpoint — marks contacts and accounts as unsubscribed,
// adds suppression entries, and records an engagement event.
//
// Auth: Authorization: Bearer <token>
//   Token must hold the `optout:write` scope.
//
// Body: { email?: string, phone?: string, source?: string }
//   At least one of email or phone is required.
//
// Returns: { opted_out: true, affected_records: N }

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'
import { hasScope } from '@/lib/api-keys/scopes'
import { markMetaAudiencesDirty, type AudienceDirtyChange } from '@/lib/meta/audience-dirty'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const optoutSchema = z.object({
  email:  z.string().optional().nullable(),
  phone:  z.string().optional().nullable(),
  source: z.string().max(100).optional().nullable(),
})

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!apiKey) {
    return Response.json({ error: 'Invalid or revoked API key' }, { status: 401, headers: CORS_HEADERS })
  }
  if (!hasScope(apiKey.scopes, 'optout:write')) {
    return Response.json(
      { error: 'API key is missing the optout:write scope' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 422, headers: CORS_HEADERS })
  }

  let parsed: z.infer<typeof optoutSchema>
  try {
    parsed = optoutSchema.parse(raw)
  } catch (err) {
    return Response.json(
      { error: 'Invalid request body', details: (err as z.ZodError).errors },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  const emailNorm = normaliseEmail(parsed.email)
  const phoneNorm = normalisePhone(parsed.phone)
  const source    = parsed.source?.trim() || 'api'

  if (!emailNorm && !phoneNorm) {
    return Response.json(
      { error: 'At least one of email or phone is required' },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  const orgId = apiKey.org_id
  let affectedRecords = 0
  let changed = false
  const dirtyChanges: AudienceDirtyChange[] = []

  // ── 3. Opt out matching contacts ──────────────────────────────────────────
  const contactQuery = supabase
    .from('contacts')
    .select('id, email, source_type')
    .eq('org_id', orgId)

  // Build filter: match by email OR phone
  if (emailNorm && phoneNorm) {
    const { data: contacts } = await contactQuery.or(
      `email_normalized.eq.${emailNorm},phone_e164.eq.${phoneNorm}`,
    )
    if (contacts?.length) {
      const succeeded = await optOutContacts(supabase, orgId, contacts, source)
      if (succeeded) {
        affectedRecords += contacts.length
        changed = true
        dirtyChanges.push(...contacts.map((contact) => ({
          entityType: 'contact' as const,
          entityId: contact.id,
          sourceType: contact.source_type,
        })))
      }
    }
  } else if (emailNorm) {
    const { data: contacts } = await contactQuery.eq('email_normalized', emailNorm)
    if (contacts?.length) {
      const succeeded = await optOutContacts(supabase, orgId, contacts, source)
      if (succeeded) {
        affectedRecords += contacts.length
        changed = true
        dirtyChanges.push(...contacts.map((contact) => ({
          entityType: 'contact' as const,
          entityId: contact.id,
          sourceType: contact.source_type,
        })))
      }
    }
  } else if (phoneNorm) {
    const { data: contacts } = await contactQuery.eq('phone_e164', phoneNorm)
    if (contacts?.length) {
      const succeeded = await optOutContacts(supabase, orgId, contacts, source)
      if (succeeded) {
        affectedRecords += contacts.length
        changed = true
        dirtyChanges.push(...contacts.map((contact) => ({
          entityType: 'contact' as const,
          entityId: contact.id,
          sourceType: contact.source_type,
        })))
      }
    }
  }

  // ── 4. Opt out matching accounts ─────────────────────────────────────────
  if (emailNorm || phoneNorm) {
    const accountMap = new Map<string, { id: string; source_type?: string | null }>()
    if (emailNorm) {
      const { data } = await supabase
        .from('accounts')
        .select('id, source_type')
        .eq('org_id', orgId)
        .filter('custom_fields->>email', 'eq', emailNorm)
      for (const account of data ?? []) accountMap.set(account.id, account)
    }
    if (phoneNorm) {
      const { data } = await supabase
        .from('accounts')
        .select('id, source_type')
        .eq('org_id', orgId)
        .eq('phone', phoneNorm)
      for (const account of data ?? []) accountMap.set(account.id, account)
    }
    const accounts = [...accountMap.values()]

    if (accounts.length) {
      const succeeded = await optOutAccounts(supabase, orgId, accounts, source)
      if (succeeded) {
        affectedRecords += accounts.length
        changed = true
        dirtyChanges.push(...accounts.map((account) => ({
          entityType: 'account' as const,
          entityId: account.id,
          sourceType: account.source_type,
        })))
      }
    }
  }

  // ── 5. Add email suppression row (if email provided) ─────────────────────
  if (emailNorm) {
    // Insert into email_unsubscribes; ignore duplicates (upsert by email + org)
    const { error: unsub_err } = await supabase
      .from('email_unsubscribes')
      .upsert(
        { org_id: orgId, email: emailNorm, source, unsubscribed_at: new Date().toISOString() },
        { onConflict: 'org_id,email', ignoreDuplicates: false },
      )
    if (unsub_err) {
      // Non-fatal: log and continue
      console.error('[api/v1/optout] email_unsubscribes upsert error:', unsub_err)
    } else {
      changed = true
    }
  }

  if (changed) {
    await markMetaAudiencesDirty(supabase, {
      orgId,
      reason: 'prospect_optout',
      // An email suppression may affect a member even when no CRM row was
      // found, so every enabled scope must be reconciled in that case.
      changes: emailNorm ? undefined : dirtyChanges,
    })
  }

  // Touch the API key last-used timestamp
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {})

  return Response.json(
    { opted_out: true, affected_records: affectedRecords },
    { status: 200, headers: CORS_HEADERS },
  )
}

// ── helpers ────────────────────────────────────────────────────────────────────

type ServiceClient = ReturnType<typeof createServiceRoleClient>

async function optOutContacts(
  supabase: ServiceClient,
  orgId: string,
  contacts: Array<{ id: string; source_type?: string | null }>,
  source: string,
): Promise<boolean> {
  const ids = contacts.map((c) => c.id)

  const { error } = await supabase
    .from('contacts')
    .update({
      engagement_status:   'unsubscribed',
      recommended_channel: null,
      updated_at:          new Date().toISOString(),
    })
    .in('id', ids)
    .eq('org_id', orgId)
  if (error) {
    console.error('[api/v1/optout] contact update error:', error)
    return false
  }

  // Record engagement events
  const events = ids.map((id) => ({
    org_id:          orgId,
    entity_type:     'contact' as const,
    entity_id:       id,
    event_type:      'unsubscribed' as const,
    source_platform: source,
    payload:         { source } as Json,
  }))
  const { error: eventError } = await supabase.from('prospect_engagement_events').insert(events)
  if (eventError) console.error('[api/v1/optout] contact event insert error:', eventError)
  return true
}

async function optOutAccounts(
  supabase: ServiceClient,
  orgId: string,
  accounts: Array<{ id: string; source_type?: string | null }>,
  source: string,
): Promise<boolean> {
  const ids = accounts.map((a) => a.id)

  const { error } = await supabase
    .from('accounts')
    .update({
      engagement_status:   'unsubscribed',
      recommended_channel: null,
      updated_at:          new Date().toISOString(),
    })
    .in('id', ids)
    .eq('org_id', orgId)
  if (error) {
    console.error('[api/v1/optout] account update error:', error)
    return false
  }

  // Record engagement events
  const events = ids.map((id) => ({
    org_id:          orgId,
    entity_type:     'account' as const,
    entity_id:       id,
    event_type:      'unsubscribed' as const,
    source_platform: source,
    payload:         { source } as Json,
  }))
  const { error: eventError } = await supabase.from('prospect_engagement_events').insert(events)
  if (eventError) console.error('[api/v1/optout] account event insert error:', eventError)
  return true
}
