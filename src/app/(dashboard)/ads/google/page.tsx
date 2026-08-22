import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ConnectionHealthBanner } from '../_components/connection-health-banner'
import { GoogleAdsConnect } from '../_components/google-ads-connect'
import { GoogleAdsOverview } from '../_components/google-ads-overview'
import { NoAccountsSelected } from '../_components/no-accounts-selected'

export default async function GoogleAdsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('ads_connections')
    .select('id, ad_account_id, ad_account_name, status, connection_error, token_expires_at, created_at')
    .eq('platform', 'google')
    .order('created_at', { ascending: true })

  const all = rows ?? []
  if (all.length === 0) {
    return <GoogleAdsConnect />
  }

  const healthBanner = (
    <ConnectionHealthBanner
      platform="google"
      connections={all}
      connectHref="/api/ads/google/connect"
    />
  )

  const connections = all.filter((c) => c.status === 'active')
  if (connections.length === 0) {
    return (
      <div className="space-y-4">
        {healthBanner}
        <NoAccountsSelected platform="google" />
      </div>
    )
  }

  const primary = connections[0]
  return (
    <div className="space-y-4">
      {healthBanner}
      <GoogleAdsOverview
        customerId={primary.ad_account_id}
        customerName={primary.ad_account_name ?? primary.ad_account_id}
        connections={connections.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
      />
    </div>
  )
}
