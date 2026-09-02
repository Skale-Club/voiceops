// src/lib/twilio/send-sms.ts
// Executor for the send_sms action type.
//
// Sends an SMS via the Twilio Messages REST API using the org's stored
// Twilio credentials (Account SID + Auth Token) from the integrations table.
//
// Credential blob format (encrypted_api_key JSON): { account_sid, auth_token }
//
// Number resolution:
//   1. If `params.phone_number_id` (or legacy `fromNumberId`) is provided, the
//      corresponding active row in `twilio_phone_numbers` is used (must have
//      `capability_sms=true`).
//   2. Otherwise, the org's default number (is_default=true, is_active=true,
//      capability_sms=true) is used.
//
// Failure classes | callers need to tell two things apart:
//   - Transient / infrastructure failures (5xx, network, auth) throw a plain
//     Error and SHOULD fail the calling run, because a retry can succeed.
//   - Permanent rejections of this destination (invalid number, region not
//     enabled on the account, STOP opt-out, landline) throw
//     SmsUndeliverableError. No amount of retrying changes the outcome, so the
//     action engine turns these into a structured skip instead of a failed run
//     (see execute-action.ts). Over July-August 2026, 155 of 160 failed
//     workflow runs were exactly these two Twilio codes re-tried every night.
//
// Result strings never contain newlines | Vapi's response parser breaks on \n.

import { decrypt } from '@/lib/crypto'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export interface TwilioCredentials {
  accountSid: string
  authToken: string
  fromNumber: string
  /** integrations.id of the Twilio row | lets callers update its health. */
  integrationId: string
  /** Snapshot of the integration health at resolve time. */
  healthStatus: string | null
  lastError: string | null
}

export interface ResolveTwilioCredentialsOptions {
  /** Specific `twilio_phone_numbers.id` to use instead of the org's default. */
  fromNumberId?: string
}

/**
 * Why a destination can never receive this SMS.
 *  - invalid_number      Twilio 21211/21217 | the To number is not a real phone number
 *  - region_not_enabled  Twilio 21408 | the ACCOUNT has SMS geo-permissions off for the To country
 *  - opted_out           Twilio 21610 | the recipient replied STOP to this From number
 *  - not_mobile          Twilio 21614 | landline / cannot receive SMS
 *  - unreachable         Twilio 21612/21214 | no route from this From number to the To number
 */
export type SmsUndeliverableKind =
  | 'invalid_number'
  | 'region_not_enabled'
  | 'opted_out'
  | 'not_mobile'
  | 'unreachable'

export class SmsUndeliverableError extends Error {
  readonly kind: SmsUndeliverableKind
  readonly to: string
  readonly twilioCode: number | null
  /** What a human can do about it. Single line. */
  readonly hint: string
  /**
   * true when the fix is on the org's Twilio ACCOUNT (geo permissions), not on
   * the contact's number. These are surfaced on the integration's health so
   * the org sees them in /integrations instead of in a failed run.
   */
  readonly accountConfig: boolean

  constructor(params: {
    kind: SmsUndeliverableKind
    to: string
    message: string
    twilioCode?: number | null
    hint: string
    accountConfig?: boolean
  }) {
    super(params.message)
    this.name = 'SmsUndeliverableError'
    this.kind = params.kind
    this.to = params.to
    this.twilioCode = params.twilioCode ?? null
    this.hint = params.hint
    this.accountConfig = params.accountConfig ?? false
  }
}

/** Prefix of `integrations.last_error` written by noteTwilioAccountProblem. */
export const TWILIO_ACCOUNT_PROBLEM_PREFIX = 'Twilio account:'

const TWILIO_GEO_PERMISSIONS_HINT =
  'Enable SMS for that country in the Twilio Console: Messaging > Settings > Geo permissions (twilio.com/console/sms/settings/geo-permissions).'

/**
 * Mask the last 4 digits of a phone number for log/hint text | mirrors what
 * Twilio itself does in its error messages.
 */
function maskNumber(to: string): string {
  return to.length > 4 ? `${to.slice(0, -4)}XXXX` : to
}

// Loose E.164 shape: a plus, a non-zero first digit, 7-15 digits total.
// This is deliberately NOT a full libphonenumber validity check: Twilio is the
// authority on what it can deliver to, and a metadata-lag false negative here
// would silently drop a real customer. The shape check only stops values that
// cannot possibly be a number (empty, "N/A", an unresolved {{template}}, a
// national number typed without country code) from costing an API call.
const E164_SHAPE = /^\+[1-9]\d{6,14}$/

