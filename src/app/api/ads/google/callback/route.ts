import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/crypto'
import {
  GOOGLE_ADS_OAUTH_STATE_COOKIE,
  exchangeCodeForTokens,
  listAccessibleCustomers,
  getCustomerInfo,
} from '@/lib/ads/google-oauth'
import { serializeTokens } from '@/lib/ads/google-api'
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

// Build redirects from the canonical public origin (request.url resolves to the
// internal container 0.0.0.0:3000 behind the Coolify proxy) and clear the
// state cookie on the response.
function redirect(request: NextRequest, path: string) {
  const res = NextResponse.redirect(new URL(path, resolveRequestOrigin(request)))
  res.cookies.set(GOOGLE_ADS_OAUTH_STATE_COOKIE, '', COOKIE_CLEAR)
  return res
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return redirect(request, '/')

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const storedState = jar.get(GOOGLE_ADS_OAUTH_STATE_COOKIE)?.value

  if (!code) return redirect(request, '/ads/google?error=missing_code')
  if (!state || !storedState || state !== storedState) return redirect(request, '/ads/google?error=csrf')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return redirect(request, '/ads/google?error=no_org')

  try {
    const tokens = await exchangeCodeForTokens(code)
    const customerIds = await listAccessibleCustomers(tokens.access_token)

    if (!customerIds.length) return redirect(request, '/ads/google?error=no_ad_accounts')

    // Fetch info for all customers (cap at 10 to avoid slow callbacks)
    const customers = await Promise.all(
      customerIds.slice(0, 10).map((id) => getCustomerInfo(id, tokens.access_token).catch(() => null)),
    )

    const encryptedTokens = await encrypt(serializeTokens(tokens))
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Preserve the chosen status of accounts already linked; new ones arrive as
    // 'available' so the admin opts them in (instead of showing every account).
    const { data: existing } = await supabase
      .from('ads_connections')
      .select('ad_account_id, status')
      .eq('platform', 'google')
    const existingStatus = new Map((existing ?? []).map((r) => [r.ad_account_id, r.status]))

    const rows = customers
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({
        org_id: orgId as string,
        platform: 'google' as const,
        ad_account_id: c.id,
        ad_account_name: c.name,
        encrypted_access_token: encryptedTokens,
        token_expires_at: expiresAt,
        status: existingStatus.get(c.id) ?? 'available',
        // We just listed this customer with the token above
        // (listAccessibleCustomers/getCustomerInfo succeeded), so this is a
        // real verification, not an assumption — write health independently
        // of the preserved status selection above so a row that was stuck on
        // an old health value gets un-stuck on every successful reconnect.
        health: 'ok' as const,
        connection_error: null,
        last_error_at: null,
        last_verified_at: new Date().toISOString(),
        meta_app_scoped_user_id: null,
      }))

    if (!rows.length) return redirect(request, '/ads/google?error=no_ad_accounts')

    const { error } = await supabase
      .from('ads_connections')
      .upsert(rows, { onConflict: 'org_id,platform,ad_account_id' })

    if (error) throw new Error(error.message)

    return redirect(request, '/ads/google?connected=true')
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('refresh_token')) return redirect(request, '/ads/google?error=no_refresh_token')
    // Surface the real Google error so it can be diagnosed (admin-only screen).
    return redirect(request, `/ads/google?error=oauth_exchange&detail=${encodeURIComponent(msg.slice(0, 300))}`)
  }
}
