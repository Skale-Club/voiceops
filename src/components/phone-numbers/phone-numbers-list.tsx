'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  BookOpen,
  CheckCircle2,
  Monitor,
  MoreHorizontal,
  Network,
  Phone,
  PhoneForwarded,
  Plus,
  RefreshCw,
  Settings2,
  Star,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { AddPhoneNumberDialog } from '@/components/phone-numbers/add-phone-number-dialog'
import { EditPhoneNumberDialog } from '@/components/phone-numbers/edit-phone-number-dialog'
import {
  setDefaultTwilioNumber,
  softDeleteTwilioNumber,
  resyncTwilioNumberWebhooks,
  type TwilioPhoneNumberRow,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'

interface Props {
  initial: TwilioPhoneNumberRow[]
  twilioConnected: boolean
  /** Compact header for modal embedding (no page title, actions only). */
  embedded?: boolean
}

function displayLabel(row: TwilioPhoneNumberRow): string {
  return row.inbox_label?.trim() || row.friendly_name || row.e164
}

function formatE164(e164: string): string {
  // +18667240005 → +1 (866) 724-0005
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`
  return e164
}

const CAP_PILLS: Array<{ key: keyof TwilioPhoneNumberRow; label: string }> = [
  { key: 'capability_voice', label: 'Voice' },
  { key: 'capability_sms',   label: 'SMS' },
  { key: 'capability_mms',   label: 'MMS' },
]

const ROUTING_META: Record<string, { icon: React.ElementType; label: string }> = {
  forward: { icon: PhoneForwarded, label: 'Forward to' },
  browser: { icon: Monitor,        label: 'Browser'    },
  sip:     { icon: Network,        label: 'SIP'        },
}

function RoutingChip({ row }: { row: TwilioPhoneNumberRow }) {
  const mode = row.default_routing_mode
  if (!mode) return null
  const meta = ROUTING_META[mode]
  if (!meta) return null
  const Icon = meta.icon
  const suffix =
    mode === 'forward' && row.forward_to_number
      ? ` ${formatE164(row.forward_to_number)}`
      : ''
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-text-tertiary">
      <Icon className="h-3 w-3 shrink-0" />
      {meta.label}{suffix}
    </span>
  )
}

export function PhoneNumbersList({ initial, twilioConnected, embedded = false }: Props) {
  const router = useRouter()
  const [addOpen,  setAddOpen]  = React.useState(false)
  const [editRow,  setEditRow]  = React.useState<TwilioPhoneNumberRow | null>(null)
  const [busyId,   setBusyId]   = React.useState<string | null>(null)

  const handleSetDefault = React.useCallback(async (row: TwilioPhoneNumberRow) => {
    if (row.is_default) return
    setBusyId(row.id)
    try {
      const res = await setDefaultTwilioNumber(row.id)
      if (res.error) { toast.error(res.error); return }
      toast.success(`${displayLabel(row)} is now the default number.`)
      router.refresh()
    } finally { setBusyId(null) }
  }, [router])

  const handleResync = React.useCallback(async (row: TwilioPhoneNumberRow) => {
    setBusyId(row.id)
    try {
      const res = await resyncTwilioNumberWebhooks(row.id)
      if (res.error) { toast.error(res.error); return }
      toast.success(`Webhooks re-synced for ${displayLabel(row)}.`)
      router.refresh()
    } finally { setBusyId(null) }
  }, [router])

  const handleDelete = React.useCallback(async (row: TwilioPhoneNumberRow) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Remove ${displayLabel(row)} (${row.e164})? History is preserved but the number will no longer be available for calls or SMS.`,
      )
      if (!ok) return
    }
    setBusyId(row.id)
    try {
      const res = await softDeleteTwilioNumber(row.id)
      if (res.error) { toast.error(res.error); return }
      toast.success(`${displayLabel(row)} removed.`)
      router.refresh()
    } finally { setBusyId(null) }
  }, [router])

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className={cn('flex items-center gap-4 mb-6', embedded ? 'justify-end mb-4' : 'justify-between')}>
        {!embedded && (
          <div>
            <h1 className="text-[17px] font-semibold text-text-primary">Phone Numbers</h1>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">
              Manage inbound/outbound numbers. Each number can have its own assistant, routing, and capabilities.
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/integrations/twilio/sms-webhook-setup">
              <BookOpen className="h-3.5 w-3.5" />
              SMS webhook guide
            </Link>
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add number
          </Button>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────── */}
      {initial.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-bg-secondary">
            <Phone className="h-5 w-5 text-text-tertiary" />
          </div>
          <p className="text-[14px] font-medium text-text-primary">No Twilio numbers yet</p>
          <p className="mt-1 text-[12.5px] text-text-secondary max-w-sm mx-auto">
            Connect a Twilio number to enable your own dialer, SMS, and call routing. If you
            only need an AI answering bot on a number you already own, import it under AI Phone
            Numbers below instead.
          </p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add a number
          </Button>
        </div>
      )}

      {/* ── Number cards ────────────────────────────────────────── */}
      {initial.length > 0 && (
        <div className="space-y-2.5">
          {initial.map((row) => (
            <div
              key={row.id}
              className={cn(
                'group flex items-center gap-4 rounded-xl border border-border bg-bg-secondary px-4 py-3.5 transition-colors hover:border-border-strong hover:bg-bg-secondary/80',
                busyId === row.id && 'pointer-events-none opacity-60',
                !row.is_active && 'opacity-50',
              )}
            >
              {/* Icon */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary">
                <Phone className="h-4 w-4 text-text-secondary" />
              </div>

              {/* Main info */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-text-primary truncate">
                    {displayLabel(row)}
                  </span>
                  {row.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-400 border border-emerald-500/20">
                      <Star className="h-2.5 w-2.5" />
                      Default
                    </span>
                  )}
                  {!row.is_active && (
                    <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[10.5px] font-medium text-text-tertiary border border-border">
                      Archived
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11.5px] text-text-tertiary tracking-wide">
                    {formatE164(row.e164)}
                  </span>

                  <span className="text-text-tertiary/40">·</span>

                  {/* Capability pills */}
                  <div className="flex items-center gap-1">
                    {CAP_PILLS.map(({ key, label }) =>
                      row[key] ? (
                        <Badge
                          key={key}
                          variant="outline"
                          className="h-4 px-1.5 text-[10px] font-medium text-text-secondary border-border-subtle"
                        >
                          {label}
                        </Badge>
                      ) : null,
                    )}
                  </div>

                  {row.default_routing_mode && (
                    <>
                      <span className="text-text-tertiary/40">·</span>
                      <RoutingChip row={row} />
                    </>
                  )}

                  {row.business_purpose && (
                    <>
                      <span className="text-text-tertiary/40">·</span>
                      <span className="text-[11.5px] text-text-tertiary truncate max-w-[180px]">
                        {row.business_purpose}
                      </span>
                    </>
                  )}

                  {row.vapi_assistant_id && (
                    <>
                      <span className="text-text-tertiary/40">·</span>
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Assistant linked
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!row.is_default && row.is_active && (
                    <DropdownMenuItem onClick={() => handleSetDefault(row)}>
                      <Star className="h-3.5 w-3.5" /> Set as default
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setEditRow(row)}>
                    <Settings2 className="h-3.5 w-3.5" /> Configure
                  </DropdownMenuItem>
                  {row.is_active && row.phone_sid && (
                    <DropdownMenuItem onClick={() => handleResync(row)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Sync webhooks
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleDelete(row)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <AddPhoneNumberDialog open={addOpen} onOpenChange={setAddOpen} twilioConnected={twilioConnected} />
      <EditPhoneNumberDialog number={editRow} open={editRow !== null} onOpenChange={(o) => !o && setEditRow(null)} />
    </>
  )
}
