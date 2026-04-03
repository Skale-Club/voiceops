import { CampaignForm } from '@/components/campaigns/campaign-form'

export default function NewCampaignPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Campaign</h1>
        <p className="text-muted-foreground text-sm mt-1">Create an outbound calling campaign</p>
      </div>
      <CampaignForm />
    </div>
  )
}
