'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Phone, MessageSquare, Mail, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSubSidebar } from '@/components/layout/sub-sidebar-context'
import { NewCampaignDialog } from '@/app/(dashboard)/campaigns/_components/new-campaign-dialog'
import type { CampaignChannel } from '@/types/database'

interface Props {
  hasTwilio: boolean
  hasResend: boolean
  hasVapi: boolean
  hasWhatsApp: boolean
}

const ALL_CHANNELS: Array<{
  value: CampaignChannel
  label: string
  icon: React.ComponentType<{ className?: string }>
  always?: boolean
}> = [
  { value: 'calls',    label: 'Calls',     icon: Phone,          always: true },
  { value: 'sms',      label: 'SMS',       icon: MessageSquare },
  { value: 'email',    label: 'Email',     icon: Mail },
  { value: 'whatsapp', label: 'WhatsApp',  icon: MessageCircle },
]

export function CampaignsSubNav({ hasTwilio, hasVapi, hasResend, hasWhatsApp }: Props) {
  const searchParams = useSearchParams()
  const { onNavigate } = useSubSidebar()
  const activeChannel = searchParams.get('channel') as CampaignChannel | null

  const visibleChannels = ALL_CHANNELS.filter((ch) => {
    if (ch.always) return true
    if (ch.value === 'sms')      return hasTwilio
    if (ch.value === 'email')    return hasResend
    if (ch.value === 'whatsapp') return hasWhatsApp
    return false
  })

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
      {/* New Campaign button — pre-seeds active channel */}
      <div className="mb-2 px-1">
        <NewCampaignDialog
          defaultChannel={activeChannel ?? undefined}
          hasTwilio={hasTwilio}
          hasVapi={hasVapi}
          hasResend={hasResend}
          hasWhatsApp={hasWhatsApp}
          assistants={[]}
          triggerClassName="w-full justify-start gap-2 text-[12.5px] font-medium"
        />
      </div>

      <div className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
        Channels
      </div>

      <div className="flex flex-col gap-px">
        {visibleChannels.map((ch) => {
          const isActive = activeChannel === ch.value
          const Icon = ch.icon
          return (
            <Link
              key={ch.value}
              href={`/campaigns?channel=${ch.value}`}
              onClick={onNavigate}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors',
                isActive
                  ? 'bg-accent/10 text-text-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[60%] w-[2.5px] rounded-r-full bg-accent" />
              )}
              <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')} />
              <span className="truncate font-medium">{ch.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
