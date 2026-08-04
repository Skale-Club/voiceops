// Executor for the `contact_create` action node.
//
// Creates or updates a contact in Xphere's own CRM — the native counterpart to
// `create_contact` (which writes to GoHighLevel). Exists so an AI agent can
// capture a caller straight into the platform without an external CRM
// connected: the receptionist voice tool is the first consumer.
//
// Dedup mirrors POST /api/v1/contacts: phone (E.164, multi-candidate) → email
// (normalized) → create. `contact.created` is emitted only on a real insert, so
// a repeat caller does not re-fire every `contact.created` workflow.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { ContactSource } from '@/types/database'
import { canonicalizeContactPhone } from '@/lib/phone-numbers/normalize'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { emitContactEvent } from '@/lib/contacts/events'

const SOURCES: ContactSource[] = [
  'manual', 'whatsapp', 'sms', 'instagram', 'facebook',
  'messenger', 'csv_import', 'ghl_sync', 'api', 'voice_call',
]

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Unknown labels fall back to 'manual' rather than tripping the DB CHECK. */
function toSource(value: unknown): ContactSource {
  const raw = str(value)
  return raw && (SOURCES as string[]).includes(raw) ? (raw as ContactSource) : 'manual'
}

export interface CreateCrmContactOptions {
  /**
   * Static node config, applied UNDER `params`. On the tool-call path `params`
   * holds the LLM's arguments and the node config supplies the constants.
   */
  defaults?: unknown
  /** Caller ID from a live voice call — preferred over a spoken-back number. */
  callerNumber?: string
}

export async function executeCreateCrmContact(
  rawParams: Record<string, unknown>,
  orgId: string,
  options: CreateCrmContactOptions = {},
): Promise<string> {
  const defaults =
    options.defaults && typeof options.defaults === 'object' && !Array.isArray(options.defaults)
      ? (options.defaults as Record<string, unknown>)
      : {}
  const params = { ...defaults, ...rawParams }

  const first = str(params.first_name)
  const last = str(params.last_name)
  const name = str(params.name) ?? str([first, last].filter(Boolean).join(' '))
  const company = str(params.company)
  const notes = str(params.notes)
  const source = toSource(params.source)
  const countryHint = str(params.country)

  // Caller ID beats a number the assistant transcribed from speech.
  const { value: phone, matchCandidates } = canonicalizeContactPhone(
    str(options.callerNumber) ?? str(params.phone),
    countryHint,
  )
  const email = normaliseEmail(str(params.email))

  if (!phone && !email && !name) {
    throw new Error('contact_create: provide at least one of name, phone, email')
  }

  const supabase = createServiceRoleClient()

  // ── Dedup ────────────────────────────────────────────────────────────────
  let existingId: string | null = null

  if (matchCandidates.length > 0) {
    // Two rows can legitimately match (a legacy loose-form row and an E.164
    // one) — prefer the oldest, same rule as the public contacts endpoint.
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .in('phone_e164', matchCandidates)
      .neq('identity_status', 'archived_duplicate')
      .order('created_at', { ascending: true })
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id
  }

  if (!existingId && email) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', email)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existingId = data.id
  }

  // ── Update ───────────────────────────────────────────────────────────────
  if (existingId) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name) patch.name = name
    if (first) patch.first_name = first
    if (last) patch.last_name = last
    if (phone) patch.phone = phone
    if (email) patch.email = email
    if (company) patch.company = company

    // Appending keeps the history of what each call was about; overwriting
    // would erase the previous reason on every repeat caller.
    if (notes) {
      const { data: cur } = await supabase
        .from('contacts')
        .select('notes')
        .eq('id', existingId)
        .single()
      const prev = cur?.notes?.trim()
      patch.notes = prev ? `${prev}\n\n${notes}` : notes
    }

    const { error } = await supabase.from('contacts').update(patch).eq('id', existingId)
    if (error) throw new Error(`contact_create failed: ${error.message}`)

    return `Contact updated: ${name ?? phone ?? email} (${existingId})`
  }

  // ── Create ───────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name,
      first_name: first,
      last_name: last,
      phone,
      email,
      company,
      notes,
      source,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`contact_create failed: ${error?.message ?? 'insert returned no row'}`)
  }

  // Fires the org's `contact.created` workflows (team notifications, sync,
  // follow-up). Never let a downstream workflow failure fail the capture —
  // the contact is already saved and the agent is waiting on this call.
  try {
    await emitContactEvent(orgId, 'contact.created', data.id, { supabase })
  } catch (err) {
    console.error(
      '[contact_create] emitContactEvent failed:',
      err instanceof Error ? err.message : 'unknown error',
    )
  }

  return `Contact created: ${name ?? phone ?? email} (${data.id})`
}
