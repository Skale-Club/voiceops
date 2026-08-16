'use client'

// Client half of the Vapi numbers section: renders the rows and opens the same
// per-number editor dialog the Twilio list uses. Numbers are edited in a dialog,
// not on a detail page (/calls/phone-numbers/[id] is only a redirect back here),
// so the rows have to be a client component to hold the dialog state.

import * as React from 'react'
import { Bot, Phone } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { EditPhoneNumberDialog } from '@/components/phone-numbers/edit-phone-number-dialog'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { cn } from '@/lib/utils'
import type { TwilioPhoneNumberRow } from '@/app/(dashboard)/integrations/twilio/numbers-actions'

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  activating: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  blocked: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
}

export interface VapiNumberRowMeta {
  /** Assistant display name resolved from assistant_mappings, when registered. */
  assistantName: string | null
  /** Live status from the Vapi API, when reachable. */
  status: string | null
  /** True when the same E.164 is also registered as a Twilio number. */
  alsoInTwilio: boolean
}

export function VapiNumbersRows({
  numbers,
  meta,
}: {
  numbers: TwilioPhoneNumberRow[]
  meta: Record<string, VapiNumberRowMeta>
}) {
  const [editing, setEditing] = React.useState<TwilioPhoneNumberRow | null>(null)

  return (
    <>
      <div className="space-y-2.5">
        {numbers.map((n) => {
          const info = meta[n.id]
          const statusClass = info?.status ? STATUS_STYLE[info.status] : undefined

          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setEditing(n)}
              className="flex w-full items-center gap-4 rounded-[12px] border border-border bg-bg-secondary px-4 py-3.5 text-left transition-colors hover:border-border-strong"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary">
                <Phone className="h-4 w-4 text-text-secondary" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-text-primary">
                    {n.inbox_label?.trim() || formatPhoneDisplay(n.e164) || n.e164}
                  </span>
                  {n.friendly_name && n.friendly_name !== n.e164 && (
                    <span className="truncate text-[11.5px] text-text-tertiary">
                      {n.friendly_name}
                    </span>
                  )}
                  {info?.alsoInTwilio && (
                    <Badge
                      variant="outline"
                      className="h-4 border-border-subtle px-1.5 text-[10px] font-medium text-text-secondary"
                    >
                      Also in Twilio tab
                    </Badge>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-text-tertiary">
                  <span>Vapi</span>
                  <span className="text-text-tertiary/40">·</span>
                  {n.vapi_assistant_id ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <Bot className="h-3 w-3" />
                      {info?.assistantName ?? (
                        <span className="font-mono">{n.vapi_assistant_id.slice(0, 8)}…</span>
                      )}
                    </span>
                  ) : (
                    <span>No assistant linked</span>
                  )}
                  {n.forward_to_number && (
                    <>
                      <span className="text-text-tertiary/40">·</span>
                      <span>Transfers to {formatPhoneDisplay(n.forward_to_number)}</span>
                    </>
                  )}
                  {info?.status && (
                    <>
                      <span className="text-text-tertiary/40">·</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1.5 text-[10px] font-medium capitalize',
                          statusClass ?? 'border-border-subtle text-text-secondary',
                        )}
                      >
                        {info.status}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <EditPhoneNumberDialog
        number={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
    </>
  )
}
