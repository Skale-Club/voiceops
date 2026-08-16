// src/components/phone-numbers/vapi-numbers-section.tsx
// Vapi phone-number inventory, rendered under the Twilio number list on the
// Numbers settings tab.
//
// These are numbers the customer owns inside Vapi, with no Twilio account
// behind them — the "Vapi as answering bot only" setup. They used to be read
// live from the Vapi API on every render, which meant they had no id to FK
// against: calls couldn't be attributed to them and workflows couldn't trigger
// on them. Now they're registered locally (provider='vapi') and this section
// lists those rows, cross-checking the live Vapi list only to surface numbers
// that exist in Vapi but haven't been imported yet.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Phone, Plug } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { getVapiApiKey, listVapiPhoneNumbers, type VapiPhoneNumber } from '@/lib/vapi/client'
import type { TwilioPhoneNumberRow } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { ImportVapiNumbersButton } from '@/components/phone-numbers/import-vapi-numbers-button'
import {
  VapiNumbersRows,
  type VapiNumberRowMeta,
} from '@/components/phone-numbers/vapi-numbers-rows'

interface Props {
  /** Locally registered rows with provider='vapi'. */
  numbers: TwilioPhoneNumberRow[]
  /** Twilio rows the page already fetched — used only to flag E.164 overlap, never re-queried. */
  twilioNumbers: TwilioPhoneNumberRow[]
}

function Section({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13.5px] font-semibold text-text-primary">AI Phone Numbers (Vapi)</h2>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            Numbers from your Vapi inventory, used by voice assistants and outbound call campaigns.
          </p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export async function VapiNumbersSection({ numbers, twilioNumbers }: Props) {
  const apiKey = await getVapiApiKey()

  if (!apiKey && numbers.length === 0) {
    return (
      <Section>
        <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-border bg-bg-secondary/50 px-4 py-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-bg-tertiary text-text-tertiary">
            <Plug className="h-4 w-4" />
          </div>
          <p className="text-[12.5px] text-text-secondary">
            Vapi not connected —{' '}
            <Link href="/integrations" className="text-accent hover:underline">
              connect it in Integrations
            </Link>{' '}
            to see AI phone numbers here.
          </p>
        </div>
      </Section>
    )
  }

  // Live list is only used to surface what hasn't been imported yet, so a Vapi
  // outage degrades to "we can't tell you about new numbers" rather than an
  // empty section.
  let remote: VapiPhoneNumber[] = []
  let remoteError = false
  if (apiKey) {
    try {
      remote = await listVapiPhoneNumbers(apiKey)
    } catch {
      remoteError = true
    }
  }

  const registeredVapiIds = new Set(
    numbers.map((n) => n.vapi_phone_number_id).filter((id): id is string => Boolean(id)),
  )
  const notImported = remote.filter((n) => n.id && n.number && !registeredVapiIds.has(n.id))

  const assistantIds = Array.from(
    new Set(numbers.map((n) => n.vapi_assistant_id).filter((id): id is string => Boolean(id))),
  )

  const assistantNames = new Map<string, string>()
  if (assistantIds.length > 0) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('assistant_mappings')
      .select('vapi_assistant_id, name')
      .in('vapi_assistant_id', assistantIds)
    for (const m of data ?? []) {
      assistantNames.set(m.vapi_assistant_id, m.name?.trim() || m.vapi_assistant_id)
    }
  }

  const statusByVapiId = new Map(
    remote.filter((n) => n.id).map((n) => [n.id, n.status ?? null] as const),
  )
  const twilioE164s = new Set(twilioNumbers.map((n) => n.e164))

  // Everything the rows need that only the server can resolve, keyed by row id.
  const rowMeta: Record<string, VapiNumberRowMeta> = {}
  for (const n of numbers) {
    rowMeta[n.id] = {
      assistantName: n.vapi_assistant_id
        ? (assistantNames.get(n.vapi_assistant_id) ?? null)
        : null,
      status: n.vapi_phone_number_id ? (statusByVapiId.get(n.vapi_phone_number_id) ?? null) : null,
      alsoInTwilio: twilioE164s.has(n.e164),
    }
  }

  const action =
    apiKey && (notImported.length > 0 || numbers.length === 0) ? (
      <ImportVapiNumbersButton count={notImported.length} />
    ) : null

  if (numbers.length === 0) {
    return (
      <Section action={action}>
        <div className="rounded-[12px] border border-dashed border-border py-8 text-center">
          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-bg-secondary">
            <Phone className="h-4 w-4 text-text-tertiary" />
          </div>
          <p className="text-[12.5px] text-text-secondary">
            {remoteError
              ? "Couldn't reach Vapi — try importing again in a moment."
              : notImported.length > 0
                ? `${notImported.length} number${notImported.length === 1 ? '' : 's'} available in Vapi. Import to start tracking calls and triggering workflows.`
                : 'No phone numbers in this Vapi account yet.'}
          </p>
        </div>
      </Section>
    )
  }

  return (
    <Section action={action}>
      {remoteError && (
        <div className="flex items-center gap-3 rounded-[12px] border border-border bg-bg-secondary px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-rose-500/10 text-rose-400">
            <AlertTriangle className="h-3.5 w-3.5" />
          </div>
          <p className="text-[12px] text-text-secondary">
            Couldn&apos;t reach Vapi — newly added numbers may be missing from this list.
          </p>
        </div>
      )}

      <VapiNumbersRows numbers={numbers} meta={rowMeta} />
    </Section>
  )
}
