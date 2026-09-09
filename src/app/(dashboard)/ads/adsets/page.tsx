import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MetaAdsAdSets } from '../_components/meta-ads-adsets'

export default async function AdsAdSetsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: connections } = await supabase
    .from('ads_connections')
    .select('ad_account_id, ad_account_name')
    .eq('platform', 'meta')
    .eq('usable', true)
    .order('created_at', { ascending: true })

  if (!connections?.length) redirect('/ads')

  const primary = connections[0]
  return (
    <MetaAdsAdSets
      adAccountId={primary.ad_account_id}
      adAccountName={primary.ad_account_name ?? primary.ad_account_id}
      connections={connections.map((c) => ({ id: c.ad_account_id, name: c.ad_account_name ?? c.ad_account_id }))}
    />
  )
}
