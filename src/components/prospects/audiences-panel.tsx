import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Target } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ProspectMetaAudienceSummary } from '@/app/(dashboard)/prospects/actions'

function formatDate(value: string | null) {
  if (!value) return 'Never synced'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function AudiencesPanel({ summary }: { summary: ProspectMetaAudienceSummary | null }) {
  return (
    <section className="rounded-[12px] border border-border bg-bg-secondary p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-blue-600 text-white">
          <Target className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">Meta Custom Audiences</h2>
            <Badge variant={summary?.enabled ? 'default' : 'secondary'}>
              {summary?.enabled ? `${summary.enabled} enabled` : 'Not enabled'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-tertiary">
            {summary?.configured
              ? `${summary.configured} configured · ${formatDate(summary.lastSuccessfulSync)}`
              : 'Create a safe, tenant-owned audience from Xcraper prospects.'}
          </p>
          {summary?.errorCount ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{summary.errorCount} audience needs attention</p>
          ) : summary?.enabled ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Hourly recovery reconciliation active</p>
          ) : null}
        </div>
        <Button asChild variant="secondary" className="shrink-0">
          <Link href="/settings/integrations/meta-audience">Configure <ArrowRight className="h-4 w-4" /></Link>
        </Button>
      </div>
    </section>
  )
}
