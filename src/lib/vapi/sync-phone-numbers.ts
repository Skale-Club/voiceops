// src/lib/vapi/sync-phone-numbers.ts
// Mirrors the org's Vapi phone-number inventory into twilio_phone_numbers as
// rows with provider='vapi'.
//
// Why they need a local row at all: a customer who already owns their number and
// uses Vapi purely as the answering bot still needs the number to be a real
// entity in Xphere — so calls can be attributed to it, workflows can trigger on
// it, and it can carry a label, an owner and a forwarding target. Reading the
// list live from the Vapi API (which is what the Numbers tab used to do) can't
// support any of that: there is no id to FK against.
//
// Follows the claim guard from sync-assistants.ts: never take a number another
// org already registered. One Vapi account can legitimately serve several
// Xphere orgs, and silently repointing a number would move another tenant's
// call history and workflow triggers.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { listVapiPhoneNumbers, VapiApiError } from '@/lib/vapi/client'

export interface SyncVapiPhoneNumbersResult {
  ok: boolean
  /** Rows created for numbers that had none. */
  imported?: number
  /** Rows already present for this org — left untouched, local edits preserved. */
  existing?: number
  /** Numbers left alone because another org already registered them. */
  skipped?: number
  error?: string
}

export async function syncVapiPhoneNumbers(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  apiKey: string,
): Promise<SyncVapiPhoneNumbersResult> {
  let remote: Awaited<ReturnType<typeof listVapiPhoneNumbers>>
  try {
    remote = await listVapiPhoneNumbers(apiKey)
  } catch (err) {
    if (err instanceof VapiApiError) {
      return { ok: false, error: `Vapi returned ${err.status}.` }
    }
    return { ok: false, error: 'Failed to reach Vapi.' }
  }

  // A number with no E.164 isn't usable as a phone number yet (Vapi shows these
  // while a purchase or BYO import is still activating), and e164 is NOT NULL.
  const candidates = remote.filter((n) => Boolean(n.id) && Boolean(n.number))
  if (candidates.length === 0) {
    return { ok: true, imported: 0, existing: 0, skipped: 0 }
  }

  const { data: claimed, error: claimError } = await supabase
    .from('twilio_phone_numbers')
    .select('vapi_phone_number_id, organization_id')
    .in(
      'vapi_phone_number_id',
      candidates.map((n) => n.id),
    )

  if (claimError) return { ok: false, error: claimError.message }

  const mine = new Set<string>()
  const theirs = new Set<string>()
  for (const row of claimed ?? []) {
    const id = row.vapi_phone_number_id
    if (!id) continue
    if (row.organization_id === organizationId) mine.add(id)
    else theirs.add(id)
  }

  const importable = candidates.filter((n) => !mine.has(n.id) && !theirs.has(n.id))

  if (importable.length === 0) {
    return { ok: true, imported: 0, existing: mine.size, skipped: theirs.size }
  }

  // Plain insert, not upsert: rows already owned by this org are filtered out
  // above, so a re-sync can never overwrite a label, owner or forwarding target
  // the operator set by hand.
  const { error } = await supabase.from('twilio_phone_numbers').insert(
    importable.map((n) => ({
      organization_id: organizationId,
      provider: 'vapi' as const,
      vapi_phone_number_id: n.id,
      e164: n.number as string,
      friendly_name: n.name?.trim() || (n.number as string),
      // Vapi has no SMS/MMS product — these numbers are voice only.
      capability_voice: true,
      capability_sms: false,
      capability_mms: false,
      // Carry over the assistant Vapi already has bound to the number, so the
      // Numbers tab shows the binding without a second round-trip.
      vapi_assistant_id: n.assistantId ?? null,
    })),
  )

  if (error) {
    // The org+e164 unique index can still reject a number the org already holds
    // as a Twilio row (same E.164 registered both ways).
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'One of these numbers is already registered for this org under a different provider.',
      }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true, imported: importable.length, existing: mine.size, skipped: theirs.size }
}
