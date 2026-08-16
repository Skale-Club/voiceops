'use client'

// "Start voice campaign" bulk action for /prospects. Creates a draft calls
// campaign (channel='calls', status='draft') pre-enrolled with the selected
// prospects' phone numbers, reusing the same createCampaign() shape as the
// campaigns wizard. Assistants + integration gating come from
// getVoiceCampaignSetup(); outbound phone numbers are loaded the same way the
// campaign wizard loads them (GET /api/vapi/phone-numbers).

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Phone } from 'lucide-react'
import { toast } from 'sonner'

import {
  getVoiceCampaignSetup,
  startVoiceCampaignFromProspects,
  type ProspectRef,
  type ProspectRow,
  type VoiceCampaignAssistantOption,
} from '@/app/(dashboard)/prospects/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface VapiPhoneNumber {
  id: string
  number?: string
  name?: string
}

interface VoiceCampaignDialogProps {
  selectedRefs: ProspectRef[]
  selectedRows: ProspectRow[]
  disabled?: boolean
  onDone: () => void
}

export function VoiceCampaignDialog({ selectedRefs, selectedRows, disabled, onDone }: VoiceCampaignDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [loadingSetup, setLoadingSetup] = React.useState(false)
  const [hasVapi, setHasVapi] = React.useState(true)
  const [assistants, setAssistants] = React.useState<VoiceCampaignAssistantOption[]>([])
  const [phoneNumbers, setPhoneNumbers] = React.useState<VapiPhoneNumber[]>([])
  const [loadingPhones, setLoadingPhones] = React.useState(false)

  const [name, setName] = React.useState('')
  const [assistantId, setAssistantId] = React.useState('')
  const [phoneNumberId, setPhoneNumberId] = React.useState('')
  const [callsPerMinute, setCallsPerMinute] = React.useState(5)
  const [submitting, setSubmitting] = React.useState(false)

  const withPhone = React.useMemo(() => selectedRows.filter((r) => Boolean(r.phone)).length, [selectedRows])
  const withoutPhone = selectedRows.length - withPhone

  React.useEffect(() => {
    if (!open) return
    setName(`Prospects · ${selectedRows.length} contatos`)
    setLoadingSetup(true)
    setLoadingPhones(true)
    let cancelled = false

    void (async () => {
      try {
        const setup = await getVoiceCampaignSetup()
        if (cancelled) return
        if (setup.ok) {
          setHasVapi(setup.hasVapi)
          setAssistants(setup.assistants)
        } else {
          toast.error(setup.error)
        }
      } finally {
        if (!cancelled) setLoadingSetup(false)
      }
    })()

    void (async () => {
      try {
        const response = await fetch('/api/vapi/phone-numbers')
        const data = await response.json()
        if (!cancelled) setPhoneNumbers(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setPhoneNumbers([])
      } finally {
        if (!cancelled) setLoadingPhones(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Vapi places the call itself (lib/campaigns/outbound.ts POSTs api.vapi.ai/call),
  // so Twilio is never in the path — a customer whose number lives in Vapi has no
  // Twilio account to connect.
  const blocked = !loadingSetup && !hasVapi
  const canSubmit = !submitting && !blocked && withPhone > 0 && name.trim().length > 0 && !!assistantId && !!phoneNumberId

  async function submit() {
    setSubmitting(true)
    const res = await startVoiceCampaignFromProspects(selectedRefs, {
      name: name.trim(),
      vapiAssistantId: assistantId,
      vapiPhoneNumberId: phoneNumberId,
      callsPerMinute,
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const skipped = res.skippedNoPhone + res.skippedDuplicate
    toast.success(
      `Campanha criada com ${res.enrolled} contato${res.enrolled === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} ignorado${skipped === 1 ? '' : 's'})` : ''}`,
      {
        action: {
          label: 'Ver campanha',
          onClick: () => router.push(`/campaigns/${res.campaignId}`),
        },
      },
    )
    setOpen(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7" disabled={disabled}>
          <Phone className="h-3.5 w-3.5" />
          Voice campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Start voice campaign</DialogTitle>
          <DialogDescription>
            Creates a draft calls campaign pre-loaded with the selected prospects who have a phone number. Launch it
            from the campaign page when you&apos;re ready to start dialing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/40 px-3 py-2 text-[12.5px] text-text-secondary">
            <strong className="text-text-primary">{withPhone}</strong> of {selectedRows.length} selected prospects
            have a phone number.
            {withoutPhone > 0 ? ` ${withoutPhone} will be skipped.` : ''}
          </div>

          {blocked && (
            <div className="rounded-[8px] border border-amber-500/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-200">
              <p>Vapi is not connected. Add a Vapi integration to place calls.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Campaign name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
          </div>

          <div className="space-y-1.5">
            <Label>Voice assistant</Label>
            <Select value={assistantId} onValueChange={setAssistantId} disabled={loadingSetup}>
              <SelectTrigger>
                <SelectValue placeholder={loadingSetup ? 'Loading…' : 'Select an assistant'} />
              </SelectTrigger>
              <SelectContent>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Outbound phone number</Label>
            <Select value={phoneNumberId} onValueChange={setPhoneNumberId} disabled={loadingPhones}>
              <SelectTrigger>
                <SelectValue placeholder={loadingPhones ? 'Loading…' : 'Select a phone number'} />
              </SelectTrigger>
              <SelectContent>
                {phoneNumbers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.number ?? p.name ?? p.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Calls per minute (1–20)</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={callsPerMinute}
              onChange={(e) => setCallsPerMinute(Number(e.target.value))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Creating…' : 'Create draft campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
