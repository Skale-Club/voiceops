import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GoogleAdsCampaigns } from '../../_components/google-ads-campaigns'

export default async function GoogleAdsCampaignsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: connections } = await supabase
    .from('ads_connections')
    .select('ad_account_id, ad_account_name')
    .eq('platform', 'google')
    .eq('usable', true)
    .order('created_at', { ascending: true })

  if (!connections?.length) redirect('/ads/google')

  const primary = connections[0]
  return (
    <GoogleAdsCampaigns
      customerId={primary.ad_account_id}
      customerName={primary.ad_account_name ?? primary.ad_account_id}
      connections={connections.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
    />
  )
}
