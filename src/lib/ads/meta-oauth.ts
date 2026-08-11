// Verified 2026-08-10 against Meta's official Business SDK v26.0.0, released
// 2026-08-06. This single constant drives OAuth, Ads, CAPI, and Custom Audience
// requests. Re-check Meta's version/deprecation schedule before future rollout.
export const META_ADS_GRAPH_VERSION = 'v26.0'
export const META_ADS_CALLBACK_PATH = '/api/ads/meta/callback'
export const META_ADS_CALLBACK_URI = `https://xphere.app${META_ADS_CALLBACK_PATH}`
export const META_ADS_OAUTH_STATE_COOKIE = 'meta_ads_oauth_state'
export const META_ADS_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

export const META_ADS_OAUTH_SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
] as const

type MetaErrorPayload = {
  error?: { message?: string; type?: string; code?: number }
}

type MetaTokenResponse = {
  access_token: string
  token_type?: string
  expires_in?: number
}

export type MetaAdAccount = {
  id: string
  name: string
  currency: string
  account_status: number
}

function getMetaEnv() {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) throw new Error('META_APP_ID and META_APP_SECRET must be configured.')
  return { appId, appSecret }
}

async function readMetaError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as MetaErrorPayload
    return body.error?.message || `Meta request failed with status ${response.status}`
  } catch {
    return `Meta request failed with status ${response.status}`
  }
}

async function fetchMetaJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    const msg = await readMetaError(response)
    throw new Error(msg)
  }
  return response.json() as Promise<T>
}

export function buildMetaAdsAuthUrl(state: string): string {
  const { appId } = getMetaEnv()
  const url = new URL(`https://www.facebook.com/${META_ADS_GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', META_ADS_CALLBACK_URI)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', META_ADS_OAUTH_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

export async function exchangeCodeForShortLivedToken(code: string): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getMetaEnv()
  const url = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('redirect_uri', META_ADS_CALLBACK_URI)
  url.searchParams.set('code', code)
  return fetchMetaJson<MetaTokenResponse>(url)
}

export async function exchangeShortLivedTokenForLongLivedToken(shortToken: string): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getMetaEnv()
  const url = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('fb_exchange_token', shortToken)
  return fetchMetaJson<MetaTokenResponse>(url)
}

export async function fetchMetaAdsAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const url = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/me/adaccounts`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('fields', 'id,name,currency,account_status')
  url.searchParams.set('limit', '50')
  const res = await fetchMetaJson<{ data?: MetaAdAccount[] }>(url)
  return res.data ?? []
}

export async function fetchMetaUserScopedId(accessToken: string): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/me`)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('fields', 'id')
  try {
    const res = await fetchMetaJson<{ id?: string }>(url)
    return res.id ?? null
  } catch {
    return null
  }
}
