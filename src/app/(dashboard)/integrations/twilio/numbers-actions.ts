'use server'
/**
 * Twilio phone numbers | per-org CRUD server actions (v2.3).
 *
 * Each org can register multiple Twilio numbers; one (and only one) is the
 * default for outbound flows. The "exactly one default per org" invariant is
 * enforced at the DB layer via the partial unique index
 * `twilio_phone_numbers_one_default_per_org` (see migration 058).
 *
 * All actions run through the authenticated client and rely on RLS for tenant
 * isolation | never pass `organization_id` from the client.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import type { Database } from '@/types/database'
import {
  describeTwilioListError,
  parseTwilioIncomingNumbers,
  type LocalNumberRef,
  type TwilioIncomingListResponse,
  type TwilioRemoteNumber,
} from '@/lib/phone-numbers/import'
import { configureTwilioSmsWebhook, configureTwilioVoiceWebhook } from '@/lib/twilio/configure-number'
import { getVapiApiKey } from '@/lib/vapi/client'
import { syncVapiPhoneNumbers } from '@/lib/vapi/sync-phone-numbers'

export type TwilioPhoneNumberRow =
  Database['public']['Tables']['twilio_phone_numbers']['Row']

// ── Zod schemas ─────────────────────────────────────────────────────────────

const E164_REGEX = /^\+[1-9]\d{6,14}$/
const PHONE_SID_REGEX = /^PN[a-f0-9]{32}$/i

const RoutingMode = z.enum(['browser', 'sip', 'forward'])
const Provider = z.enum(['twilio', 'vapi'])

const BaseShape = z.object({
  e164: z.string().regex(E164_REGEX, 'Invalid E.164 format (e.g. +14155551234).'),
  // 'vapi' rows describe a number the customer owns inside Vapi, with no Twilio
  // account behind it: no phone_sid, no webhook sync, voice only.
  provider: Provider.default('twilio'),
  vapi_phone_number_id: z.string().trim().max(128).optional().or(z.literal('')),
  phone_sid: z
    .string()
    .regex(PHONE_SID_REGEX, 'Phone SID must look like PN followed by 32 hex chars.')
    .optional()
    .or(z.literal('')),
  friendly_name: z.string().min(1, 'Friendly name is required.').max(64, 'Max 64 chars.'),
  capability_sms: z.boolean().default(false),
  capability_mms: z.boolean().default(false),
  capability_voice: z.boolean().default(false),
  default_routing_mode: RoutingMode.nullable().optional(),
  forward_to_number: z
    .string()
    .regex(E164_REGEX, 'Forward target must be valid E.164.')
    .optional()
    .or(z.literal('')),
  is_default: z.boolean().default(false),
  notes: z.string().max(500, 'Notes max 500 chars.').optional().or(z.literal('')),
  // phone-numbers Phase 1 fields
  vapi_assistant_id: z.string().trim().max(128).optional().or(z.literal('')),
  responsible_user_id: z.string().uuid().nullable().optional(),
  business_purpose: z.string().max(120).optional().or(z.literal('')),
  inbox_label: z.string().max(64).optional().or(z.literal('')),
  chat_routing: z.record(z.unknown()).optional(),
  workflow_settings: z.record(z.unknown()).optional(),
})

function refineCapabilitiesAndForward(data: z.infer<typeof BaseShape>, ctx: z.RefinementCtx) {
  // Vapi numbers are voice-only by construction — Vapi has no SMS/MMS product —
  // so the capability picker isn't shown for them and the "pick at least one"
  // rule would be an unanswerable error. createTwilioNumber forces voice=true.
  if (
    data.provider !== 'vapi' &&
    !data.capability_sms &&
    !data.capability_mms &&
    !data.capability_voice
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Enable at least one capability (SMS, MMS, or Voice).',
      path: ['capability_sms'],
    })
  }
  if (data.provider === 'vapi' && !data.vapi_phone_number_id) {
    ctx.addIssue({
      code: 'custom',
      message: 'A Vapi number requires its Vapi phone-number ID.',
      path: ['vapi_phone_number_id'],
    })
  }
  if (data.default_routing_mode === 'forward' && !data.forward_to_number) {
    ctx.addIssue({
      code: 'custom',
      message: 'Forward target number is required when routing mode is "forward".',
      path: ['forward_to_number'],
    })
  }
}

const CreateNumberSchema = BaseShape.superRefine(refineCapabilitiesAndForward)

const UpdateNumberSchema = BaseShape.partial().superRefine((data, ctx) => {
  // Only apply combined refinements when the relevant fields are present.
  if (
    data.provider !== 'vapi' &&
    (data.capability_sms !== undefined ||
      data.capability_mms !== undefined ||
      data.capability_voice !== undefined)
  ) {
    const sms = data.capability_sms ?? false
    const mms = data.capability_mms ?? false
    const voice = data.capability_voice ?? false
    if (!sms && !mms && !voice) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enable at least one capability (SMS, MMS, or Voice).',
        path: ['capability_sms'],
      })
    }
  }
  if (data.default_routing_mode === 'forward' && !data.forward_to_number) {
    ctx.addIssue({
      code: 'custom',
      message: 'Forward target number is required when routing mode is "forward".',
      path: ['forward_to_number'],
    })
  }
})

export type CreateNumberInput = z.input<typeof CreateNumberSchema>
export type UpdateNumberInput = z.input<typeof UpdateNumberSchema>

// ── Helpers ─────────────────────────────────────────────────────────────────

function nullableString(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function revalidateAll() {
  revalidatePath('/integrations')
  revalidatePath('/integrations/twilio')
  revalidatePath('/calls')
}

export interface OrgMemberOption {
  user_id: string
  display_name: string
  email: string | null
}

/**
 * List org members for the "responsible user" selector. Returns minimum-needed
 * fields. RLS scopes the org_members select to the active org.
 */
