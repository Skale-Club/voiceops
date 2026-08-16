import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { CampaignsSubNav } from '@/components/campaigns/campaigns-sub-nav'
import { getCampaignProviderAvailability } from './provider-availability'

export default async function CampaignsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  const availability = await getCampaignProviderAvailability()

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:campaigns"
      title="Campaigns"
      nav={
        <CampaignsSubNav
          hasTwilio={availability.hasTwilio}
          hasVapi={availability.hasVapi}
          hasResend={availability.hasResend}
          hasWhatsApp={availability.hasWhatsApp}
        />
      }
    >
      {children}
    </SubSidebarLayout>
  )
}
