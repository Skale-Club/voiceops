'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { NewCampaignWizard } from './new-campaign-wizard'
import type { CampaignChannel } from '@/types/database'

interface NewCampaignDialogProps {
  assistants: Array<{ id: string; name: string }>
  hasTwilio: boolean
  hasVapi: boolean
  hasResend: boolean
  hasWhatsApp: boolean
  /** When set, skips step 1 (channel selection) and pre-selects this channel. */
  defaultChannel?: CampaignChannel
  /** Visual style of the trigger button. Defaults to 'outline' (empty-state CTA); pass 'primary' for the header. */
  variant?: ButtonProps['variant']
  /** Extra className forwarded to the trigger Button (e.g. "w-full" in sidebar). */
  triggerClassName?: string
}

export function NewCampaignDialog({
  assistants,
  hasTwilio,
  hasVapi,
  hasResend,
  hasWhatsApp,
  defaultChannel,
  variant = 'outline',
  triggerClassName,
}: NewCampaignDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant} className={triggerClassName}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Set up a multi-channel outreach campaign for your contacts.
          </DialogDescription>
        </DialogHeader>
        <NewCampaignWizard
          assistants={assistants}
          hasTwilio={hasTwilio}
          hasVapi={hasVapi}
          hasResend={hasResend}
          hasWhatsApp={hasWhatsApp}
          defaultChannel={defaultChannel}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