export async function listOrgMembersForSelect(): Promise<OrgMemberOption[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  const orgId = orgIdData as string | null
  if (!orgId) return []

  // Use the member_profiles RPC (SECURITY DEFINER, can read auth.users for names/emails).
  // Requires p_org_id — previously called without args which caused a silent error and
  // fell back to raw UUIDs as display names.
  try {
    const { data, error } = await supabase.rpc('get_org_member_profiles', {
      p_org_id: orgId,
      p_page: 1,
      p_per_page: 200,
    })
    if (!error && Array.isArray(data)) {
      const seen = new Set<string>()
      return (data as Array<{ user_id: string; full_name?: string | null; email?: string | null }>)
        .filter((row) => row.user_id)
        .map((row) => ({
          user_id: row.user_id,
          display_name: (row.full_name?.trim() || row.email || row.user_id) as string,
          email: row.email ?? null,
        }))
        .filter((row) => {
          if (seen.has(row.user_id)) return false
          seen.add(row.user_id)
          return true
        })
    }
  } catch {
    // RPC unavailable — fall back to org_members only (no profile names).
  }

  // Fallback: list member user_ids without profile data.
  const { data: members } = await supabase.from('org_members').select('user_id')
  return (members ?? [])
    .map((m) => m.user_id as string)
    .filter(Boolean)
    .map((id) => ({ user_id: id, display_name: id, email: null }))
}

// ── Actions ─────────────────────────────────────────────────────────────────

interface TwilioCredBlob {
  account_sid?: string
  auth_token?: string
}

async function getTwilioCredBlob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<{ blob?: TwilioCredBlob; error?: string }> {
  const { data: integrationRow } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', orgId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!integrationRow) {
    return { error: 'Twilio is not connected for this org. Connect it first.' }
  }

  try {
    const blob = JSON.parse(await decrypt(integrationRow.encrypted_api_key)) as TwilioCredBlob
    if (!blob.account_sid || !blob.auth_token) {
      return { error: 'Account SID or Auth Token missing. Reconnect Twilio.' }
    }
    return { blob }
  } catch {
    return { error: 'Failed to decrypt Twilio credentials.' }
  }
}

/**
 * Configure the Twilio-side inbound webhooks (SMS + Voice) on the number's
 * IncomingPhoneNumber resource so Twilio actually delivers inbound traffic to
 * Xphere. Without the Voice webhook, inbound CALLS silently never reach the app
 * (the SMS webhook alone is not enough — that was the gap that broke inbound
 * calls). Best-effort per capability; returns the first error encountered.
 */
async function syncWebhooksIfPossible(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  orgId: string
  phoneSid: string | null
  capabilitySms: boolean
  capabilityVoice: boolean
}): Promise<{ error?: string }> {
  if (!params.phoneSid) return {}
  if (!params.capabilitySms && !params.capabilityVoice) return {}

  const { blob, error } = await getTwilioCredBlob(params.supabase, params.orgId)
  if (error || !blob?.account_sid || !blob.auth_token) return { error }

  if (params.capabilitySms) {
    const result = await configureTwilioSmsWebhook({
      accountSid: blob.account_sid,
      authToken: blob.auth_token,
      phoneSid: params.phoneSid,
    })
    if (!result.ok) return { error: `SMS webhook: ${result.error}` }
  }

  if (params.capabilityVoice) {
    const result = await configureTwilioVoiceWebhook({
      accountSid: blob.account_sid,
      authToken: blob.auth_token,
      phoneSid: params.phoneSid,
    })
    if (!result.ok) return { error: `Voice webhook: ${result.error}` }
  }

  return {}
}

/**
 * Re-apply the SMS + Voice webhooks for an already-saved number. Lets operators
 * fix a number whose Twilio-side routing drifted (e.g. imported before voice
 * webhook sync existed) without re-editing every field.
 */