/**
 * Map a Twilio Messages API error body to a permanent-rejection class, or
 * null when the failure is not about the destination (auth, 5xx, quota,
 * malformed From, ...) and should keep failing the run.
 */
export function classifyTwilioRejection(
  status: number,
  body: string,
  to: string,
): SmsUndeliverableError | null {
  let code: number | null = null
  let message = ''
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown }
    if (typeof parsed.code === 'number') code = parsed.code
    if (typeof parsed.message === 'string') message = parsed.message
  } catch {
    return null
  }
  if (code == null) return null

  const masked = maskNumber(to)
  const base = { to, twilioCode: code }

  switch (code) {
    case 21211: // Invalid 'To' Phone Number
    case 21217: // Phone number does not appear to be valid
      return new SmsUndeliverableError({
        ...base,
        kind: 'invalid_number',
        message: `SMS not sent: ${masked} is not a valid phone number (Twilio ${code}).`,
        hint: 'Fix the contact phone number (E.164, e.g. +14155552671) or remove it.',
      })
    case 21408: // Permission to send an SMS has not been enabled for the region
      return new SmsUndeliverableError({
        ...base,
        kind: 'region_not_enabled',
        message: `SMS not sent: this Twilio account cannot send SMS to the country of ${masked} (Twilio 21408).`,
        hint: TWILIO_GEO_PERMISSIONS_HINT,
        accountConfig: true,
      })
    case 21610: // Message cannot be sent to the 'To' number because the customer has replied with STOP
      return new SmsUndeliverableError({
        ...base,
        kind: 'opted_out',
        message: `SMS not sent: ${masked} opted out (replied STOP) (Twilio 21610).`,
        hint: 'The recipient must text START to the sending number to opt back in.',
      })
    case 21614: // 'To' number is not a valid mobile number
      return new SmsUndeliverableError({
        ...base,
        kind: 'not_mobile',
        message: `SMS not sent: ${masked} is not a mobile number (Twilio 21614).`,
        hint: 'Landlines cannot receive SMS. Use a mobile number or another channel.',
      })
    case 21612: // The 'To' phone number is not currently reachable via SMS
    case 21214: // 'To' phone number cannot be reached for the message
      return new SmsUndeliverableError({
        ...base,
        kind: 'unreachable',
        message: `SMS not sent: ${masked} is not reachable from this Twilio number (Twilio ${code}${message ? `: ${message}` : ''}).`,
        hint: 'Twilio has no SMS route from the From number to this destination. Try a different From number.',
      })
    default:
      return null
  }
}

