import { getCampaigns } from '@/app/(dashboard)/outbound/actions'
import { CampaignList } from '@/components/campaigns/campaign-list'

export default async function OutboundPage() {
  const campaigns = await getCampaigns()
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage outbound calling campaigns</p>
      </div>
      <CampaignList campaigns={campaigns} />
    </div>
  )
}
