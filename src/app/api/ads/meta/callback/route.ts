import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  META_ADS_OAUTH_STATE_COOKIE,
  exchangeCodeForShortLivedToken,
  exchangeShortLivedTokenForLongLivedToken,
  fetchMetaAdsAdAccounts,
  fetchMetaUserScopedId,
} from '@/lib/ads/meta-oauth'
import { resolveRequestOrigin } from '@/lib/site-url'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const COOKIE_CLEAR = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 0,
}

// Build redirects from the canonical public origin (not request.url, which
// resolves to the internal container address http://0.0.0.0:3000 behind the
// Coolify proxy), and clear the CSRF state cookie on the response.
function redirect(request: NextRequest, path: string) {
  const res = NextResponse.redirect(new URL(path, resolveRequestOrigin(request)))
  res.cookies.set(META_ADS_OAUTH_STATE_COOKIE, '', COOKIE_CLEAR)
  return res
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return redirect(request, '/')

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const storedState = jar.get(META_ADS_OAUTH_STATE_COOKIE)?.value

  if (!code) return redirect(request, '/ads?error=missing_code')

  if (!state || !storedState || state !== storedState) {
    return redirect(request, '/ads?error=csrf')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return redirect(request, '/ads?error=no_org')

  try {
    const shortToken = await exchangeCodeForShortLivedToken(code)
    const longToken = await exchangeShortLivedTokenForLongLivedToken(shortToken.access_token)
    const [adAccounts, userId] = await Promise.all([
      fetchMetaAdsAdAccounts(longToken.access_token),
      fetchMetaUserScopedId(longToken.access_token),
    ])

    if (adAccounts.length === 0) {
      return redirect(request, '/ads?error=no_ad_accounts')
    }

    const encryptedToken = await encrypt(longToken.access_token)
    const expiresAt = longToken.expires_in
      ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
      : null

    // Preserve the chosen status of accounts already linked to this org; new
    // accounts arrive as 'available' so the admin opts them in explicitly
    // (instead of every account showing up at once).
    const { data: existing } = await supabase
      .from('ads_connections')
      .select('ad_account_id, status')
      .eq('platform', 'meta')
    const existingStatus = new Map((existing ?? []).map((r) => [r.ad_account_id, r.status]))

    const rows = adAccounts.map((account) => ({
      org_id: orgId as string,
      platform: 'meta' as const,
      ad_account_id: account.id,
      ad_account_name: account.name,
      encrypted_access_token: encryptedToken,
      token_expires_at: expiresAt,
      status: existingStatus.get(account.id) ?? 'available',
      // We just listed this account with the token above (fetchMetaAdsAdAccounts
      // succeeded), so this is a real verification, not an assumption — write
      // health independently of the preserved status selection above so a row
      // that was stuck on an old health value gets un-stuck on every
      // successful reconnect.
      health: 'ok' as const,
      connection_error: null,
      last_error_at: null,
      last_verified_at: new Date().toISOString(),
      meta_app_scoped_user_id: userId,
    }))

    const { error } = await supabase
      .from('ads_connections')
      .upsert(rows, { onConflict: 'org_id,platform,ad_account_id' })

    if (error) throw new Error(error.message)

    return redirect(request, '/ads?connected=true')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ads/meta/callback:oauth-exchange-failed]', err instanceof Error ? err.message : err)
    return redirect(request, '/ads?error=oauth_exchange')
  }
}
