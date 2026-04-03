import { CampaignForm } from '@/components/campaigns/campaign-form'

export default function NewCampaignPage() {
  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">New Campaign</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Create an outbound calling campaign.</p>
      </div>
      <CampaignForm />
    </div>
  )
}
