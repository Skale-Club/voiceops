import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ConnectionHealthBanner } from './_components/connection-health-banner'
import { MetaAdsConnect } from './_components/meta-ads-connect'
import { MetaAdsOverview } from './_components/meta-ads-overview'
import { NoAccountsSelected } from './_components/no-accounts-selected'

export default async function AdsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  // All connected accounts. `status` is selection only (active = shown,
  // available = connected-but-hidden); `health` is whether the credential
  // still works (ok/error), independent of selection — see
  // docs/integrations/ads-connection-health-plan.md.
  const { data: rows } = await supabase
    .from('ads_connections')
    .select(
      'id, ad_account_id, ad_account_name, status, health, usable, ad_objective, connection_error, token_expires_at, created_at',
    )
    .eq('platform', 'meta')
    .order('created_at', { ascending: true })

  const all = rows ?? []
  if (all.length === 0) {
    return <MetaAdsConnect />
  }

  // Rendered above whatever comes next: an unhealthy or unselected credential
  // leaves the account out of the `usable` set below, so without this the
  // page would silently fall back to the empty state and give no hint that a
  // reconnect is needed.
  const healthBanner = (
    <ConnectionHealthBanner
      platform="meta"
      connections={all}
      connectHref="/api/ads/meta/connect"
    />
  )

  const connections = all.filter((c) => c.usable)

  // Connected, but the admin hasn't picked which accounts to show yet.
  if (connections.length === 0) {
    return (
      <div className="space-y-4">
        {healthBanner}
        <NoAccountsSelected platform="meta" />
      </div>
    )
  }

  const primaryAccount = connections[0]

  return (
    <div className="space-y-4">
      {healthBanner}
      <MetaAdsOverview
        adAccountId={primaryAccount.ad_account_id}
        adAccountName={primaryAccount.ad_account_name ?? primaryAccount.ad_account_id}
        connections={connections.map((c) => ({
          id: c.ad_account_id,
          name: c.ad_account_name ?? c.ad_account_id,
          objective: (c.ad_objective ?? 'leads') as 'leads' | 'sales',
        }))}
      />
    </div>
  )
}
