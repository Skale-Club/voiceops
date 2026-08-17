'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { pauseCampaign, cancelCampaign } from '../actions'
import type { CampaignChannel, CampaignStatus } from '@/types/database'

interface Props {
  campaignId: string
  campaignStatus: CampaignStatus
  campaignChannel: CampaignChannel
}

export function CampaignDetailActions({ campaignId, campaignStatus, campaignChannel }: Props) {
  const router = useRouter()

  const canLaunch = ['draft', 'scheduled', 'paused'].includes(campaignStatus)
  const canPause = ['in_progress', 'running'].includes(campaignStatus)
  const canCancel = !['stopped', 'completed'].includes(campaignStatus)

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
      toast.error(err instanceof Error ? err.message : 'Failed to pause')
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this campaign? This cannot be undone.')) return
    try {
      await cancelCampaign(campaignId)
      toast.success('Campaign cancelled')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  return (
    <div className="flex items-center gap-2">
      {canLaunch && (
        <Button size="sm" onClick={handleLaunch}>
          {campaignStatus === 'paused' ? 'Resume' : 'Launch'}
        </Button>
      )}
      {canPause && (
        <Button size="sm" variant="outline" onClick={handlePause}>
          Pause
        </Button>
      )}
      {canCancel && (
        <Button size="sm" variant="outline" className="text-destructive" onClick={handleCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}
