// Provider adapters for the email-verification chain (MillionVerifier primary,
// NeverBounce fallback — see src/lib/email-verification/verify.ts). Each
// adapter normalizes the provider's own vocabulary onto EmailStatus and NEVER
// throws — network/auth/credit/rate-limit failures degrade to a typed
// VerifyFailure so a send path can react instead of crashing.

import { riskForStatus } from './risk-policy'
import type { EmailStatus, VerifyOutcome } from './types'

const FETCH_TIMEOUT_MS = 15_000

const MILLIONVERIFIER_API_KEY = process.env.MILLIONVERIFIER_API_KEY || ''
const NEVERBOUNCE_API_KEY = process.env.NEVERBOUNCE_API_KEY || ''

export function isMillionVerifierConfigured(): boolean {
  return Boolean(MILLIONVERIFIER_API_KEY)
}

export function isNeverBounceConfigured(): boolean {
  return Boolean(NEVERBOUNCE_API_KEY)
}

/** Text-sniff a provider's free-form error/message field for a credit exhaustion signal. */
function looksLikeNoCredits(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('credit') || t.includes('insufficient') || t.includes('quota') || t.includes('balance')
}

function looksLikeUnauthorized(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('api key') || t.includes('apikey') || t.includes('unauthoriz') || t.includes('invalid key') || t.includes('auth')
}

function looksLikeRateLimited(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('rate limit') || t.includes('throttle') || t.includes('too many requests')
}

// ----- MillionVerifier ---------------------------------------------------------
// GET https://api.millionverifier.com/api/v3/?api=<KEY>&email=<EMAIL>&timeout=10
// -> { email, quality, result, resultcode, subresult, free, role, didyoumean, error }
// result in ok|catch_all|unknown|error|disposable|invalid

interface MillionVerifierResponse {
  email?: string
  quality?: string
  result?: string
  resultcode?: number
  subresult?: string
  free?: boolean
  role?: boolean
  didyoumean?: string
  error?: string
}

function normalizeMillionVerifierResult(result: string): EmailStatus {
  switch (result) {
    case 'ok':
      return 'ok'
    case 'catch_all':
      return 'catch_all'
    case 'disposable':
      return 'disposable'
    case 'invalid':
      return 'invalid'
    case 'unknown':
    case 'error':
    default:
      return 'unknown'
  }
}

