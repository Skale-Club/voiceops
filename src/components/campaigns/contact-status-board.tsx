'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
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
import type { Database, CampaignContactStatus, CampaignStatus } from '@/types/database'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

interface ContactStatusBoardProps {
  campaignId: string
  initialContacts: CampaignContactRow[]
  campaignStatus: CampaignStatus
}

function StatusBadge({ status }: { status: CampaignContactStatus }) {
  const styles: Record<CampaignContactStatus, string> = {
    pending:    'bg-zinc-500/15 text-zinc-400',
    calling:    'bg-blue-500/15 text-blue-400',
    completed:  'bg-emerald-500/15 text-emerald-400',
    failed:     'bg-red-500/15 text-red-400',
    no_answer:  'bg-yellow-500/15 text-yellow-400',
  }
  return (
    <Badge variant="outline" className={styles[status]}>
      {status.replace('_', ' ')}
    </Badge>
  )
}

export function ContactStatusBoard({ campaignId, initialContacts, campaignStatus }: ContactStatusBoardProps) {
  const [contacts, setContacts] = useState<CampaignContactRow[]>(initialContacts)
  const [isStarting, setIsStarting] = useState(false)
  const [isPausing, setIsPausing] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [controlError, setControlError] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState<CampaignStatus>(campaignStatus)

  // Supabase Realtime subscription for per-contact status updates
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`campaign-contacts-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'campaign_contacts',
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          const updated = payload.new as CampaignContactRow
          setContacts((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  // Progress metrics
  const total = contacts.length
  const completed = contacts.filter((c) => c.status === 'completed').length
  const failed = contacts.filter((c) => c.status === 'failed').length
  const noAnswer = contacts.filter((c) => c.status === 'no_answer').length
  const calling = contacts.filter((c) => c.status === 'calling').length
  const pending = contacts.filter((c) => c.status === 'pending').length
  const pct = total > 0 ? Math.round(((completed + failed + noAnswer) / total) * 100) : 0

  async function callControl(action: 'start' | 'pause' | 'stop') {
    const setter = action === 'start' ? setIsStarting : action === 'pause' ? setIsPausing : setIsStopping
    setter(true)
    setControlError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${action}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setControlError(data.error ?? 'Failed to update campaign')
      } else {
        const nextStatus: CampaignStatus =
          action === 'start' ? 'in_progress' : action === 'pause' ? 'paused' : 'stopped'
        setCurrentStatus(nextStatus)
      }
    } catch {
      setControlError('Network error')
    } finally {
      setter(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Progress metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total', value: total },
          { label: 'Calling', value: calling },
          { label: 'Completed', value: completed },
          { label: 'Failed', value: failed },
          { label: 'Progress', value: `${pct}%` },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold">{m.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Campaign controls */}
      <div className="flex items-center gap-3">
        {(currentStatus === 'draft' || currentStatus === 'scheduled' || currentStatus === 'paused') && (
          <Button onClick={() => callControl('start')} disabled={isStarting} size="sm">
            {isStarting ? 'Starting...' : currentStatus === 'paused' ? 'Resume' : 'Start Campaign'}
          </Button>
        )}
        {currentStatus === 'in_progress' && (
          <Button onClick={() => callControl('pause')} disabled={isPausing} variant="outline" size="sm">
            {isPausing ? 'Pausing...' : 'Pause'}
          </Button>
        )}
        {(currentStatus === 'in_progress' || currentStatus === 'paused') && (
          <Button onClick={() => callControl('stop')} disabled={isStopping} variant="destructive" size="sm">
            {isStopping ? 'Stopping...' : 'Stop Campaign'}
          </Button>
        )}
        <Badge variant="outline" className={
          currentStatus === 'in_progress' ? 'bg-emerald-500/15 text-emerald-400' :
          currentStatus === 'paused' ? 'bg-yellow-500/15 text-yellow-400' :
          currentStatus === 'stopped' ? 'bg-red-500/15 text-red-400' :
          currentStatus === 'completed' ? 'bg-zinc-500/15 text-zinc-400' :
          'bg-slate-500/15 text-slate-400'
        }>
          {currentStatus.replace('_', ' ')}
        </Badge>
        {controlError && <p className="text-sm text-destructive">{controlError}</p>}
      </div>

      {/* Contact status table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Called At</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No contacts imported yet.
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name ?? '—'}</TableCell>
                  <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                  <TableCell><StatusBadge status={c.status as CampaignContactStatus} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.called_at ? new Date(c.called_at).toLocaleTimeString() : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-destructive max-w-48 truncate">
                    {c.error_detail ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
