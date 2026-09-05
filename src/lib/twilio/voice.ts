// src/lib/twilio/voice.ts
// Twilio Voice client wrapper (SEED-007).
//
// Resolves org-level Twilio credentials (same pattern as send-sms.ts) and exposes
// helpers used by the voice webhook + outbound-call endpoint:
//   * resolveTwilioCredentialsForOrg(orgId) | service-role lookup keyed by org
//   * createOutboundCall(creds, params)     | REST API call creation
//   * twilioBasicAuthHeader(creds)          | for recording downloads
//
// Twilio Access Tokens (Voice SDK) are generated in `src/lib/twilio/access-token.ts`
// so they can be Edge-runtime-safe (Web Crypto / HMAC).

import * as Sentry from '@sentry/nextjs'
import { decrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export interface TwilioVoiceCredentials {
  accountSid: string
  authToken: string
  fromNumber: string
  apiKeySid?: string
  apiKeySecret?: string
  twimlAppSid?: string
}

/**
 * Look up a Twilio integration by organization_id using the service-role client.
 * Bypasses RLS | only call this from trusted server-only code (webhooks, signed
 * server actions). Mirrors the credential shape from send-sms.ts.
 *
 * Number resolution:
 *   - If `options.phoneNumberId` is passed, that specific row from
 *     `twilio_phone_numbers` is used for `fromNumber`.
 *   - Otherwise, the org's default `twilio_phone_numbers` row is used.
 *   - If neither yields a number, `fromNumber` is empty and the caller decides
 *     whether to treat that as an error (e.g. outbound calls cannot proceed).
 */
export async function resolveTwilioCredentialsForOrg(
  orgId: string,
  options?: { phoneNumberId?: string },
): Promise<TwilioVoiceCredentials | null> {
  const supabase = createServiceRoleClient()
  const { data: row, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, config')
    .eq('organization_id', orgId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error || !row) return null

  let blob: {
    account_sid?: string
    auth_token?: string
    api_key_sid?: string
    api_key_secret?: string
  }
  try {
    blob = JSON.parse(await decrypt(row.encrypted_api_key))
  } catch {
    return null
  }

  const config = (row.config ?? {}) as {
    twiml_app_sid?: string
  }

  if (!blob.account_sid || !blob.auth_token) return null

  // Resolve the From number: specific id > org default.
  let fromNumber: string = ''
  if (options?.phoneNumberId) {
    const { data: numberRow } = await supabase
      .from('twilio_phone_numbers')
      .select('e164, is_active')
      .eq('id', options.phoneNumberId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (numberRow?.is_active) fromNumber = numberRow.e164
  } else {
    const { data: defaultRow } = await supabase
      .from('twilio_phone_numbers')
      .select('e164')
      .eq('organization_id', orgId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle()
    if (defaultRow) fromNumber = defaultRow.e164
  }

  return {
    accountSid: blob.account_sid,
    authToken: blob.auth_token,
    fromNumber,
    apiKeySid: blob.api_key_sid,
    apiKeySecret: blob.api_key_secret,
    twimlAppSid: config.twiml_app_sid,
  }
}

/**
 * Look up the active Twilio integration matching the destination phone number.
 * Used by the inbound voice/SMS webhooks to resolve which org owns the called
 * number.
 *
 * Resolution is exclusively via `twilio_phone_numbers` — the org's source of
 * truth for every active Twilio phone resource.
 *
 * Multi-tenancy: the same e164 string can be registered by more than one org
 * (the table only enforces UNIQUE(organization_id, e164)), so a lookup by e164
 * alone is ambiguous and would route to whichever row the DB returns first.
 * A Twilio number physically belongs to exactly ONE Twilio account, and the
 * inbound webhook always carries that account's `AccountSid`, so we use it to
 * pick the org that actually owns the number. When several orgs claim the same
 * e164 and no AccountSid match is found we refuse to guess (return null) rather
 * than misroute the call/SMS to the wrong tenant.
 */
export async function resolveTwilioOrgByToNumber(
  toNumber: string,
  accountSid?: string | null,
): Promise<
  | {
      orgId: string
      phoneNumberId: string
      creds: TwilioVoiceCredentials
    }
  | null
> {
  const supabase = createServiceRoleClient()

  // Oldest registration first: when several organizations share one number
  // (the platform's notifications number is registered by three), the first
  // AccountSid match below wins, and without an explicit order that was heap
  // order — stable in practice, guaranteed by nothing. The original owner
  // keeps its inbound traffic no matter who registers the number later.
  const { data: candidates } = await supabase
    .from('twilio_phone_numbers')
    .select('id, organization_id, e164')
    .eq('e164', toNumber)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (!candidates || candidates.length === 0) return null

  // Single owner → unambiguous. Route to it directly (the AccountSid may differ
  // when the number lives in a Twilio subaccount, so we don't reject here).
  if (candidates.length === 1) {
    const only = candidates[0]
    const creds = await resolveTwilioCredentialsForOrg(only.organization_id)
    if (!creds || !creds.accountSid || !creds.authToken) return null
    return {
      orgId: only.organization_id,
      phoneNumberId: only.id,
      creds: { ...creds, fromNumber: only.e164 },
    }
  }

  // Multiple orgs registered the same e164 — disambiguate by AccountSid. Without
  // one we cannot tell tenants apart, so refuse rather than misroute.
  if (!accountSid) {
    console.warn(
      '[twilio] Ambiguous number across tenants and no AccountSid to disambiguate:',
      toNumber,
    )
    // e164 here is the ORG's own phone number (not caller PII), safe to log
    // in full — this alert is about a data-integrity gap (two orgs claiming
    // the same number) that silently drops inbound calls/SMS to that number.
    Sentry.captureMessage('twilio_ambiguous_number_no_account_sid', {
      level: 'warning',
      tags: { event: 'twilio_ambiguous_number_no_account_sid' },
      extra: { e164: toNumber, candidateCount: candidates.length },
    })
    return null
  }

  for (const candidate of candidates) {
    const creds = await resolveTwilioCredentialsForOrg(candidate.organization_id)
    if (!creds || !creds.accountSid || !creds.authToken) continue
    if (creds.accountSid !== accountSid) continue
    return {
      orgId: candidate.organization_id,
      phoneNumberId: candidate.id,
      creds: { ...creds, fromNumber: candidate.e164 },
    }
  }

  console.warn(
    '[twilio] No tenant matched AccountSid for ambiguous number:',
    toNumber,
  )
  Sentry.captureMessage('twilio_ambiguous_number_no_account_sid_match', {
    level: 'warning',
    tags: { event: 'twilio_ambiguous_number_no_account_sid_match' },
    extra: { e164: toNumber, candidateCount: candidates.length },
  })
  return null
}

export function twilioBasicAuthHeader(creds: TwilioVoiceCredentials): string {
  return `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`
}

export interface CreateOutboundCallParams {
  to: string
  from?: string
  /**
   * Absolute URL Twilio will fetch for TwiML when the callee picks up.
   * Twilio POSTs the same shape as an inbound voice webhook, so we point this at
   * /api/twilio/voice to reuse the routing logic for the originating user.
   */
  twimlUrl: string
  statusCallback?: string
  record?: boolean
}

/**
 * Wraps the Twilio REST API `Calls` endpoint. Uses HTTP basic-auth with the
 * account SID + auth token rather than the SDK to keep the bundle small and the
 * runtime Edge-compatible.
 */
export async function createOutboundCall(
  creds: TwilioVoiceCredentials,
  params: CreateOutboundCallParams,
): Promise<{ sid: string }> {
  const from = params.from ?? creds.fromNumber
  if (!from) throw new Error('createOutboundCall: missing From number')

  const form = new URLSearchParams({
    To: params.to,
    From: from,
    Url: params.twimlUrl,
    Method: 'POST',
  })
  if (params.statusCallback) {
    form.set('StatusCallback', params.statusCallback)
    form.set('StatusCallbackMethod', 'POST')
    // The REST Calls API requires each progress event as its OWN repeated
    // `StatusCallbackEvent` param. A single space-joined value
    // ("initiated ringing answered completed") is rejected as one invalid event
    // (Twilio error 21626), which silently drops the intermediate ringing/
    // answered callbacks the live-status UI depends on — only `completed` fires.
    // (TwiML <Dial statusCallbackEvent> accepts a space list; the REST API does not.)
    for (const event of ['initiated', 'ringing', 'answered', 'completed']) {
      form.append('StatusCallbackEvent', event)
    }
  }
  if (params.record) {
    form.set('Record', 'true')
    form.set('RecordingChannels', 'dual')
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuthHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Twilio outbound call error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as { sid: string }
  return { sid: data.sid }
}

/**
 * Replaces the TwiML of an in-flight call (POST Calls/{sid} Twiml=...). Twilio
 * cancels whatever the call is currently executing (e.g. a ringing <Dial>) and
 * runs the new document — this is how "Answer on this device" steals a ringing
 * chain call and points it at the answering user's Voice SDK client.
 *
 * Throws `CallNotInProgressError` when the call already ended (Twilio 21220 or
 * a 404) so callers can tell "too late" apart from real failures.
 */
export class CallNotInProgressError extends Error {
  constructor() {
    super('Call is no longer in progress')
    this.name = 'CallNotInProgressError'
  }
}

export async function redirectCall(
  creds: TwilioVoiceCredentials,
  callSid: string,
  twiml: string,
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls/${encodeURIComponent(callSid)}.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuthHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ Twiml: twiml }).toString(),
    cache: 'no-store',
  })

  if (res.ok) return
  const text = await res.text().catch(() => `status ${res.status}`)
  // 21220: "Unable to update record: Call is not in-progress" | 404: call gone.
  if (res.status === 404 || text.includes('21220')) throw new CallNotInProgressError()
  throw new Error(`Twilio redirect-call error ${res.status}: ${text}`)
}

/**
 * Ends an in-flight call via the Twilio REST API (POST Calls/{sid} Status=completed).
 * Used by the dialer "hang up" control for phone_forward / sip calls, where the
 * browser is not part of the call and can't disconnect locally.
 */
export async function endCall(
  creds: TwilioVoiceCredentials,
  callSid: string,
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls/${encodeURIComponent(callSid)}.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuthHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ Status: 'completed' }).toString(),
    cache: 'no-store',
  })

  // 404 = call already gone (completed/failed) — treat as success (idempotent).
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Twilio end-call error ${res.status}: ${text}`)
  }
}