export async function verifyWithMillionVerifier(email: string): Promise<VerifyOutcome> {
  if (!isMillionVerifierConfigured()) {
    return { error: 'unauthorized', detail: 'MILLIONVERIFIER_API_KEY is not set.' }
  }

  const url = new URL('https://api.millionverifier.com/api/v3/')
  url.searchParams.set('api', MILLIONVERIFIER_API_KEY)
  url.searchParams.set('email', email)
  url.searchParams.set('timeout', '10')

  let res: Response
  try {
    res = await fetch(url.toString(), { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  } catch (err) {
    return { error: 'unreachable', detail: err instanceof Error ? err.message : String(err) }
  }

  if (res.status === 401 || res.status === 403) {
    return { error: 'unauthorized', detail: `MillionVerifier returned HTTP ${res.status}` }
  }
  if (res.status === 429) {
    return { error: 'rate_limited', detail: 'MillionVerifier returned HTTP 429' }
  }
  if (!res.ok) {
    return { error: 'unreachable', detail: `MillionVerifier returned HTTP ${res.status}` }
  }

  let data: MillionVerifierResponse
  try {
    data = (await res.json()) as MillionVerifierResponse
  } catch (err) {
    return { error: 'unreachable', detail: `MillionVerifier returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}` }
  }

  const errorText = data.error ? String(data.error) : ''
  if (errorText) {
    if (looksLikeNoCredits(errorText)) return { error: 'no_credits', detail: errorText }
    if (looksLikeUnauthorized(errorText)) return { error: 'unauthorized', detail: errorText }
    if (looksLikeRateLimited(errorText)) return { error: 'rate_limited', detail: errorText }
    // Any other provider-side error (e.g. syntax_error) — fall through and
    // normalize via `result`, which MillionVerifier sets to 'error' in this case.
  }

  if (!data.result) {
    return { error: 'unreachable', detail: 'MillionVerifier response missing `result`.' }
  }

  const status = normalizeMillionVerifierResult(data.result)
  return { status, risk: riskForStatus(status), provider: 'millionverifier', raw: data }
}

// ----- NeverBounce ---------------------------------------------------------------
// GET https://api.neverbounce.com/v4.1/single/check?key=<KEY>&email=<EMAIL>&credits_info=1
// -> { status, result, credits_info, ... }; status='success' on a completed check,
// result in valid|invalid|disposable|catchall|unknown.

interface NeverBounceResponse {
  status?: string // 'success' | 'auth_failure' | 'temp_unavail' | 'throttle_triggered' | 'bad_referrer' | 'general_failure'
  result?: string // 'valid' | 'invalid' | 'disposable' | 'catchall' | 'unknown'
  message?: string
  credits_info?: { free_credits_used?: number; paid_credits_used?: number; credits_remaining?: number }
}

function normalizeNeverBounceResult(result: string): EmailStatus {
  switch (result) {
    case 'valid':
      return 'ok'
    case 'catchall':
      return 'catch_all'
    case 'disposable':
      return 'disposable'
    case 'invalid':
      return 'invalid'
    case 'unknown':
    default:
      return 'unknown'
  }
}

export async function verifyWithNeverBounce(email: string): Promise<VerifyOutcome> {
  if (!isNeverBounceConfigured()) {
    return { error: 'unauthorized', detail: 'NEVERBOUNCE_API_KEY is not set.' }
  }

  const url = new URL('https://api.neverbounce.com/v4.1/single/check')
  url.searchParams.set('key', NEVERBOUNCE_API_KEY)
  url.searchParams.set('email', email)
  url.searchParams.set('credits_info', '1')

  let res: Response
  try {
    res = await fetch(url.toString(), { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  } catch (err) {
    return { error: 'unreachable', detail: err instanceof Error ? err.message : String(err) }
  }

  if (res.status === 401 || res.status === 403) {
    return { error: 'unauthorized', detail: `NeverBounce returned HTTP ${res.status}` }
  }
  if (res.status === 429) {
    return { error: 'rate_limited', detail: 'NeverBounce returned HTTP 429' }
  }
  if (!res.ok) {
    return { error: 'unreachable', detail: `NeverBounce returned HTTP ${res.status}` }
  }

  let data: NeverBounceResponse
  try {
    data = (await res.json()) as NeverBounceResponse
  } catch (err) {
    return { error: 'unreachable', detail: `NeverBounce returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (data.status !== 'success') {
    const message = data.message || data.status || 'unknown NeverBounce error'
    if (data.status === 'auth_failure') return { error: 'unauthorized', detail: message }
    if (data.status === 'throttle_triggered') return { error: 'rate_limited', detail: message }
    if (looksLikeNoCredits(message)) return { error: 'no_credits', detail: message }
    return { error: 'unreachable', detail: message }
  }

  if (!data.result) {
    // status='success' with no `result` is not a documented NeverBounce shape —
    // the one case it plausibly occurs is an exhausted balance where the check
    // wasn't actually run. A zero/negative remaining balance confirms that
    // reading; otherwise treat it as an unreachable/unexpected response. Either
    // way we never fabricate a status for a check that didn't complete.
    const remaining = data.credits_info?.credits_remaining
    if (typeof remaining === 'number' && remaining <= 0) {
      return { error: 'no_credits', detail: 'NeverBounce credit balance is zero or negative.' }
    }
    return { error: 'unreachable', detail: 'NeverBounce response missing `result`.' }
  }

  const status = normalizeNeverBounceResult(data.result)
  return { status, risk: riskForStatus(status), provider: 'neverbounce', raw: data }
}