export async function resolveTwilioCredentials(
  ctx: ActionContext,
  options: ResolveTwilioCredentialsOptions = {},
): Promise<TwilioCredentials> {
  const { data: row, error } = await ctx.supabase
    .from('integrations')
    .select('id, encrypted_api_key, health_status, last_error')
    .eq('organization_id', ctx.organizationId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .single()

  if (error || !row) {
    throw new Error('Twilio not connected for this org. Add a Twilio integration in /integrations.')
  }

  const blob = JSON.parse(await decrypt(row.encrypted_api_key)) as {
    account_sid: string
    auth_token: string
  }

  // Resolve the From number: specific id > org default. There is no legacy
  // fallback — phone numbers must live in `twilio_phone_numbers`.
  let fromNumber: string | null = null

  if (options.fromNumberId) {
    const { data: numberRow } = await ctx.supabase
      .from('twilio_phone_numbers')
      .select('e164, is_active, capability_sms')
      .eq('id', options.fromNumberId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle()
    if (!numberRow) {
      throw new Error(`Twilio phone number ${options.fromNumberId} not found for this org.`)
    }
    if (!numberRow.is_active) {
      throw new Error(`Twilio phone number ${numberRow.e164} is inactive.`)
    }
    if (!numberRow.capability_sms) {
      throw new Error(`Twilio phone number ${numberRow.e164} does not have SMS capability enabled.`)
    }
    fromNumber = numberRow.e164
  } else {
    const { data: defaultRow } = await ctx.supabase
      .from('twilio_phone_numbers')
      .select('e164, capability_sms')
      .eq('organization_id', ctx.organizationId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle()
    if (defaultRow) {
      if (!defaultRow.capability_sms) {
        throw new Error(`Default Twilio number ${defaultRow.e164} does not have SMS capability enabled.`)
      }
      fromNumber = defaultRow.e164
    }
  }

  if (!fromNumber) {
    throw new Error(
      'No default Twilio phone number configured. Add one in Calls > Phone Numbers.',
    )
  }

  return {
    accountSid: blob.account_sid,
    authToken: blob.auth_token,
    fromNumber,
    integrationId: row.id,
    healthStatus: (row as { health_status?: string | null }).health_status ?? null,
    lastError: (row as { last_error?: string | null }).last_error ?? null,
  }
}

/**
 * Record an account-level Twilio problem (geo permissions off, ...) on the
 * org's Twilio integration as `degraded`, so it shows up in /integrations and
 * the dashboard integrations widget where the org can actually act on it.
 * `degraded` keeps the integration usable | other destinations still work.
 * Best-effort: never throws.
 */
export async function noteTwilioAccountProblem(
  ctx: Pick<ActionContext, 'organizationId' | 'supabase'>,
  err: SmsUndeliverableError,
): Promise<void> {
  try {
    await ctx.supabase
      .from('integrations')
      .update({
        health_status: 'degraded',
        last_error: `${TWILIO_ACCOUNT_PROBLEM_PREFIX} ${err.message} ${err.hint}`.slice(0, 500),
        last_checked_at: new Date().toISOString(),
      })
      .eq('organization_id', ctx.organizationId)
      .eq('provider', 'twilio')
      .eq('is_active', true)
  } catch {
    // best-effort
  }
}

/**
 * Inverse of noteTwilioAccountProblem: a successful send proves the account
 * works again, so clear a `degraded` mark WE put there (never one another
 * check owns). Best-effort: never throws.
 */
async function clearTwilioAccountProblem(
  ctx: Pick<ActionContext, 'supabase'>,
  creds: TwilioCredentials,
): Promise<void> {
  if (creds.healthStatus !== 'degraded') return
  if (!creds.lastError?.startsWith(TWILIO_ACCOUNT_PROBLEM_PREFIX)) return
  try {
    await ctx.supabase
      .from('integrations')
      .update({ health_status: 'connected', last_error: null, last_checked_at: new Date().toISOString() })
      .eq('id', creds.integrationId)
  } catch {
    // best-effort
  }
}

export async function sendSms(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  // Workflow spec exposes `phone_number_id` (snake_case to match other params).
  // Older internal call sites used `fromNumberId` — keep both for backward compat.
  const phoneNumberIdParam =
    typeof params.phone_number_id === 'string' && params.phone_number_id.length > 0
      ? params.phone_number_id
      : typeof params.fromNumberId === 'string' && params.fromNumberId.length > 0
        ? params.fromNumberId
        : undefined

  const to = String(params.to ?? '').trim()
  const body = String(params.body ?? params.message ?? '')
  // MMS: optional public media URLs (e.g. Supabase chat-media public URLs).
  // Twilio accepts up to 10 repeated `MediaUrl` parameters per message and the
  // URLs must be publicly reachable so Twilio can fetch them.
  const mediaUrls = Array.isArray(params.media_urls)
    ? (params.media_urls as unknown[]).filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      )
    : []

  if (!to) throw new Error('send_sms requires a "to" phone number parameter.')
  if (!body && mediaUrls.length === 0) {
    throw new Error('send_sms requires a "body" message or at least one media URL.')
  }

  // Reject before the API call what can never be a phone number. Kept loose on
  // purpose | see E164_SHAPE.
  if (!E164_SHAPE.test(to)) {
    throw new SmsUndeliverableError({
      kind: 'invalid_number',
      to,
      message: `SMS not sent: "${to.slice(0, 32)}" is not an E.164 phone number.`,
      hint: 'Phone numbers must look like +14155552671 (country code, digits only).',
    })
  }

  const creds = await resolveTwilioCredentials(ctx, { fromNumberId: phoneNumberIdParam })

  const basicAuth = btoa(`${creds.accountSid}:${creds.authToken}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`

  const form = new URLSearchParams({ To: to, From: creds.fromNumber })
  if (body) form.set('Body', body)
  for (const mediaUrl of mediaUrls) form.append('MediaUrl', mediaUrl)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    const permanent = classifyTwilioRejection(res.status, text, to)
    if (permanent) throw permanent
    throw new Error(`Twilio error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { sid: string }
  void clearTwilioAccountProblem(ctx, creds)
  // Single-line result | no newlines (Vapi parser breaks on \n)
  return `SMS sent. SID: ${data.sid}`
}
