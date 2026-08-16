import Link from 'next/link'
import { Megaphone, Phone, MessageSquare, Mail, MessageCircle } from 'lucide-react'
import { format } from 'date-fns'

import { PageContainer } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { getCampaigns } from './actions'
import type { CampaignChannel } from '@/types/database'
import { CampaignActions } from './_components/campaign-actions'
import { NewCampaignDialog } from './_components/new-campaign-dialog'
import { getCampaignProviderAvailability } from './provider-availability'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  calls: Phone,
  sms: MessageSquare,
  email: Mail,
  whatsapp: MessageCircle,
}

const CHANNEL_COLORS: Record<string, string> = {
  calls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  sms: 'bg-green-500/10 text-green-400 border-green-500/20',
  email: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  whatsapp: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  running: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  stopped: 'bg-red-500/10 text-red-400 border-red-500/20',
  completed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  draft: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

function humanStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

export default async function CampaignsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const activeChannel = (typeof sp.channel === 'string' ? sp.channel : null) as CampaignChannel | null

  const [availability, campaigns] = await Promise.all([
    getCampaignProviderAvailability(),
    getCampaigns(activeChannel ?? 'all'),
  ])

  return (
    <PageContainer>

      {/* Provider availability banners — only shown when the relevant channel is active */}
      {activeChannel === 'email' && !availability.hasResend && (
        <div className="rounded-[10px] border border-violet-500/20 bg-violet-500/5 px-4 py-3 flex items-center gap-3">
          <Mail className="h-4 w-4 text-violet-400 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-text-primary">Email integration not connected</p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Connect Resend to enable email campaigns.{' '}
              <Link href="/settings/email" className="underline hover:text-text-primary">
                Set up email
              </Link>
            </p>
          </div>
        </div>
      )}
      {activeChannel === 'sms' && !availability.hasTwilio && (
        <div className="rounded-[10px] border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
          <MessageSquare className="h-4 w-4 text-amber-400 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-text-primary">SMS provider not connected</p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Connect Twilio to enable SMS campaigns.{' '}
              <Link href="/integrations/twilio" className="underline hover:text-text-primary">
                Set up Twilio
              </Link>
            </p>
          </div>
        </div>
      )}
      {activeChannel === 'calls' && !availability.hasVapi && (
        <div className="rounded-[10px] border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
          <Phone className="h-4 w-4 text-amber-400 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-text-primary">Voice provider not connected</p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Connect Vapi to enable voice campaigns.{' '}
              <Link href="/integrations" className="underline hover:text-text-primary">
                Set up Vapi
              </Link>
            </p>
          </div>
        </div>
      )}
      {activeChannel === 'whatsapp' && !availability.hasWhatsApp && (
        <div className="rounded-[10px] border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
          <MessageCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-text-primary">WhatsApp not connected</p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Connect WhatsApp to enable WhatsApp campaigns.{' '}
              <Link href="/integrations" className="underline hover:text-text-primary">
                Go to Integrations
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[8px] border border-dashed border-border bg-bg-secondary/30 px-4 py-16 text-center">
          <Megaphone className="h-10 w-10 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold mb-1">No campaigns yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first campaign to start reaching contacts at scale.
          </p>
          <NewCampaignDialog
            assistants={[]}
            hasTwilio={availability.hasTwilio}
            hasVapi={availability.hasVapi}
            hasResend={availability.hasResend}
            hasWhatsApp={availability.hasWhatsApp}
            defaultChannel={activeChannel ?? undefined}
          />
        </div>
      ) : (
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          {/* Header */}
          <div
            className="grid items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
            style={{ gridTemplateColumns: '2fr 80px 100px 80px 100px 80px 120px 48px' }}
          >
            <div>Name</div>
            <div>Channel</div>
            <div>Status</div>
            <div className="text-right">Total</div>
            <div className="text-right">Completed</div>
            <div className="text-right">Failed</div>
            <div>Created</div>
            <div />
          </div>

          {/* Rows */}
          <div className="divide-y divide-border-subtle">
            {campaigns.map((c) => {
              const ChannelIcon = CHANNEL_ICONS[c.channel] ?? Megaphone
              return (
                <div
                  key={c.id}
                  className="grid items-center gap-3 px-4 py-3 transition-all duration-200 ease-out hover:bg-bg-tertiary/40"
                  style={{ gridTemplateColumns: '2fr 80px 100px 80px 100px 80px 120px 48px' }}
                >
                  {/* Name */}
                  <div className="min-w-0">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="truncate text-[13px] font-medium text-text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.description && (
                      <p className="text-[11px] text-text-tertiary truncate mt-0.5">{c.description}</p>
                    )}
                  </div>

                  {/* Channel */}
                  <div>
                    <Badge
                      variant="outline"
                      className={['text-[10.5px] font-medium inline-flex items-center gap-1', CHANNEL_COLORS[c.channel] ?? ''].join(' ')}
                    >
                      <ChannelIcon className="h-3 w-3" />
                      {c.channel}
                    </Badge>
                  </div>

                  {/* Status */}
                  <div>
                    <Badge
                      variant="outline"
                      className={['text-[10.5px] font-medium', STATUS_COLORS[c.status] ?? ''].join(' ')}
                    >
                      {humanStatus(c.status)}
                    </Badge>
                  </div>

                  {/* Total */}
                  <div className="text-right text-[12.5px] text-text-secondary tabular-nums">
                    {c.total_contacts}
                  </div>

                  {/* Completed */}
                  <div className="text-right text-[12.5px] text-emerald-400 tabular-nums">
                    {c.completed_contacts}
                  </div>

                  {/* Failed */}
                  <div className="text-right text-[12.5px] text-red-400 tabular-nums">
                    {c.failed_contacts}
                  </div>

                  {/* Created */}
                  <div className="text-[11.5px] text-text-tertiary">
                    {format(new Date(c.created_at), 'MMM d, yyyy')}
                  </div>

                  {/* Actions */}
                  <CampaignActions
                    campaignId={c.id}
                    campaignStatus={c.status}
                    campaignChannel={c.channel as CampaignChannel}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