export async function resyncTwilioNumberWebhooks(id: string): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('twilio_phone_numbers')
    .select('provider, phone_sid, capability_sms, capability_voice, organization_id')
    .eq('id', id)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!row) return { error: 'Phone number not found.' }
  if (row.provider === 'vapi') {
    return { error: 'Vapi numbers have no Twilio webhooks — Vapi delivers the call itself.' }
  }
  if (!row.phone_sid) {
    return { error: 'No Twilio Phone SID on this number. Re-import it from Twilio first.' }
  }

  const sync = await syncWebhooksIfPossible({
    supabase,
    orgId: row.organization_id,
    phoneSid: row.phone_sid,
    capabilitySms: row.capability_sms,
    capabilityVoice: row.capability_voice,
  })
  if (sync.error) return { error: sync.error }

  revalidateAll()
  return {}
}

/**
 * Fetch the org's IncomingPhoneNumbers directly from Twilio, marked with
 * `alreadyImported=true` when the same SID/E.164 is already stored locally.
 * Used by the Add Phone Number wizard so operators pick from real owned
 * numbers instead of typing E.164 strings.
 */
export async function listIncomingTwilioNumbers(): Promise<{
  data?: TwilioRemoteNumber[]
  error?: string
}> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const { blob, error: credsError } = await getTwilioCredBlob(supabase, orgId as string)
  if (credsError || !blob?.account_sid || !blob.auth_token) return { error: credsError }

  // Pull the existing local rows so we can flag duplicates without a second
  // round-trip from the client.
  const { data: localRows } = await supabase
    .from('twilio_phone_numbers')
    .select('phone_sid, e164')
    .eq('is_active', true)
  const localRefs: LocalNumberRef[] = (localRows ?? []).map((row) => ({
    sid: (row.phone_sid as string | null) ?? null,
    e164: row.e164 as string,
  }))

  const basicAuth = btoa(`${blob.account_sid}:${blob.auth_token}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${blob.account_sid}/IncomingPhoneNumbers.json?PageSize=50`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error contacting Twilio.' }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { error: describeTwilioListError(res.status, body) }
  }

  let payload: TwilioIncomingListResponse
  try {
    payload = (await res.json()) as TwilioIncomingListResponse
  } catch {
    return { error: 'Twilio returned an unexpected response.' }
  }

  return { data: parseTwilioIncomingNumbers(payload, localRefs) }
}

/**
 * Register the org's Vapi phone numbers locally so they can be attributed,
 * labelled and used as workflow triggers. Idempotent: numbers already present
 * are skipped, so local edits survive a re-run.
 */
export async function importVapiNumbers(): Promise<{
  imported?: number
  existing?: number
  skipped?: number
  error?: string
}> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const apiKey = await getVapiApiKey()
  if (!apiKey) {
    return { error: 'Vapi is not connected for this org. Connect it in Integrations first.' }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const result = await syncVapiPhoneNumbers(supabase, orgId as string, apiKey)
  if (!result.ok) return { error: result.error }

  revalidateAll()
  return { imported: result.imported, existing: result.existing, skipped: result.skipped }
}

export async function listTwilioNumbers(): Promise<TwilioPhoneNumberRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('friendly_name', { ascending: true })

  if (error || !data) return []
  return data
}

export async function createTwilioNumber(
  input: CreateNumberInput,
): Promise<{ data?: TwilioPhoneNumberRow; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = CreateNumberSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' }
  }
  const body = parsed.data

  const isVapi = body.provider === 'vapi'

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  // If marking as default, clear prior defaults first. RLS scopes the update
  // to the current org | no need to filter explicitly.
  if (body.is_default) {
    const { error: clearError } = await supabase
      .from('twilio_phone_numbers')
      .update({ is_default: false })
      .eq('is_default', true)
    if (clearError) return { error: clearError.message }
  }

  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .insert({
      organization_id: orgId,
      e164: body.e164,
      provider: body.provider,
      vapi_phone_number_id: isVapi ? nullableString(body.vapi_phone_number_id) : null,
      phone_sid: isVapi ? null : nullableString(body.phone_sid),
      friendly_name: body.friendly_name,
      capability_sms: isVapi ? false : body.capability_sms,
      capability_mms: isVapi ? false : body.capability_mms,
      capability_voice: isVapi ? true : body.capability_voice,
      default_routing_mode: body.default_routing_mode ?? null,
      forward_to_number: nullableString(body.forward_to_number),
      is_default: body.is_default,
      notes: nullableString(body.notes),
      vapi_assistant_id: nullableString(body.vapi_assistant_id),
      responsible_user_id: body.responsible_user_id ?? null,
      business_purpose: nullableString(body.business_purpose),
      inbox_label: nullableString(body.inbox_label),
      chat_routing: (body.chat_routing ?? {}) as Database['public']['Tables']['twilio_phone_numbers']['Insert']['chat_routing'],
      workflow_settings: (body.workflow_settings ?? {}) as Database['public']['Tables']['twilio_phone_numbers']['Insert']['workflow_settings'],
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505' && error.message.includes('e164')) {
      return { error: `A number with E.164 ${body.e164} already exists.` }
    }
    if (error.code === '23505' && error.message.includes('vapi_number')) {
      return { error: 'That Vapi number is already registered for this org.' }
    }
    return { error: error.message }
  }

  const sync = await syncWebhooksIfPossible({
    supabase,
    orgId: orgId as string,
    phoneSid: data.phone_sid,
    capabilitySms: data.capability_sms,
    capabilityVoice: data.capability_voice,
  })
  if (sync.error) {
    return { data, error: `Number saved, but webhook sync failed: ${sync.error}` }
  }

  revalidateAll()
  return { data }
}

