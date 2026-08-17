'use client'

import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { pauseCampaign, cancelCampaign } from '../actions'
import type { CampaignChannel } from '@/types/database'

interface CampaignActionsProps {
  campaignId: string
  campaignStatus: string
  campaignChannel: CampaignChannel
}

export function CampaignActions({ campaignId, campaignStatus, campaignChannel }: CampaignActionsProps) {
  const router = useRouter()

  async function handleLaunch() {
    // Single launch entry point for every channel — /start branches per
    // channel server-side and fails loudly for channels with no dispatcher.
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/start`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to start campaign')
        return
      }
      if (campaignChannel === 'calls') {
        toast.success(`Campaign started — ${json.fired ?? 0} calls fired`)
      } else {
        toast.success('Campaign launched')
      }
      router.refresh()
    } catch {
      toast.error('Failed to start campaign')
    }
  }

  async function handlePause() {
    try {
      await pauseCampaign(campaignId)
      toast.success('Campaign paused')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to pause campaign')
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this campaign? This cannot be undone.')) return
    try {
      await cancelCampaign(campaignId)
      toast.success('Campaign cancelled')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel campaign')
    }
  }

  const canLaunch = ['draft', 'scheduled', 'paused'].includes(campaignStatus)
  const canPause = ['in_progress', 'running'].includes(campaignStatus)
  const canCancel = !['stopped', 'completed'].includes(campaignStatus)

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Campaign actions">
            <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/campaigns/${campaignId}`}>View</Link>
          </DropdownMenuItem>
          {canLaunch && (
            <DropdownMenuItem onClick={handleLaunch}>
              Launch
            </DropdownMenuItem>
          )}
          {canPause && (
            <DropdownMenuItem onClick={handlePause}>
              Pause
            </DropdownMenuItem>
          )}
          {canCancel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={handleCancel}
              >
                Cancel
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
