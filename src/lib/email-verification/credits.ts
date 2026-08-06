// Credit-balance checks for the verification providers. Separate from the
// per-email verify calls in providers.ts — this hits each provider's
// lightweight balance endpoint, used by the email_verification_status MCP
// tool (Hermes polls this for its low-credit alert cron) and anywhere else
// that wants a cheap "can we still verify?" signal without spending a check.
//
// Never throws: every function here degrades to a typed { ok:false } shape on
// any network/parse/auth failure so a status poll can't crash a caller.

const FETCH_TIMEOUT_MS = 15_000
const DEFAULT_LOW_CREDIT_THRESHOLD = 500

const MILLIONVERIFIER_API_KEY = process.env.MILLIONVERIFIER_API_KEY || ''
const NEVERBOUNCE_API_KEY = process.env.NEVERBOUNCE_API_KEY || ''

function lowCreditThreshold(): number {
  const raw = process.env.EMAIL_VERIFICATION_LOW_CREDIT_THRESHOLD
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LOW_CREDIT_THRESHOLD
}

export interface ProviderCreditStatus {
  configured: boolean
  /** null when not configured or the balance could not be determined. */
  credits: number | null
  /** true when configured AND credits > 0 (a zero/negative balance is NOT ok). */
  ok: boolean
  error?: string
}

/** GET https://api.millionverifier.com/api/v3/credits?api=<KEY> */
export async function getMillionVerifierCredits(): Promise<ProviderCreditStatus> {
  if (!MILLIONVERIFIER_API_KEY) {
    return { configured: false, credits: null, ok: false }
  }
  try {
    const url = new URL('https://api.millionverifier.com/api/v3/credits')
    url.searchParams.set('api', MILLIONVERIFIER_API_KEY)
    const res = await fetch(url.toString(), { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) {
      return { configured: true, credits: null, ok: false, error: `MillionVerifier credits endpoint returned HTTP ${res.status}` }
    }
    const data = (await res.json().catch(() => ({}))) as { credits?: number; error?: string }
    if (typeof data.credits !== 'number') {
      return { configured: true, credits: null, ok: false, error: data.error || 'MillionVerifier credits response missing `credits`.' }
    }
    return { configured: true, credits: data.credits, ok: data.credits > 0 }
  } catch (err) {
    return { configured: true, credits: null, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** GET https://api.neverbounce.com/v4/account/info?key=<KEY> */
export async function getNeverBounceCredits(): Promise<ProviderCreditStatus> {
  if (!NEVERBOUNCE_API_KEY) {
    return { configured: false, credits: null, ok: false }
  }
  try {
    const url = new URL('https://api.neverbounce.com/v4/account/info')
    url.searchParams.set('key', NEVERBOUNCE_API_KEY)
    const res = await fetch(url.toString(), { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) {
      return { configured: true, credits: null, ok: false, error: `NeverBounce account/info returned HTTP ${res.status}` }
    }
    const data = (await res.json().catch(() => ({}))) as {
      status?: string
      message?: string
      credits?: { paid_credits_remaining?: number; free_credits_remaining?: number }
    }
    if (data.status !== 'success') {
      return { configured: true, credits: null, ok: false, error: data.message || data.status || 'NeverBounce account/info call failed.' }
    }
    const paid = data.credits?.paid_credits_remaining ?? 0
    const free = data.credits?.free_credits_remaining ?? 0
    const credits = paid + free
    return { configured: true, credits, ok: credits > 0 }
  } catch (err) {
    return { configured: true, credits: null, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface VerificationCreditStatus {
  millionverifier: ProviderCreditStatus
  neverbounce: ProviderCreditStatus
  /** True when at least one provider is configured and has a positive balance. */
  anyAvailable: boolean
  /** True when every configured provider's balance is at/under the low-credit threshold. */
  lowCredit: boolean
  lowCreditThreshold: number
}

/** Combined credit status across both providers. Never throws. */
export async function getVerificationCreditStatus(): Promise<VerificationCreditStatus> {
  const [millionverifier, neverbounce] = await Promise.all([getMillionVerifierCredits(), getNeverBounceCredits()])
  const threshold = lowCreditThreshold()

  const configuredProviders = [millionverifier, neverbounce].filter((p) => p.configured)
  const anyAvailable = configuredProviders.some((p) => p.ok)
  const lowCredit =
    configuredProviders.length > 0 &&
    configuredProviders.every((p) => p.credits == null || p.credits <= threshold)

  return { millionverifier, neverbounce, anyAvailable, lowCredit, lowCreditThreshold: threshold }
}