export async function updateTwilioNumber(
  id: string,
  input: UpdateNumberInput,
): Promise<{ data?: TwilioPhoneNumberRow; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = UpdateNumberSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' }
  }
  const body = parsed.data

  const supabase = await createClient()

  if (body.is_default === true) {
    const { error: clearError } = await supabase
      .from('twilio_phone_numbers')
      .update({ is_default: false })
      .eq('is_default', true)
      .neq('id', id)
    if (clearError) return { error: clearError.message }
  }

  const patch: Record<string, unknown> = {}
  if (body.e164 !== undefined) patch.e164 = body.e164
  // provider and vapi_phone_number_id are set at import time and identify the
  // number — changing them would silently repoint an existing row (and its call
  // history) at a different number, so they aren't editable here.
  if (body.phone_sid !== undefined) patch.phone_sid = nullableString(body.phone_sid)
  if (body.friendly_name !== undefined) patch.friendly_name = body.friendly_name
  if (body.capability_sms !== undefined) patch.capability_sms = body.capability_sms
  if (body.capability_mms !== undefined) patch.capability_mms = body.capability_mms
  if (body.capability_voice !== undefined) patch.capability_voice = body.capability_voice
  if (body.default_routing_mode !== undefined) patch.default_routing_mode = body.default_routing_mode ?? null
  if (body.forward_to_number !== undefined) patch.forward_to_number = nullableString(body.forward_to_number)
  if (body.is_default !== undefined) patch.is_default = body.is_default
  if (body.notes !== undefined) patch.notes = nullableString(body.notes)
  if (body.vapi_assistant_id !== undefined) patch.vapi_assistant_id = nullableString(body.vapi_assistant_id)
  if (body.responsible_user_id !== undefined) patch.responsible_user_id = body.responsible_user_id ?? null
  if (body.business_purpose !== undefined) patch.business_purpose = nullableString(body.business_purpose)
  if (body.inbox_label !== undefined) patch.inbox_label = nullableString(body.inbox_label)
  if (body.chat_routing !== undefined) patch.chat_routing = body.chat_routing ?? {}
  if (body.workflow_settings !== undefined) patch.workflow_settings = body.workflow_settings ?? {}

  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: error.message }

  const sync = await syncWebhooksIfPossible({
    supabase,
    orgId: data.organization_id,
    phoneSid: data.phone_sid,
    capabilitySms: data.capability_sms,
    capabilityVoice: data.capability_voice,
  })
  if (sync.error) {
    return { data, error: `Number saved, but webhook sync failed: ${sync.error}` }
  }

  revalidateAll()
  return { data }
}

export async function softDeleteTwilioNumber(
  id: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Clear the default flag at the same time | soft-deleting the default leaves
  // the org with no default, which is the correct prompt to pick a new one.
  const { error } = await supabase
    .from('twilio_phone_numbers')
    .update({ is_active: false, is_default: false, archived_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidateAll()
  return {}
}

export async function setDefaultTwilioNumber(
  id: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Verify the target row exists and is active | early error beats a confusing
  // partial-state outcome.
  const { data: target, error: lookupError } = await supabase
    .from('twilio_phone_numbers')
    .select('id, is_active')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return { error: lookupError.message }
  if (!target) return { error: 'Phone number not found.' }
  if (!target.is_active) return { error: 'Cannot set an inactive number as default. Reactivate it first.' }

  // Clear all defaults in this org (RLS scopes the update); then set the target.
  const { error: clearError } = await supabase
    .from('twilio_phone_numbers')
    .update({ is_default: false })
    .eq('is_default', true)
  if (clearError) return { error: clearError.message }

  const { error: setError } = await supabase
    .from('twilio_phone_numbers')
    .update({ is_default: true })
    .eq('id', id)
  if (setError) return { error: setError.message }

  revalidateAll()
  return {}
}
