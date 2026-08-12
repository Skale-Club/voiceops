import { redirect } from 'next/navigation'
import { ShieldAlert, Users } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getMetaAudienceDashboard } from './actions'
import { MetaAudienceForm } from './meta-audience-form'

export default async function MetaAudiencePage() {
  const user = await getUser()
  if (!user) redirect('/')
  const result = await getMetaAudienceDashboard()

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Ads"
        eyebrowIcon={Users}
        title="Meta Custom Audiences"
        description="Preview and reconcile eligible Xcraper prospects with tenant-owned Meta audiences. Identifiers are normalized and hashed inside Xphere."
      />
      {!result.ok ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <ShieldAlert className="h-5 w-5" />
          {result.error}
        </div>
      ) : (
        <MetaAudienceForm data={result.data} />
      )}
    </PageContainer>
  )
}
