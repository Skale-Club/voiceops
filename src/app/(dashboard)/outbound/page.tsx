import { getCampaigns } from '@/app/(dashboard)/outbound/actions'
import { CampaignList } from '@/components/campaigns/campaign-list'

export default async function OutboundPage() {
  const campaigns = await getCampaigns()
  return (
    <div className="p-6">
      <CampaignList campaigns={campaigns}>
        <h1 className="text-lg font-semibold">Campaigns</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage outbound calling campaigns.</p>
      </CampaignList>
    </div>
  )
}
