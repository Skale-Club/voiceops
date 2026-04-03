import { notFound } from 'next/navigation'
import { getCampaignDetail } from '@/app/(dashboard)/outbound/actions'
import { ContactStatusBoard } from '@/components/campaigns/contact-status-board'
import { CsvImportForm } from '@/components/campaigns/csv-import-form'
import { format } from 'date-fns'
import type { CampaignStatus } from '@/types/database'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params
  let detail
  try {
    detail = await getCampaignDetail(id)
  } catch {
    notFound()
  }

  const { campaign, contacts } = detail

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {campaign.calls_per_minute} calls/min
            {campaign.scheduled_start_at && ` · Scheduled ${format(new Date(campaign.scheduled_start_at), 'MMM d, yyyy HH:mm')}`}
          </p>
        </div>
      </div>

      <ContactStatusBoard
        campaignId={campaign.id}
        initialContacts={contacts}
        campaignStatus={campaign.status as CampaignStatus}
      />

      {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Import Contacts</h2>
          <CsvImportForm campaignId={campaign.id} />
        </div>
      )}
    </div>
  )
}
