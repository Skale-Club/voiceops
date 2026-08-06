import { ShieldAlert, UserPlus } from 'lucide-react'

import {
  getProspects,
  type ProspectEmailFilter,
  type ProspectFilters,
  type ProspectKind,
  type ProspectSort,
} from './actions'
import { ProspectsTable } from '@/components/prospects/prospects-table'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { isXmailConfigured } from '@/lib/xmail/client'
import { isXpotConfigured } from '@/lib/xpot/client'
import type {
  CrmEngagementStatus,
  CrmIntentLevel,
  CrmQualificationStatus,
} from '@/types/database'

type SearchParams = {
  q?: string
  kind?: string
  engagement?: string
  intent?: string
  qualification?: string
  city?: string
  list?: string
  sort?: string
  page?: string
  emailStatus?: string
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams

  const EMAIL_FILTER_VALUES: ProspectEmailFilter[] = [
    'ok',
    'catch_all',
    'unknown',
    'disposable',
    'invalid',
    'bounced',
    'unverified',
  ]
  const emailStatus = (EMAIL_FILTER_VALUES as string[]).includes(sp.emailStatus ?? '')
    ? (sp.emailStatus as ProspectEmailFilter)
    : undefined

  const filters: ProspectFilters = {
    q: sp.q,
    kind: (sp.kind as 'all' | ProspectKind) || 'all',
    engagement: sp.engagement as CrmEngagementStatus | undefined,
    intent: sp.intent as CrmIntentLevel | undefined,
    qualification: sp.qualification as CrmQualificationStatus | undefined,
    city: sp.city,
    listId: sp.list,
    sort: (sp.sort as ProspectSort) || 'recent',
    page: sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1,
    pageSize: 25,
    emailStatus,
  }

  const result = await getProspects(filters)

  if (!result.ok) {
    return (
      <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
        <PageContainer size="narrow">
          <PageHeader
            eyebrow="Sales"
            eyebrowIcon={ShieldAlert}
            title="Prospects"
            description="This area is available to workspace admins only."
          />
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        </PageContainer>
      </EntityPageTemplate>
    )
  }

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Sales"
          eyebrowIcon={UserPlus}
          title="Prospects"
          description="Early-stage records stay here until an admin deliberately converts them into the normal CRM."
        />
        <ProspectsTable
          rows={result.rows}
          total={result.total}
          page={result.page}
          pageSize={result.pageSize}
          lists={result.lists}
          filters={filters}
          outreachEnabled={isXmailConfigured()}
          xpotEnabled={isXpotConfigured()}
        />
      </PageContainer>
    </EntityPageTemplate>
  )
}
