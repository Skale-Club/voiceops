import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { NewCampaignWizard } from '../_components/new-campaign-wizard'
import { createClient } from '@/lib/supabase/server'
import { getCampaignProviderAvailability } from '../provider-availability'

async function getSetupData() {
  const supabase = await createClient()
  const [assistantsRes, availability] = await Promise.all([
    supabase
      .from('assistant_mappings')
      .select('vapi_assistant_id, name')
      .eq('is_active', true)
      .order('name'),
    getCampaignProviderAvailability(),
  ])

  const assistants = (assistantsRes.data ?? []).map((a) => ({
    id: a.vapi_assistant_id,
    name: a.name ?? a.vapi_assistant_id,
  }))

  return {
    assistants,
    hasTwilio: availability.hasTwilio,
    hasVapi: availability.hasVapi,
    hasResend: availability.hasResend,
    hasWhatsApp: availability.hasWhatsApp,
  }
}

export default async function NewCampaignPage() {
  const { assistants, hasTwilio, hasVapi, hasResend, hasWhatsApp } = await getSetupData()

  return (
    <PageContainer>
      <PageHeader back={{ href: '/campaigns', label: 'Back to campaigns' }} />
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">New campaign</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Set up a multi-channel outreach campaign for your contacts.
          </p>
        </div>
        <NewCampaignWizard
          assistants={assistants}
          hasTwilio={hasTwilio}
          hasVapi={hasVapi}
          hasResend={hasResend}
          hasWhatsApp={hasWhatsApp}
        />
      </div>
    </PageContainer>
  )
}
