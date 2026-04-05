'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { Phone, Trash2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deleteCampaign } from '@/app/(dashboard)/outbound/actions'
import type { CampaignListItem } from '@/app/(dashboard)/outbound/actions'
import type { CampaignStatus } from '@/types/database'

interface CampaignStatusBadgeProps {
  status: CampaignStatus
}

function CampaignStatusBadge({ status }: CampaignStatusBadgeProps) {
  const styles: Record<CampaignStatus, string> = {
    in_progress: 'bg-emerald-500/15 text-emerald-400',
    paused:      'bg-yellow-500/15 text-yellow-400',
    stopped:     'bg-red-500/15 text-red-400',
    completed:   'bg-zinc-500/15 text-zinc-400',
    draft:       'bg-slate-500/15 text-slate-400',
    scheduled:   'bg-blue-500/15 text-blue-400',
  }
  return (
    <Badge variant="outline" className={styles[status]}>
      {status.replace('_', ' ')}
    </Badge>
  )
}

interface CampaignListProps {
  campaigns: CampaignListItem[]
  children?: React.ReactNode
}

export function CampaignList({ campaigns, children }: CampaignListProps) {
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(campaignId: string) {
    if (!window.confirm('Delete this campaign? This action cannot be undone.')) return
    setDeleting(campaignId)
    try {
      await deleteCampaign(campaignId)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div>{children}</div>
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
          </p>
          <Button asChild size="sm">
            <Link href="/outbound/new">
              <Plus className="h-4 w-4 mr-1" />
              New Campaign
            </Link>
          </Button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-lg border border-dashed">
          <Phone className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="text-xs text-muted-foreground mt-1">Create your first outbound calling campaign</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/outbound/new">New Campaign</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/outbound/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CampaignStatusBadge status={c.status as CampaignStatus} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.total_contacts}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-400">{c.completed_contacts}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-400">{c.failed_contacts}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.scheduled_start_at
                      ? format(new Date(c.scheduled_start_at), 'MMM d, HH:mm')
                      : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(c.created_at), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/outbound/${c.id}`}>View</Link>
                      </Button>
                      {['draft', 'completed', 'stopped'].includes(c.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={deleting === c.id}
                          onClick={() => handleDelete(c.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
